/**
 * BAI2 (Cash Management Balance Reporting Specification, version 2) → normalised bank lines.
 *
 * Strict by design: a BAI2 file carries its own checksums, and every one is verified before a single line is returned.
 * - Structure: one 01 file header first, one 99 file trailer last; 02/98 groups; 03/49 accounts inside a group; 16
 *   transactions inside an account; 88 continues the record before it. Any other record code, order or nesting is
 *   refused.
 * - Totals: each 49 account control total equals the sum of the amounts in its 03 and 16 records; each 98 group
 *   control total equals the sum of its 49 totals; the 99 file control total equals the sum of the 98 totals.
 * - Counts: each 49, 98 and 99 record count equals the physical records it covers (88 continuations included, its
 *   header and trailer included); 98 states the number of accounts and 99 the number of groups.
 * A file that fails any of these is refused (invalid_bai2) with the stated and computed figures: it was truncated,
 * edited or produced incorrectly, and reading part of it would import an incomplete statement.
 *
 * v1 rules (the conservative choices):
 * - One bank account per file: a file whose 03 records name more than one account is refused (multiple_accounts), not
 *   split, because an upload belongs to exactly one bank account.
 * - Only group status 1 (update) is read; deletion (2), correction (3) and test-only (4) groups are refused.
 * - A 16 record's direction comes from its type code: 100–399 credit, 400–699 debit. Loan (700–799) and bank-specific
 *   (900–999) codes have no direction Clearline can know, so those entries are skipped and reported, never guessed.
 * - Amounts carry no decimal point; the implied decimals are the currency's (USD 2, JPY 0). The currency is the 03
 *   record's, else the 02 group's; if neither states one the BAI2 default USD applies, with a warning.
 * - Opening ledger (010) + credits − debits must equal closing ledger (015); a difference is a warning that states
 *   both figures, as for MT940 and camt.053. The 100/400 summaries are checked against the detail the same way.
 */
import { formatMinor } from "../decimal";
import { IngestError, smallInt, type IngestWarning } from "../errors";
import { checkFileSize, resolveLimits, type IngestLimits } from "../limits";
import { decodeText } from "../sniff";
import { currencyPrecision } from "./currency";
import { assignLineIds, expectedClosing, type BankLineDraft, type BankParseResult, type BankStatement, type SkippedEntry, type StatedBalance } from "./types";

/** A logical record: a physical record plus its 88 continuations. */
interface Rec { code: string; fields: string[]; line: number; physical: number }

const CODES = new Set(["01", "02", "03", "16", "49", "88", "98", "99"]);
/** Longest physical record accepted (BAI2 records are usually 80 characters; some banks send longer ones). */
export const BAI2_MAX_LINE = 4096;

/**
 * Type codes that mark a returned or reversed item [ASSUMPTION: from the BAI2 type-code list; 555 "Deposited Item
 * Returned". Banks also report returns under ordinary codes, which are not flagged]. The flag is for review only.
 */
const RETURN_CODES = new Set(["555"]);

const bad = (line: number, message: string): IngestError => new IngestError("invalid_bai2", `Line ${line}: ${message}`, { row: line });

/** YYMMDD → YYYY-MM-DD [ASSUMPTION: YY 00–79 is 2000–2079, 80–99 is 1980–1999, as for MT940]. */
function yymmdd(s: string, line: number, what: string): string {
  if (!/^\d{6}$/.test(s)) throw bad(line, `the ${what} "${s.slice(0, 12)}" is not a date in the form YYMMDD.`);
  const yy = smallInt(s.slice(0, 2));
  const y = yy < 80 ? 2000 + yy : 1900 + yy;
  const m = smallInt(s.slice(2, 4));
  const d = smallInt(s.slice(4, 6));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) throw bad(line, `the ${what} ${s} is not a real date.`);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A BAI2 amount: digits only, no decimal point; `signed` allows a leading + or − (balances and control totals). */
