/**
 * ISO 20022 camt.053 (BankToCustomerStatement) and camt.054 (BankToCustomerDebitCreditNotification) → normalised bank
 * lines; versions .001.02 and .001.08 (others are read with a warning). Both messages share the entry (Ntry) shape,
 * so one reader serves both; camt053.ts and camt054.ts hold each message's own rules.
 *
 * XML safety: a document with a DOCTYPE, ENTITY, ELEMENT or ATTLIST declaration is refused before parsing, and the
 * parser runs with entity processing off, so no internal or external entity is ever expanded (no XXE, no
 * "billion laughs"). Elements nested deeper than MAX_XML_DEPTH are refused before parsing (no stack exhaustion). The
 * five predefined XML entities and numeric character references are decoded afterwards by a fixed table.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { formatMinor, parseAmount } from "../decimal";
import { IngestError, type IngestWarning } from "../errors";
import { checkFileSize, resolveLimits, type IngestLimits } from "../limits";
import { decodeText } from "../sniff";
import { currencyPrecision } from "./currency";
import { assignLineIds, expectedClosing, type BankLineDraft, type BankParseResult, type BankSourceFormat, type BankStatement, type SkippedEntry, type StatedBalance } from "./types";

type Node = Record<string, unknown>;

const ARRAYS = new Set(["Stmt", "Ntfctn", "Bal", "Ntry", "NtryDtls", "TxDtls", "Ustrd"]);
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

/** Deeper nesting than any camt message needs (a camt.053/.054 entry is about 12 levels deep) is refused unparsed. */
export const MAX_XML_DEPTH = 64;

/** The deepest element nesting in the text, stopping as soon as `limit` is passed. Comments and CDATA are skipped. */
export function xmlDepthExceeds(xml: string, limit = MAX_XML_DEPTH): boolean {
  let depth = 0;
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)[A-Za-z_][^>]*?(\/?)>/g;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[0].startsWith("<!") || m[0].startsWith("<?")) continue;
    if (m[1] === "/") depth--;
    else if (m[2] !== "/" && ++depth > limit) return true;
  }
  return false;
}

/** What differs between camt.053 and camt.054; everything else (entries, amounts, references) is shared. */
export interface CamtSpec {
  format: Extract<BankSourceFormat, "camt053" | "camt054">;
  /** "053" or "054": the message number in the namespace urn:iso:std:iso:20022:tech:xsd:camt.NNN.001.VV. */
  message: "053" | "054";
  /** BkToCstmrStmt or BkToCstmrDbtCdtNtfctn, and its repeated child Stmt or Ntfctn. */
  root: string;
  item: "Stmt" | "Ntfctn";
  /** "statement" or "notification", in messages. */
  noun: string;
  invalid: "invalid_camt053" | "invalid_camt054";
  /** true: balances are expected (camt.053), so a missing one is a warning. false: notifications carry none. */
  expectBalances: boolean;
  /** true: a file whose items name more than one account is refused (an upload belongs to one bank account). */
  singleAccount: boolean;
}

export interface CamtOptions { limits?: Partial<IngestLimits> }

/** RvslInd: "true" or "1" marks an entry that reverses an earlier one (CdtDbtInd is still the direction of this entry). */
const isReversal = (ntry: unknown) => { const r = textAt(ntry, "RvslInd")?.trim().toLowerCase(); return r === "true" || r === "1"; };

