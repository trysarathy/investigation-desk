/**
 * SWIFT MT940 customer statements → normalised bank lines. Several statements per file are read in order; a SWIFT
 * envelope ({1:...}{2:...}{4: ... -}) is tolerated. Each statement's opening balance plus its entries must equal its
 * closing balance; a mismatch is a warning that states both figures.
 */
import { formatMinor, parseAmount } from "../decimal";
import { IngestError, smallInt, type IngestWarning } from "../errors";
import { checkFileSize, resolveLimits, type IngestLimits } from "../limits";
import { decodeText } from "../sniff";
import { currencyPrecision } from "./currency";
import { assignLineIds, expectedClosing, type BankLineDraft, type BankParseResult, type BankStatement, type StatedBalance } from "./types";

interface Field { tag: string; value: string; line: number }

/** Split the text into :tag: fields with their first line number; continuation lines join with "\n". */
function fields(text: string): Field[] {
  const out: Field[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    let line = raw
      .replace(/\{[1235]:(?:\{[^{}]*\}|[^{}])*\}/g, "") // basic, application, user and trailer blocks
      .replace(/\{4:/g, "")
      .replace(/-\}\s*$/, "");
    if (/^\s*-\s*$/.test(line)) line = "";
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) out.push({ tag: m[1], value: m[2], line: i + 1 });
    else if (line.trim() !== "" && out.length) out[out.length - 1].value += "\n" + line;
  });
  return out;
}

const BALANCE = /^([CD])(\d{6})([A-Z]{3})(\d{1,15},\d*)\s*$/;
const STATEMENT_LINE = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d{1,15},\d*)([NFS][A-Z0-9]{3})(.*)$/;

/** YYMMDD → YYYY-MM-DD [ASSUMPTION: YY 00–79 is 2000–2079, 80–99 is 1980–1999]. */
function yymmdd(s: string): string | undefined {
  const yy = smallInt(s.slice(0, 2));
  const y = yy < 80 ? 2000 + yy : 1900 + yy;
  return calendar(y, smallInt(s.slice(2, 4)), smallInt(s.slice(4, 6)));
}

