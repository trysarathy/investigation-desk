/**
 * ISO 20022 camt.053 (BankToCustomerStatement) → normalised bank lines; versions .001.02 and .001.08 (others are read
 * with a warning). XML safety: a document with a DOCTYPE or ENTITY declaration is refused before parsing, and the
 * parser runs with entity processing off, so no internal or external entity is ever expanded (no XXE, no
 * "billion laughs"). The five predefined XML entities and numeric character references are decoded afterwards by a
 * fixed table.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { formatMinor, parseAmount } from "../decimal";
import { IngestError, type IngestWarning } from "../errors";
import { checkFileSize, resolveLimits, type IngestLimits } from "../limits";
import { decodeText } from "../sniff";
import { currencyPrecision } from "./currency";
import { assignLineIds, expectedClosing, type BankLineDraft, type BankParseResult, type BankStatement, type SkippedEntry, type StatedBalance } from "./types";

type Node = Record<string, unknown>;

const ARRAYS = new Set(["Stmt", "Bal", "Ntry", "NtryDtls", "TxDtls", "Ustrd"]);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => ARRAYS.has(name),
});

const PREDEFINED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const cp = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
    }
    return PREDEFINED[ref] ?? whole;
  });
}

const node = (v: unknown): Node | undefined => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Node) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
/** Text content of an element (a bare string, or {"#text": ...} when it has attributes). */
function text(v: unknown): string | undefined {
  if (typeof v === "string") return decodeEntities(v);
  const n = node(v);
  return n && typeof n["#text"] === "string" ? decodeEntities(n["#text"]) : undefined;
}
const path = (v: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((cur, k) => node(cur)?.[k], v);
const textAt = (v: unknown, ...keys: string[]) => text(path(v, ...keys));

/** Dt or DtTm → YYYY-MM-DD as written. */
function dateOf(v: unknown): string | undefined {
  const d = textAt(v, "Dt") ?? textAt(v, "DtTm");
  const m = d ? /^(\d{4}-\d{2}-\d{2})/.exec(d) : null;
  return m ? m[1] : undefined;
}

/** .02: <Sts>BOOK</Sts>. .08: <Sts><Cd>BOOK</Cd></Sts>. */
const statusOf = (ntry: unknown) => text(path(ntry, "Sts")) ?? textAt(ntry, "Sts", "Cd") ?? textAt(ntry, "Sts", "Prtry");

/** RltdPties party name: .02 Dbtr/Nm, .08 Dbtr/Pty/Nm (same for Cdtr). */
function partyName(tx: unknown, role: "Dbtr" | "Cdtr"): string | undefined {
  return textAt(tx, "RltdPties", role, "Nm") ?? textAt(tx, "RltdPties", role, "Pty", "Nm");
}

const SUPPORTED_VERSIONS = new Set(["02", "08"]);

export interface Camt053Options { limits?: Partial<IngestLimits> }

export function parseCamt053(input: Uint8Array | string, opts: Camt053Options = {}): BankParseResult {
  const limits = resolveLimits(opts.limits);
  const warnings: IngestWarning[] = [];
  let xml: string;
  if (typeof input === "string") xml = input;
  else {
    checkFileSize(input, limits);
    const d = decodeText(input);
    xml = d.text;
    warnings.push(...d.warnings);
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new IngestError("unsafe_xml", "The XML file declares a DOCTYPE or entities, which bank statements never need; it was refused for safety.");
  }
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new IngestError("invalid_camt053", `The file is not well-formed XML (line ${valid.err.line}: ${valid.err.msg}).`, { row: valid.err.line });
  const doc = parser.parse(xml) as Node;
  const document = node(doc["Document"]);
  // removeNSPrefix drops xmlns attributes, so the namespace is read from the root tag itself.
  const version = /<(?:[\w.-]+:)?Document\b[^>]*?\sxmlns(?::[\w.-]+)?\s*=\s*["']urn:iso:std:iso:20022:tech:xsd:camt\.053\.001\.(\d{2})["']/.exec(xml)?.[1];
  if (!document || !version) throw new IngestError("invalid_camt053", "This XML is not a camt.053 bank-to-customer statement (no camt.053 Document namespace).");
  if (!SUPPORTED_VERSIONS.has(version)) warnings.push({ code: "camt_version", message: `camt.053.001.${version} is read as if it were .001.08; check the result.` });
  const statementsRaw = list(path(document, "BkToCstmrStmt", "Stmt"));
  if (statementsRaw.length === 0) throw new IngestError("invalid_camt053", "The camt.053 file has no statements (Stmt).");

  const statements: BankStatement[] = [];
  const perStatement: BankLineDraft[][] = [];
  const skipped: SkippedEntry[] = [];
  let entryNo = 0;
  for (const stmt of statementsRaw) {
    const statementId = textAt(stmt, "Id");
    const account = textAt(stmt, "Acct", "Id", "IBAN") ?? textAt(stmt, "Acct", "Id", "Othr", "Id");
    if (!account) throw new IngestError("invalid_camt053", `Statement ${statementId ?? "(no Id)"} has no account (Acct/Id/IBAN or Othr/Id).`);
    const balances = list(path(stmt, "Bal"));
    const findBal = (...codes: string[]) => balances.find((b) => codes.includes(textAt(b, "Tp", "CdOrPrtry", "Cd") ?? ""));
    const currency = textAt(stmt, "Acct", "Ccy") ?? text(path(findBal("OPBD", "CLBD"), "Amt", "@_Ccy"));
    if (!currency) throw new IngestError("invalid_camt053", `Statement ${statementId ?? ""} for ${account} has no currency (Acct/Ccy).`);
    const precision = currencyPrecision(currency);
    if (!precision.ok) throw new IngestError("unknown_currency", precision.message);

    const money = (amt: unknown, where: string): { minor: bigint; ccy: string } => {
      const value = text(amt);
      const ccy = node(amt)?.["@_Ccy"];
      const c = typeof ccy === "string" ? ccy : currency;
      const p = currencyPrecision(c);
      if (!p.ok) throw new IngestError("unknown_currency", `${where}: ${p.message}`);
      const r = value === undefined ? undefined : parseAmount(value, { precision: p.value });
      if (!r || !r.ok) throw new IngestError("invalid_amount", `${where}: ${r ? r.message : "the amount is missing."}`);
      if (r.value < 0n) throw new IngestError("invalid_amount", `${where}: camt.053 amounts are unsigned; the sign is CdtDbtInd.`);
      return { minor: r.value, ccy: c };
    };
    const stated = (b: unknown, code: string): StatedBalance | undefined => {
      if (!b) return undefined;
      const { minor, ccy } = money(path(b, "Amt"), `Balance ${code}`);
      const sign = textAt(b, "CdtDbtInd") === "DBIT" ? -1n : 1n;
      return { date: dateOf(path(b, "Dt")) ?? "", amountMinor: sign * minor, currency: ccy };
    };
    const opening = stated(findBal("OPBD", "PRCD"), "OPBD");
    const closing = stated(findBal("CLBD"), "CLBD");

    const drafts: BankLineDraft[] = [];
    for (const ntry of list(path(stmt, "Ntry"))) {
      entryNo++;
      if (entryNo > limits.maxDataRows) throw new IngestError("too_many_rows", `The file has more than ${limits.maxDataRows.toLocaleString("en-US")} entries. Split it into smaller files.`);
      const status = statusOf(ntry) ?? "";
      if (status !== "BOOK") {
        skipped.push({ sourceRow: entryNo, status, reason: status ? `Entry ${entryNo} has status ${status}; only booked (BOOK) entries are statement lines.` : `Entry ${entryNo} has no status; only booked (BOOK) entries are statement lines.` });
        continue;
      }
      const where = `Entry ${entryNo}`;
      const { minor, ccy } = money(path(ntry, "Amt"), where);
      const indicator = textAt(ntry, "CdtDbtInd");
      if (indicator !== "CRDT" && indicator !== "DBIT") throw new IngestError("invalid_camt053", `${where}: CdtDbtInd must be CRDT or DBIT.`);
      const direction = indicator === "CRDT" ? "credit" : "debit";
      const valueDate = dateOf(path(ntry, "ValDt")) ?? dateOf(path(ntry, "BookgDt"));
      if (!valueDate) throw new IngestError("invalid_camt053", `${where} has no value or booking date.`);
      const bookingDate = dateOf(path(ntry, "BookgDt"));
      const txs = list(path(ntry, "NtryDtls")).flatMap((d) => list(path(d, "TxDtls")));
      const endToEnd = txs.map((t) => textAt(t, "Refs", "EndToEndId")).filter((r): r is string => !!r && r.toUpperCase() !== "NOTPROVIDED");
      const ustrd = txs.flatMap((t) => list(path(t, "RmtInf", "Ustrd")).map(text)).filter((s): s is string => !!s);
      const counterparty = txs.map((t) => partyName(t, direction === "credit" ? "Dbtr" : "Cdtr")).find((n) => !!n);
      const narrative = ustrd.join(" ") || textAt(ntry, "AddtlNtryInf");
      const bankReference = textAt(ntry, "AcctSvcrRef") ?? txs.map((t) => textAt(t, "Refs", "AcctSvcrRef")).find((r) => !!r);
      const ntryRef = textAt(ntry, "NtryRef");
      if (ccy !== currency) warnings.push({ code: "entry_currency_differs", message: `${where} is in ${ccy}, but the account is in ${currency}.`, row: entryNo });
      drafts.push({
        account,
        currency: ccy,
        valueDate,
        ...(bookingDate ? { bookingDate } : {}),
        direction,
        amountMinor: minor,
        reference: endToEnd.join("; ") || narrative || ntryRef || "",
        ...(narrative ? { narrative } : {}),
        ...(counterparty ? { counterparty } : {}),
        ...(bankReference ? { bankReference } : {}),
        sourceFormat: "camt053",
        sourceRow: entryNo,
      });
    }

    let balanced: boolean | undefined;
    const p = precision.value;
    if (opening && closing) {
      const expected = expectedClosing(opening.amountMinor, drafts.filter((d) => d.currency === currency));
      balanced = expected === closing.amountMinor;
      if (!balanced) {
        warnings.push({
          code: "balance_mismatch",
          message: `Statement ${statementId ?? ""} for ${account}: opening ${formatMinor(opening.amountMinor, p)} plus the booked entries gives ${formatMinor(expected, p)} ${currency}, but the closing balance (CLBD) is ${formatMinor(closing.amountMinor, p)} ${currency}.`,
        });
      }
    } else {
      warnings.push({ code: "missing_balance", message: `Statement ${statementId ?? ""} for ${account} lacks an opening (OPBD) or closing (CLBD) balance, so it cannot be checked.` });
    }
    const sequence = textAt(stmt, "ElctrncSeqNb");
    statements.push({ sourceFormat: "camt053", account, currency, ...(statementId ? { statementId } : {}), ...(sequence ? { sequence } : {}), ...(opening ? { opening } : {}), ...(closing ? { closing } : {}), lines: [], ...(balanced !== undefined ? { balanced } : {}) });
    perStatement.push(drafts);
  }
  if (skipped.length) warnings.push({ code: "entries_not_booked", message: `${skipped.length} entr${skipped.length === 1 ? "y is" : "ies are"} not booked (pending or information only) and ${skipped.length === 1 ? "was" : "were"} not read as lines.` });
  const lines = assignLineIds(perStatement.flat());
  let k = 0;
  perStatement.forEach((d, i) => { statements[i].lines = lines.slice(k, k + d.length); k += d.length; });
  return { sourceFormat: "camt053", statements, lines, skipped, warnings };
}