export function parseCamt(input: Uint8Array | string, spec: CamtSpec, opts: CamtOptions = {}): BankParseResult {
  const limits = resolveLimits(opts.limits);
  const warnings: IngestWarning[] = [];
  const name = `camt.${spec.message}`;
  const Noun = spec.noun[0].toUpperCase() + spec.noun.slice(1);
  let xml: string;
  if (typeof input === "string") xml = input;
  else {
    checkFileSize(input, limits);
    const d = decodeText(input);
    xml = d.text;
    warnings.push(...d.warnings);
  }
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(xml)) {
    throw new IngestError("unsafe_xml", "The XML file declares a DOCTYPE or entities, which bank statements never need; it was refused for safety.");
  }
  if (xmlDepthExceeds(xml)) throw new IngestError("unsafe_xml", `The XML file nests elements more than ${MAX_XML_DEPTH} levels deep, which bank statements never need; it was refused for safety.`);
  // v1 phase 2.1 (fuzzing): the XML library throws plain Errors on some malformed input (an unclosed processing
  // instruction, nesting beyond its limit); every such failure is a refused file, never a crash
  let doc: Node;
  try {
    const valid = XMLValidator.validate(xml);
    if (valid !== true) throw new IngestError(spec.invalid, `The file is not well-formed XML (line ${valid.err.line}: ${valid.err.msg}).`, { row: valid.err.line });
    doc = parser.parse(xml) as Node;
  } catch (e) {
    if (e instanceof IngestError) throw e;
    throw new IngestError(spec.invalid, "The file is not well-formed XML, or nests elements too deeply for a bank statement.");
  }
  const document = node(doc["Document"]);
  // removeNSPrefix drops xmlns attributes, so the namespace is read from the root tag itself.
  const ns = new RegExp(`<(?:[\\w.-]+:)?Document\\b[^>]*?\\sxmlns(?::[\\w.-]+)?\\s*=\\s*["']urn:iso:std:iso:20022:tech:xsd:camt\\.${spec.message}\\.001\\.(\\d{2})["']`);
  const version = ns.exec(xml)?.[1];
  if (!document || !version) throw new IngestError(spec.invalid, `This XML is not a ${name} ${spec.message === "053" ? "bank-to-customer statement" : "debit/credit notification"} (no ${name} Document namespace).`);
  if (!SUPPORTED_VERSIONS.has(version)) warnings.push({ code: "camt_version", message: `${name}.001.${version} is read as if it were .001.08; check the result.` });
  const itemsRaw = list(path(document, spec.root, spec.item));
  if (itemsRaw.length === 0) throw new IngestError(spec.invalid, `The ${name} file has no ${spec.noun}s (${spec.item}).`);

  const statements: BankStatement[] = [];
  const perStatement: BankLineDraft[][] = [];
  const skipped: SkippedEntry[] = [];
  let entryNo = 0;
  for (const stmt of itemsRaw) {
    const statementId = textAt(stmt, "Id");
    const account = textAt(stmt, "Acct", "Id", "IBAN") ?? textAt(stmt, "Acct", "Id", "Othr", "Id");
    if (!account) throw new IngestError(spec.invalid, `${Noun} ${statementId ?? "(no Id)"} has no account (Acct/Id/IBAN or Othr/Id).`);
    if (spec.singleAccount && statements.length && statements.some((x) => x.account !== account)) {
      const n = new Set([...statements.map((x) => x.account), account]).size;
      throw new IngestError("multiple_accounts", `The ${name} file covers at least ${n} different bank accounts; an upload belongs to one bank account. Ask the bank for one file per account, or split it, and upload each to its account.`);
    }
    const balances = list(path(stmt, "Bal"));
    const findBal = (...codes: string[]) => balances.find((b) => codes.includes(textAt(b, "Tp", "CdOrPrtry", "Cd") ?? ""));
    const currency = textAt(stmt, "Acct", "Ccy") ?? text(path(findBal("OPBD", "CLBD"), "Amt", "@_Ccy"));
    if (!currency) throw new IngestError(spec.invalid, `${Noun} ${statementId ?? ""} for ${account} has no currency (Acct/Ccy).`);
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
      if (r.value < 0n) throw new IngestError("invalid_amount", `${where}: ${name} amounts are unsigned; the sign is CdtDbtInd.`);
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
      if (indicator !== "CRDT" && indicator !== "DBIT") throw new IngestError(spec.invalid, `${where}: CdtDbtInd must be CRDT or DBIT.`);
      const direction = indicator === "CRDT" ? "credit" : "debit";
      const valueDate = dateOf(path(ntry, "ValDt")) ?? dateOf(path(ntry, "BookgDt"));
      if (!valueDate) throw new IngestError(spec.invalid, `${where} has no value or booking date.`);
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
        ...(isReversal(ntry) ? { reversal: true as const } : {}),
        sourceFormat: spec.format,
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
          message: `${Noun} ${statementId ?? ""} for ${account}: opening ${formatMinor(opening.amountMinor, p)} plus the booked entries gives ${formatMinor(expected, p)} ${currency}, but the closing balance (CLBD) is ${formatMinor(closing.amountMinor, p)} ${currency}.`,
        });
      }
    } else if (spec.expectBalances) {
      warnings.push({ code: "missing_balance", message: `${Noun} ${statementId ?? ""} for ${account} lacks an opening (OPBD) or closing (CLBD) balance, so it cannot be checked.` });
    }
    const sequence = textAt(stmt, "ElctrncSeqNb");
    statements.push({ sourceFormat: spec.format, account, currency, ...(statementId ? { statementId } : {}), ...(sequence ? { sequence } : {}), ...(opening ? { opening } : {}), ...(closing ? { closing } : {}), lines: [], ...(balanced !== undefined ? { balanced } : {}) });
    perStatement.push(drafts);
  }
  if (!spec.expectBalances && statements.every((x) => x.balanced === undefined)) {
    warnings.push({ code: "no_balances", message: `A ${name} ${spec.noun} carries no opening or closing balance, so its entries cannot be checked against one.` });
  }
  if (skipped.length) warnings.push({ code: "entries_not_booked", message: `${skipped.length} entr${skipped.length === 1 ? "y is" : "ies are"} not booked (pending or information only) and ${skipped.length === 1 ? "was" : "were"} not read as lines.` });
  const lines = assignLineIds(perStatement.flat());
  let k = 0;
  perStatement.forEach((d, i) => { statements[i].lines = lines.slice(k, k + d.length); k += d.length; });
  return { sourceFormat: spec.format, statements, lines, skipped, warnings };
}