function amountOf(s: string, line: number, what: string, signed: boolean): bigint {
  const re = signed ? /^[+-]?\d{1,18}$/ : /^\d{1,18}$/;
  if (!re.test(s)) throw bad(line, `the ${what} "${s.slice(0, 20)}" is not a BAI2 amount (${signed ? "an optional sign and " : ""}digits only, no decimal point).`);
  return BigInt(s);
}

function count(s: string, line: number, what: string): number {
  if (!/^\d{1,9}$/.test(s)) throw bad(line, `the ${what} "${s.slice(0, 12)}" is not a whole number.`);
  return smallInt(s);
}

/** Physical records → logical records. Trailing "/" ends a record's fields; 88 continues the previous record. */
function records(text: string, limits: IngestLimits): Rec[] {
  const out: Rec[] = [];
  const raw = text.split(/\r\n|\r|\n/);
  while (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
  let physicalTotal = 0;
  raw.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.replace(/\s+$/, "");
    if (line === "") throw bad(lineNo, "blank line inside the file.");
    if (line.length > BAI2_MAX_LINE) throw bad(lineNo, `the record is ${line.length.toLocaleString("en-US")} characters long; at most ${BAI2_MAX_LINE.toLocaleString("en-US")} are accepted.`);
    const m = /^(\d{2}),(.*)$/.exec(line);
    if (!m || !CODES.has(m[1])) throw bad(lineNo, `"${line.slice(0, 2)}" is not a BAI2 record code (01, 02, 03, 16, 49, 88, 98 or 99).`);
    if (++physicalTotal > limits.maxDataRows * 4) throw new IngestError("too_many_rows", `The file has more than ${(limits.maxDataRows * 4).toLocaleString("en-US")} records. Split it into smaller files.`);
    const body = m[2].endsWith("/") ? m[2].slice(0, -1) : m[2];
    if (m[1] === "88") {
      const prev = out[out.length - 1];
      if (!prev) throw bad(lineNo, "a continuation (88) record has no record before it.");
      prev.fields.push(...body.split(","));
      prev.physical++;
      return;
    }
    out.push({ code: m[1], fields: body.split(","), line: lineNo, physical: 1 });
  });
  return out;
}

/** Funds-type fields after a 16 or 03 amount; returns the index after them and the value date for type V. */
function skipFunds(f: string[], i: number, line: number): { next: number; valueDate?: string } {
  const type = (f[i] ?? "").trim().toUpperCase();
  if (type === "" || type === "Z" || type === "0" || type === "1" || type === "2") return { next: i + 1 };
  if (type === "V") return { next: i + 3, valueDate: yymmdd((f[i + 1] ?? "").trim(), line, "value date") };
  if (type === "S") {
    for (let k = 1; k <= 3; k++) { const a = (f[i + k] ?? "").trim(); if (a !== "") amountOf(a, line, "availability amount", true); }
    return { next: i + 4 };
  }
  if (type === "D") {
    const n = count((f[i + 1] ?? "").trim(), line, "number of availability distributions");
    if (n > 100) throw bad(line, `${n} availability distributions; at most 100 are accepted.`);
    for (let k = 0; k < n; k++) { count((f[i + 2 + 2 * k] ?? "").trim(), line, "availability days"); amountOf((f[i + 3 + 2 * k] ?? "").trim(), line, "availability amount", true); }
    return { next: i + 2 + 2 * n };
  }
  throw bad(line, `the funds type "${type.slice(0, 4)}" is not one of Z, 0, 1, 2, V, S or D.`);
}

function typeCode(s: string, line: number): string {
  const c = s.trim();
  if (!/^\d{3}$/.test(c)) throw bad(line, `the type code "${c.slice(0, 6)}" is not three digits.`);
  return c;
}

export interface Bai2Options { limits?: Partial<IngestLimits> }