function calendar(y: number, m: number, d: number): string | undefined {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function amount(text: string, precision: number, line: number): bigint {
  const r = parseAmount(text.replace(/,$/, ""), { precision, decimalSeparator: "," });
  if (!r.ok) throw new IngestError("invalid_amount", `Line ${line}: ${r.message}`, { row: line });
  return r.value;
}

function balance(f: Field, statementCurrency?: string): StatedBalance {
  const m = BALANCE.exec(f.value.trim());
  if (!m) throw new IngestError("invalid_mt940", `Line ${f.line}: the :${f.tag}: balance "${f.value.trim()}" is not in the form C261101SGD1234,56.`, { row: f.line });
  const date = yymmdd(m[2]);
  if (!date) throw new IngestError("invalid_mt940", `Line ${f.line}: the :${f.tag}: balance has an impossible date.`, { row: f.line });
  const p = currencyPrecision(m[3]);
  if (!p.ok) throw new IngestError("unknown_currency", `Line ${f.line}: ${p.message}`, { row: f.line });
  if (statementCurrency && m[3] !== statementCurrency) throw new IngestError("invalid_mt940", `Line ${f.line}: the :${f.tag}: balance is in ${m[3]} but the statement is in ${statementCurrency}.`, { row: f.line });
  const minor = amount(m[4], p.value, f.line);
  return { date, currency: m[3], amountMinor: m[1] === "D" ? -minor : minor };
}

export interface Mt940Options { limits?: Partial<IngestLimits> }

export function parseMt940(input: Uint8Array | string, opts: Mt940Options = {}): BankParseResult {
  let text: string;
  const warnings: IngestWarning[] = [];
  if (typeof input === "string") text = input;
  else {
    checkFileSize(input, resolveLimits(opts.limits));
    const d = decodeText(input);
    text = d.text;
    warnings.push(...d.warnings);
  }
  const all = fields(text);
  const firstStart = all.findIndex((f) => f.tag === "20");
  if (firstStart < 0) throw new IngestError("invalid_mt940", "No MT940 statement found: the file has no :20: field.");
  if (firstStart > 0) warnings.push({ code: "mt940_fields_before_statement", message: `${firstStart} field(s) before the first :20: were ignored.`, row: all[0].line });

  const groups: Field[][] = [];
  for (const f of all.slice(firstStart)) {
    if (f.tag === "20") groups.push([]);
    groups[groups.length - 1].push(f);
  }
  const maxRows = resolveLimits(opts.limits).maxDataRows;
  const statements: BankStatement[] = [];
  const drafts: BankLineDraft[] = [];
  for (const g of groups) {
    const first = g[0];
    const get = (tag: RegExp) => g.find((f) => tag.test(f.tag));
    const accountField = get(/^25P?$/);
    if (!accountField || accountField.value.trim() === "") throw new IngestError("invalid_mt940", `Line ${first.line}: the statement has no :25: account.`, { row: first.line });
    const account = accountField.value.trim();
    const openingField = get(/^60[FM]$/);
    if (!openingField) throw new IngestError("invalid_mt940", `Line ${first.line}: the statement for ${account} has no :60F: opening balance.`, { row: first.line });
    const opening = balance(openingField);
    const currency = opening.currency;
    const precision = currencyPrecision(currency);
    if (!precision.ok) throw new IngestError("unknown_currency", precision.message);
    const closingField = get(/^62[FM]$/);
    const closing = closingField ? balance(closingField, currency) : undefined;
    const statementLines: BankLineDraft[] = [];
    g.forEach((f, i) => {
      if (f.tag !== "61") return;
      const [head, ...supplementary] = f.value.split("\n");
      const m = STATEMENT_LINE.exec(head.trim());
      if (!m) throw new IngestError("invalid_mt940", `Line ${f.line}: the :61: statement line "${head.trim()}" is not in the MT940 format.`, { row: f.line });
      const [, valueRaw, entryRaw, mark, , amountRaw, , rest] = m;
      const valueDate = yymmdd(valueRaw);
      if (!valueDate) throw new IngestError("invalid_mt940", `Line ${f.line}: the :61: value date ${valueRaw} is impossible.`, { row: f.line });
      let bookingDate: string | undefined;
      if (entryRaw) {
        const vy = smallInt(valueDate.slice(0, 4));
        const vm = smallInt(valueDate.slice(5, 7));
        const em = smallInt(entryRaw.slice(0, 2));
        const y = vm === 12 && em === 1 ? vy + 1 : vm === 1 && em === 12 ? vy - 1 : vy;
        bookingDate = calendar(y, em, smallInt(entryRaw.slice(2, 4)));
        if (!bookingDate) throw new IngestError("invalid_mt940", `Line ${f.line}: the :61: entry date ${entryRaw} is impossible.`, { row: f.line });
      }
      const [customerRaw, bankRaw] = rest.split("//", 2);
      const customerRef = customerRaw.trim();
      const bankReference = bankRaw?.trim() || undefined;
      const next = g[i + 1];
      const narrative = next?.tag === "86" ? next.value.split("\n").map((s) => s.trim()).filter(Boolean).join(" ") : undefined;
      const details = supplementary.map((s) => s.trim()).filter(Boolean).join(" ");
      const reference = customerRef !== "" && customerRef.toUpperCase() !== "NONREF" ? customerRef : narrative ?? details;
      statementLines.push({
        account,
        currency,
        valueDate,
        ...(bookingDate ? { bookingDate } : {}),
        // RC (reversal of a credit) takes money out; RD (reversal of a debit) puts it back.
        direction: mark === "C" || mark === "RD" ? "credit" : "debit",
        amountMinor: amount(amountRaw, precision.value, f.line),
        reference,
        ...(narrative || details ? { narrative: [details, narrative].filter(Boolean).join(" ") } : {}),
        ...(bankReference ? { bankReference } : {}),
        sourceFormat: "mt940",
        sourceRow: f.line,
      });
      if (drafts.length + statementLines.length > maxRows) throw new IngestError("too_many_rows", `The file has more than ${maxRows.toLocaleString("en-US")} statement lines. Split it into smaller files.`);
    });
    let balanced: boolean | undefined;
    if (closing) {
      const expected = expectedClosing(opening.amountMinor, statementLines);
      balanced = expected === closing.amountMinor;
      if (!balanced) {
        warnings.push({
          code: "balance_mismatch",
          message: `Statement ${first.value.trim()} for ${account}: opening ${formatMinor(opening.amountMinor, precision.value)} plus the entries gives ${formatMinor(expected, precision.value)} ${currency}, but the closing balance is ${formatMinor(closing.amountMinor, precision.value)} ${currency}.`,
          row: closingField!.line,
        });
      }
    } else {
      warnings.push({ code: "missing_closing_balance", message: `Statement ${first.value.trim()} for ${account} has no :62F: closing balance, so it cannot be checked.`, row: first.line });
    }
    const sequence = get(/^28C?$/)?.value.trim();
    statements.push({ sourceFormat: "mt940", account, currency, statementId: first.value.trim(), ...(sequence ? { sequence } : {}), opening, ...(closing ? { closing } : {}), lines: [], ...(balanced !== undefined ? { balanced } : {}) });
    drafts.push(...statementLines);
  }
  const lines = assignLineIds(drafts);
  let k = 0;
  groups.forEach((g, i) => {
    const n = g.filter((f) => f.tag === "61").length;
    statements[i].lines = lines.slice(k, k + n);
    k += n;
  });
  return { sourceFormat: "mt940", statements, lines, skipped: [], warnings };
}