export function parseBai2(input: Uint8Array | string, opts: Bai2Options = {}): BankParseResult {
  const limits = resolveLimits(opts.limits);
  const warnings: IngestWarning[] = [];
  let text: string;
  if (typeof input === "string") text = input;
  else {
    checkFileSize(input, limits);
    const d = decodeText(input);
    text = d.text;
    warnings.push(...d.warnings);
  }
  const recs = records(text, limits);
  if (recs.length === 0 || recs[0].code !== "01") throw new IngestError("invalid_bai2", "This is not a BAI2 file: it does not start with a 01 file header record.");
  const header = recs[0];
  const version = (header.fields[7] ?? "").trim();
  if (version !== "2") throw bad(header.line, `the file header says BAI version "${version.slice(0, 4)}"; only version 2 is read.`);
  yymmdd((header.fields[2] ?? "").trim(), header.line, "file creation date");
  const fileId = (header.fields[4] ?? "").trim();

  const statements: BankStatement[] = [];
  const perStatement: BankLineDraft[][] = [];
  const skipped: SkippedEntry[] = [];
  const accounts = new Set<string>();
  let transactions = 0;
  let i = 1;
  let groups = 0;
  let groupTotalsSum = 0n;
  const physicalOf = (from: number, to: number) => recs.slice(from, to + 1).reduce((n, r) => n + r.physical, 0);

  while (i < recs.length && recs[i].code === "02") {
    const gStart = i;
    const g = recs[i];
    groups++;
    const status = (g.fields[2] ?? "").trim();
    if (status !== "1") {
      const words: Record<string, string> = { "2": "a deletion", "3": "a correction", "4": "test only" };
      throw bad(g.line, `the group status is ${words[status] ?? `"${status.slice(0, 4)}"`}; only update groups (status 1) are read. Ask the bank for the current statement.`);
    }
    const asOf = yymmdd((g.fields[3] ?? "").trim(), g.line, "as-of date");
    const groupCurrency = (g.fields[5] ?? "").trim().toUpperCase();
    i++;
    let accountsInGroup = 0;
    let accountTotalsSum = 0n;
    while (i < recs.length && recs[i].code === "03") {
      const aStart = i;
      const a = recs[i];
      accountsInGroup++;
      const account = (a.fields[0] ?? "").trim();
      if (account === "") throw bad(a.line, "the account identifier (03) has no account number.");
      accounts.add(account);
      if (accounts.size > 1) throw new IngestError("multiple_accounts", `The BAI2 file covers at least ${accounts.size} different bank accounts; an upload belongs to one bank account. Ask the bank for one file per account and upload each to its account.`, { row: a.line });
      let currency = (a.fields[1] ?? "").trim().toUpperCase() || groupCurrency;
      if (currency === "") {
        currency = "USD";
        warnings.push({ code: "bai2_currency_defaulted", message: `Line ${a.line}: neither the account nor its group states a currency; BAI2's default, USD, was used.`, row: a.line });
      }
      const precision = currencyPrecision(currency);
      if (!precision.ok) throw new IngestError("unknown_currency", `Line ${a.line}: ${precision.message}`, { row: a.line });
      const p = precision.value;

      // 03 summary and status fields: type code, amount, item count, funds type (+ its fields), repeated.
      let total = 0n;
      const status03 = new Map<string, bigint>();
      const summary = new Map<string, { amount: bigint; items?: number }>();
      let k = 2;
      while (k < a.fields.length) {
        if (a.fields.slice(k).every((v) => v.trim() === "")) break;
        const code = typeCode(a.fields[k] ?? "", a.line);
        const rawAmt = (a.fields[k + 1] ?? "").trim();
        const rawItems = (a.fields[k + 2] ?? "").trim();
        const n = smallInt(code);
        if (rawAmt !== "") {
          const amt = amountOf(rawAmt, a.line, `type ${code} amount`, true);
          total += amt;
          if (n < 100) status03.set(code, amt);
          else summary.set(code, { amount: amt, ...(rawItems !== "" ? { items: count(rawItems, a.line, `type ${code} item count`) } : {}) });
        }
        k = skipFunds(a.fields, k + 3, a.line).next;
      }
      i++;

      const drafts: BankLineDraft[] = [];
      while (i < recs.length && recs[i].code === "16") {
        const r = recs[i];
        transactions++;
        if (transactions > limits.maxDataRows) throw new IngestError("too_many_rows", `The file has more than ${limits.maxDataRows.toLocaleString("en-US")} transactions. Split it into smaller files.`);
        const code = typeCode(r.fields[0] ?? "", r.line);
        const amount = amountOf((r.fields[1] ?? "").trim(), r.line, "transaction amount", false);
        total += amount;
        const funds = skipFunds(r.fields, 2, r.line);
        const bankRef = (r.fields[funds.next] ?? "").trim();
        const customerRef = (r.fields[funds.next + 1] ?? "").trim();
        const narrative = r.fields.slice(funds.next + 2).join(",").trim();
        const n = smallInt(code);
        i++;
        if (n < 100) throw bad(r.line, `type code ${code} is a balance (status) code; it cannot be a transaction (16).`);
        if (n >= 700) {
          skipped.push({ sourceRow: r.line, status: code, reason: `Line ${r.line}: type code ${code} is a ${n >= 900 ? "bank-specific" : "loan"} code whose direction (credit or debit) Clearline cannot know; it was not read as a line.` });
          continue;
        }
        const ref = customerRef !== "" && customerRef !== "0" ? customerRef : bankRef !== "" ? bankRef : narrative;
        drafts.push({
          account,
          currency,
          valueDate: funds.valueDate ?? asOf,
          bookingDate: asOf,
          direction: n < 400 ? "credit" : "debit",
          amountMinor: amount,
          reference: ref,
          ...(narrative ? { narrative } : {}),
          ...(bankRef ? { bankReference: bankRef } : {}),
          ...(RETURN_CODES.has(code) ? { reversal: true as const } : {}),
          sourceFormat: "bai2",
          sourceRow: r.line,
        });
      }
      const t = recs[i];
      if (!t || t.code !== "49") throw bad(t?.line ?? recs[recs.length - 1].line, `the account that starts on line ${a.line} has no 49 account trailer where one is expected.`);
      const statedTotal = amountOf((t.fields[0] ?? "").trim(), t.line, "account control total", true);
      const statedRecords = count((t.fields[1] ?? "").trim(), t.line, "account record count");
      if (statedTotal !== total) throw bad(t.line, `the account control total is ${statedTotal} but the amounts in the account add up to ${total} (minor units). The file is incomplete or was changed.`);
      const actualRecords = physicalOf(aStart, i);
      if (statedRecords !== actualRecords) throw bad(t.line, `the account trailer counts ${statedRecords} records but the account has ${actualRecords}. The file is incomplete or was changed.`);
      accountTotalsSum += statedTotal;
      i++;

      // Balances and summaries: warnings, as for the other statement formats.
      const opening: StatedBalance | undefined = status03.has("010") ? { date: asOf, amountMinor: status03.get("010")!, currency } : undefined;
      const closing: StatedBalance | undefined = status03.has("015") ? { date: asOf, amountMinor: status03.get("015")!, currency } : undefined;
      let balanced: boolean | undefined;
      if (opening && closing) {
        const expected = expectedClosing(opening.amountMinor, drafts);
        balanced = expected === closing.amountMinor;
        if (!balanced) {
          warnings.push({ code: "balance_mismatch", row: t.line,
            message: `Account section on line ${a.line}: opening ledger ${formatMinor(opening.amountMinor, p)} plus the entries read gives ${formatMinor(expected, p)} ${currency}, but the closing ledger (015) is ${formatMinor(closing.amountMinor, p)} ${currency}.` });
        }
      } else {
        warnings.push({ code: "missing_balance", row: a.line, message: `Account section on line ${a.line} lacks an opening (010) or closing (015) ledger balance, so it cannot be checked.` });
      }
      for (const [code, dir, label] of [["100", "credit", "total credits"], ["400", "debit", "total debits"]] as const) {
        const s = summary.get(code);
        if (!s) continue;
        const lines = drafts.filter((d) => d.direction === dir);
        const sum = lines.reduce((x, d) => x + d.amountMinor, 0n);
        if (sum !== s.amount || (s.items !== undefined && s.items !== lines.length)) {
          warnings.push({ code: "bai2_summary_mismatch", row: a.line,
            message: `Account section on line ${a.line}: the ${label} summary (${code}) states ${formatMinor(s.amount, p)} ${currency}${s.items !== undefined ? ` in ${s.items} item(s)` : ""}, but the entries read give ${formatMinor(sum, p)} ${currency} in ${lines.length}.` });
        }
      }
      statements.push({ sourceFormat: "bai2", account, currency, ...(fileId ? { statementId: fileId } : {}), sequence: asOf, ...(opening ? { opening } : {}), ...(closing ? { closing } : {}), lines: [], ...(balanced !== undefined ? { balanced } : {}) });
      perStatement.push(drafts);
    }
    const gt = recs[i];
    if (!gt || gt.code !== "98") throw bad(gt?.line ?? recs[recs.length - 1].line, `the group that starts on line ${g.line} has no 98 group trailer where one is expected (found ${gt ? `a ${gt.code} record` : "the end of the file"}).`);
    const statedGroupTotal = amountOf((gt.fields[0] ?? "").trim(), gt.line, "group control total", true);
    const statedAccounts = count((gt.fields[1] ?? "").trim(), gt.line, "number of accounts");
    const statedGroupRecords = count((gt.fields[2] ?? "").trim(), gt.line, "group record count");
    if (statedGroupTotal !== accountTotalsSum) throw bad(gt.line, `the group control total is ${statedGroupTotal} but its account totals add up to ${accountTotalsSum}. The file is incomplete or was changed.`);
    if (statedAccounts !== accountsInGroup) throw bad(gt.line, `the group trailer counts ${statedAccounts} accounts but the group has ${accountsInGroup}. The file is incomplete or was changed.`);
    const actualGroupRecords = physicalOf(gStart, i);
    if (statedGroupRecords !== actualGroupRecords) throw bad(gt.line, `the group trailer counts ${statedGroupRecords} records but the group has ${actualGroupRecords}. The file is incomplete or was changed.`);
    groupTotalsSum += statedGroupTotal;
    i++;
  }
  const ft = recs[i];
  if (!ft || ft.code !== "99") throw bad(ft?.line ?? recs[recs.length - 1].line, `a 99 file trailer was expected here (found ${ft ? `a ${ft.code} record` : "the end of the file"}). The file is incomplete or out of order.`);
  if (i !== recs.length - 1) throw bad(recs[i + 1].line, "there are records after the 99 file trailer.");
  if (groups === 0) throw bad(ft.line, "the file has no groups (02 records).");
  const statedFileTotal = amountOf((ft.fields[0] ?? "").trim(), ft.line, "file control total", true);
  const statedGroups = count((ft.fields[1] ?? "").trim(), ft.line, "number of groups");
  const statedFileRecords = count((ft.fields[2] ?? "").trim(), ft.line, "file record count");
  if (statedFileTotal !== groupTotalsSum) throw bad(ft.line, `the file control total is ${statedFileTotal} but its group totals add up to ${groupTotalsSum}. The file is incomplete or was changed.`);
  if (statedGroups !== groups) throw bad(ft.line, `the file trailer counts ${statedGroups} groups but the file has ${groups}. The file is incomplete or was changed.`);
  const actualFileRecords = physicalOf(0, i);
  if (statedFileRecords !== actualFileRecords) throw bad(ft.line, `the file trailer counts ${statedFileRecords} records but the file has ${actualFileRecords}. The file is incomplete or was changed.`);

  if (skipped.length) warnings.push({ code: "entries_not_read", message: `${skipped.length} transaction${skipped.length === 1 ? " has a type code" : "s have type codes"} without a known direction and ${skipped.length === 1 ? "was" : "were"} not read as lines.` });
  const lines = assignLineIds(perStatement.flat());
  let n = 0;
  perStatement.forEach((d, j) => { statements[j].lines = lines.slice(n, n + d.length); n += d.length; });
  return { sourceFormat: "bai2", statements, lines, skipped, warnings };
}
