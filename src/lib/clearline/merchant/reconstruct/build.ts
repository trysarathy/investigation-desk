/**
 * rc6 phase 10: Case Reconstruction. Turns one day of a provider's (anonymised) data into the reconstruction report:
 * per-item result, rule and deciding step, the bridge per batch, journal proposals (posting rule pending sign-off),
 * the fields that could not be mapped, and the questions to ask the provider.
 *
 * Pure: file names and bytes in, a report out. No file system, no network, no database, no clock, no randomness, so an
 * identical input gives a byte-identical report. Data goes in through the rc6 ingestion adapters and the rc5
 * bank-statement CSV rules, exactly as in the product; only the gap analysis around them is new here.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { decodeUtf8, parseCsv } from "../../../csv/parse";
import { parseStatementCsv } from "../../../csv/statement";
import { fmtFiat, sum } from "../amounts";
import { DEFAULT_POLICY, FIAT_DECIMALS, NETWORKS, TOKENS, normAddress } from "../config";
import { proposeJournals, MERCHANT_ACCOUNTS, type JournalProposal } from "../journal";
import { reconcile, type ReconcileResult } from "../reconcile";
import { JOURNAL_RULES, RULES } from "../rules";
import { IMPORTED_BANK_LINE_LABEL } from "../types";
import type { AddressFact, BankLine, Decision, DifferenceType, FiatCurrency, MerchantEntity, MerchantPolicy, NetworkId, ReconcileInput, TimeZoneRef } from "../types";
import { assembleInput } from "../adapters/fixture-sources";
import { readChainTransfers, type ChainClient, type ChainHead } from "../adapters/chain";
import { fromUnits, toUnits, type ItemError } from "../adapters/common";
import { readFxRates } from "../adapters/fx";
import { PROVIDER_FIELDS, readProviderExport, type ProviderExportResult, type ProviderField } from "../adapters/provider-export";
import { readSettlementReports, type SettlementResult } from "../adapters/settlement";
import {
  POSTING_RULE_PENDING, REAL_LABEL, RECONSTRUCTION_FORMAT, SAMPLE_LABEL,
  type ReconstructionReport, type ReportBridge, type ReportFigure, type ReportItem, type ReportJournal, type ReportOutcome, type ReportQuestion,
  type ReportRejected, type ReportUnmappable,
} from "./types";

export interface InputFile { name: string; bytes: Uint8Array }
export interface ReconstructOptions {
  /** True only for the bundled sample (decided by the caller from its location, never from the data). */
  sample: boolean;
  generatedAt?: string | null;
  /** The column mapping given with --mapping; otherwise mapping.json in the input. */
  mapping?: InputFile | null;
}
interface EngineRun { input: ReconcileInput; result: ReconcileResult; journals: JournalProposal[] }
export interface Reconstruction { report: ReconstructionReport; engine: EngineRun; bankConfirmed: EngineRun }

/** The files of one day, by role. Anything else in the input directory is listed as not read. */
export const INPUT_FILES = {
  day: ["day.json"], mapping: ["mapping.json"], export: ["provider-export.csv", "provider-export.json"], settlement: ["settlement.json"],
  bank: ["bank-lines.csv"], chain: ["chain.json"], fx: ["fx.json"], invoices: ["invoices.csv", "invoices.json"], quotes: ["quotes.csv", "quotes.json"],
} as const;
type Role = keyof typeof INPUT_FILES;
const ROLE_TEXT: Record<Role, string> = {
  day: "day and entity", mapping: "column mapping", export: "provider export", settlement: "settlement report", bank: "bank lines (rc5 statement CSV)",
  chain: "chain transfers (recorded)", fx: "FX rates", invoices: "invoices", quotes: "quotes",
};
/** [ASSUMPTION] a day's provider export fits in 20 MiB; the rc5 statement rules cap bank lines at 1 MiB / 200 lines. */
export const MAX_INPUT_BYTES = 20 * 1_048_576;

const FIELD_TEXT: Record<ProviderField, string> = {
  orderId: "order ID", orderAmount: "order amount", orderCurrency: "order currency", quoteId: "quote ID", quoteNetwork: "network",
  quoteTokenContract: "token contract", quoteDepositAddress: "deposit address", quotedAmount: "quoted amount", quoteRate: "quote rate",
  quoteRateSource: "rate source", quoteRateAt: "rate time", quoteCreatedAt: "quote creation time", quoteExpiresAt: "quote expiry time",
  linkId: "payment link ID", linkKind: "payment link kind", linkNetwork: "payment link network", linkTokenContract: "payment link token contract",
  linkDepositAddress: "payment link deposit address", linkRequestedAmount: "payment link amount", linkCreatedAt: "payment link creation time",
  linkExpiresAt: "payment link expiry time", providerPaymentId: "provider payment ID", txHash: "transaction hash", logIndex: "log index",
  statusClaim: "payment status", displayedStatus: "dashboard status", receivedAmount: "received amount", creditedAmount: "credited amount",
  executedRate: "executed rate", feeAmount: "fee", batchId: "settlement batch ID",
};
const REQUIRED_ON_RECORD: readonly ProviderField[] = [
  "orderId", "orderAmount", "orderCurrency", "quoteId", "quoteNetwork", "quoteTokenContract", "quoteDepositAddress", "quotedAmount", "quoteRate",
  "quoteRateSource", "quoteRateAt", "quoteCreatedAt", "quoteExpiresAt",
];
const REQUIRED_ON_PAYMENT: readonly ProviderField[] = ["statusClaim", "receivedAmount", "creditedAmount", "executedRate"];
const LINK_FIELDS: readonly ProviderField[] = ["linkKind", "linkNetwork", "linkTokenContract", "linkDepositAddress", "linkRequestedAmount", "linkCreatedAt", "linkExpiresAt"];
const CLAIMS = ["paid", "underpaid", "overpaid", "held_for_review", "re_quoted", "partially_paid", "pending"];
const QUOTE_FIELDS = PROVIDER_FIELDS.filter((f) => f.startsWith("quote"));
const INVOICE_FIELDS: readonly ProviderField[] = ["orderAmount", "orderCurrency"];

const SETTLEMENT_KEYS = {
  top: ["batches", "lines", "totals", "label", "currency"],
  batches: ["batchId", "providerDay", "providerTimeZone", "currency", "targetBankAccount", "gross", "fees", "refunds", "net"],
  lines: ["batchId", "kind", "providerPaymentId", "refundId", "orderId", "amount"],
  totals: ["providerDay", "providerTimeZone", "currency", "targetBankAccount", "gross", "fees", "refunds", "net"],
} as const;

export const DECISION_TEXT: Record<Decision, string> = {
  matched: "Matched", matched_with_difference: "Matched with a difference", suggested_for_review: "Suggested for review", exception: "Exception",
};
export const DIFFERENCE_TEXT: Record<DifferenceType, string> = {
  sender_side_fee: "Fee taken on the sender's side", underpayment: "Underpayment", overpayment: "Overpayment",
  requote_after_expiry: "Re-quote after the quote expired", rate_difference: "Rate difference", provider_fee: "Provider fee",
  refund_netted: "Refund netted from the settlement", timing_prior_batch: "Settled in the prior batch", timing_next_batch: "Next-day order in this batch",
  held_by_provider: "Held by the provider", partial_payment_open: "Part paid, balance open", unexplained: "Unexplained",
};
const JOURNAL_KIND_TEXT: Record<JournalProposal["kind"], string> = { provider_confirmation: "Provider confirmation", approved_writeoff: "Write-off (after approval)", settlement: "Settlement" };
const ruleText = (id: string): string => (RULES as Record<string, { text: string }>)[id]?.text ?? (JOURNAL_RULES as Record<string, { text: string }>)[id]?.text ?? "";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hex = (b: Uint8Array) => bytesToHex(sha256(b));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Collects gaps in a fixed order, so the same input always gives the same questions. */
class Gaps {
  unmappable: ReportUnmappable[] = [];
  questions: ReportQuestion[] = [];
  rejected: ReportRejected[] = [];
  notes: string[] = [];
  assumptions: string[] = [];
  ask(id: string, text: string, because: string) { if (!this.questions.some((q) => q.id === id)) this.questions.push({ id, text, because }); }
  reject(errors: readonly ItemError[], source?: string) { for (const e of errors) this.rejected.push({ source: source ?? e.source, row: e.row, code: e.code, reason: e.reason }); }
}

function decode(f: InputFile, gaps: Gaps): string | null {
  const d = decodeUtf8(f.bytes);
  if (d.text === undefined) { gaps.rejected.push({ source: f.name, row: null, code: "invalid_utf8", reason: `${f.name} is not valid UTF-8 and was not read.` }); return null; }
  return d.text.startsWith("﻿") ? d.text.slice(1) : d.text;
}
function json(f: InputFile, gaps: Gaps): unknown {
  const t = decode(f, gaps);
  if (t === null) return undefined;
  try { return JSON.parse(t); } catch (e) {
    gaps.rejected.push({ source: f.name, row: null, code: "malformed", reason: `${f.name} is not valid JSON (${e instanceof Error ? e.message : String(e)}).` });
    return undefined;
  }
}
/** A CSV or JSON table; `lines[i]` is row i's physical CSV line (header = 1) or its JSON record number. */
function table(f: InputFile, gaps: Gaps): { columns: string[]; rows: Record<string, string>[]; lines: number[] } | null {
  if (f.name.endsWith(".csv")) {
    const t = decode(f, gaps);
    if (t === null) return null;
    const csv = parseCsv(t);
    if (csv.fileErrors.length) { gaps.rejected.push({ source: f.name, row: null, code: "unreadable_csv", reason: csv.fileErrors.join(" ") }); return null; }
    for (const e of csv.recordErrors) gaps.rejected.push({ source: f.name, row: e.line, code: "malformed", reason: e.message });
    const rows: Record<string, string>[] = [];
    const lines: number[] = [];
    for (const r of csv.records) {
      if (r.cells.length !== csv.header.length) { gaps.rejected.push({ source: f.name, row: r.line, code: "malformed", reason: `expected ${csv.header.length} cells, found ${r.cells.length}` }); continue; }
      rows.push(Object.fromEntries(csv.header.map((h, i) => [h, r.cells[i]])));
      lines.push(r.line);
    }
    return { columns: [...csv.header], rows, lines };
  }
  const raw = json(f, gaps);
  if (raw === undefined) return null;
  const arr = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.records) ? raw.records : null;
  if (!arr) { gaps.rejected.push({ source: f.name, row: null, code: "malformed", reason: `${f.name} must be an array of records or an object with "records".` }); return null; }
  const columns: string[] = [];
  const rows: Record<string, string>[] = [];
  const lines: number[] = [];
  arr.forEach((v, i) => {
    if (!isObj(v)) { gaps.rejected.push({ source: f.name, row: i + 1, code: "malformed", reason: "expected an object" }); return; }
    const row: Record<string, string> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!columns.includes(k)) columns.push(k);
      if (x === null || x === undefined) continue;
      if (typeof x === "string" || typeof x === "number") row[k] = String(x);
      else gaps.rejected.push({ source: f.name, row: i + 1, code: "malformed", reason: `${k} must be text` });
    }
    rows.push(row);
    lines.push(i + 1);
  });
  return { columns, rows, lines };
}

interface DayConfig { provider?: string; day?: string; entity?: MerchantEntity; addressFacts: AddressFact[]; policy: MerchantPolicy }
const NET_IDS: readonly string[] = NETWORKS.map((n) => n.network);
const FACTS = ["registered_wallet", "intermediate_wallet", "exchange_hot_wallet", "unknown"];

function dayConfig(raw: unknown, gaps: Gaps): DayConfig {
  const out: DayConfig = { addressFacts: [], policy: { ...DEFAULT_POLICY } };
  if (raw === undefined) return out;
  if (!isObj(raw)) { gaps.rejected.push({ source: "day.json", row: null, code: "malformed", reason: "day.json must be an object." }); return out; }
  if (typeof raw.provider === "string" && raw.provider.trim()) out.provider = raw.provider.slice(0, 120);
  if (typeof raw.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day)) out.day = raw.day;
  const e = raw.entity;
  if (isObj(e)) {
    const cur = e.functionalCurrency;
    const tz = e.timeZone;
    if (typeof e.id === "string" && typeof e.name === "string" && (cur === "SGD" || cur === "USD" || cur === "AED") && isObj(tz) && typeof tz.name === "string"
      && Number.isInteger(tz.utcOffsetMinutes) && Math.abs(tz.utcOffsetMinutes as number) <= 840) {
      out.entity = { id: e.id.slice(0, 64), name: e.name.slice(0, 200), functionalCurrency: cur, ledger: typeof e.ledger === "string" ? e.ledger.slice(0, 64) : "LEDGER-RECON", timeZone: { name: tz.name.slice(0, 64), utcOffsetMinutes: tz.utcOffsetMinutes as number } };
    } else gaps.rejected.push({ source: "day.json", row: null, code: "invalid", reason: "entity needs id, name, functionalCurrency (SGD, USD or AED) and timeZone { name, utcOffsetMinutes }; it was not used." });
  }
  if (Array.isArray(raw.addressFacts)) raw.addressFacts.forEach((f, i) => {
    if (isObj(f) && typeof f.network === "string" && NET_IDS.includes(f.network) && typeof f.address === "string" && typeof f.fact === "string" && FACTS.includes(f.fact))
      out.addressFacts.push({ network: f.network as NetworkId, address: f.address, fact: f.fact as AddressFact["fact"] });
    else gaps.rejected.push({ source: "day.json", row: i + 1, code: "invalid", reason: "an address fact needs network, address and fact" });
  });
  const p = raw.policy;
  if (isObj(p)) {
    // The imported-bank-line policy is never set from input: it stays with the founder (default off).
    const cur = out.entity?.functionalCurrency ?? "USD";
    try {
      if (p.tolerancePct !== undefined) { if (!Number.isInteger(p.tolerancePct) || (p.tolerancePct as number) < 0 || (p.tolerancePct as number) > 10_000) throw new Error("tolerancePct is basis points 0–10000"); out.policy.tolerancePct = p.tolerancePct as number; }
      if (typeof p.toleranceAbs === "string") out.policy.toleranceAbsMinor = toUnits(p.toleranceAbs, FIAT_DECIMALS[cur], "toleranceAbs");
      if (typeof p.writeOffThreshold === "string") out.policy.writeoffThresholdMinor = toUnits(p.writeOffThreshold, FIAT_DECIMALS[cur], "writeOffThreshold");
      if (typeof p.senderFeeBound === "string") out.policy.senderFeeBoundBaseUnits = toUnits(p.senderFeeBound, 6, "senderFeeBound");
    } catch (err) { gaps.rejected.push({ source: "day.json", row: null, code: "invalid", reason: `policy: ${err instanceof Error ? err.message : String(err)}; the default applies.` }); out.policy = { ...DEFAULT_POLICY }; }
  }
  return out;
}

/** Map the export through the provider's column mapping into canonical fields, recording every gap on the way. */
function mapExport(tbl: { columns: string[]; rows: Record<string, string>[] }, mappingRaw: unknown, gaps: Gaps): { provider: string | null; rows: Record<string, string>[] } {
  const SRC = "provider export";
  let columns: Record<string, ProviderField> = {};
  let provider: string | null = null;
  if (mappingRaw === undefined) {
    gaps.unmappable.push({ source: "mapping", field: "(all)", kind: "no_mapping", records: null, detail: "No column mapping was supplied (mapping.json or --mapping), so no export column could be read." });
    gaps.ask("no-mapping", "No column mapping was supplied — which export column holds each field (order, quote, deposit address, payment, transaction hash, batch)?", "Without a mapping no export column can be read.");
  } else if (!isObj(mappingRaw) || !isObj(mappingRaw.columns)) {
    gaps.rejected.push({ source: "mapping", row: null, code: "malformed", reason: "A mapping is { provider, columns: { \"source column\": \"field\" } }." });
  } else {
    if (typeof mappingRaw.provider === "string") provider = mappingRaw.provider.slice(0, 120);
    const seen = new Map<string, string>();
    for (const [col, target] of Object.entries(mappingRaw.columns)) {
      if (typeof target !== "string" || !(PROVIDER_FIELDS as readonly string[]).includes(target)) {
        gaps.unmappable.push({ source: "mapping", field: col, kind: "unknown_target", records: null, detail: `The mapping sends column "${col}" to ${JSON.stringify(target)}, which is not a field Clearline reads.` });
        continue;
      }
      if (seen.has(target)) { gaps.rejected.push({ source: "mapping", row: null, code: "invalid", reason: `${target} is mapped from both "${seen.get(target)}" and "${col}"; only the first is used.` }); continue; }
      seen.set(target, col);
      columns[col] = target as ProviderField;
    }
  }
  for (const [col, target] of Object.entries(columns)) {
    if (!tbl.columns.includes(col)) gaps.unmappable.push({ source: "mapping", field: col, kind: "mapped_column_absent", records: null, detail: `The mapping names column "${col}" (${FIELD_TEXT[target]}), but the export has no such column.` });
  }
  const unmapped = tbl.columns.filter((c) => !(c in columns));
  for (const c of unmapped) gaps.unmappable.push({ source: SRC, field: c, kind: "unmapped_column", records: null, detail: `Source column "${c}" has no mapping; its values are not read.` });
  if (unmapped.length && mappingRaw !== undefined)
    gaps.ask("unmapped-columns", `The export has ${plural(unmapped.length, "column")} with no mapping (${unmapped.join(", ")}) — what do they contain, and does any of them carry a field Clearline needs?`, "Unmapped columns are not read.");
  columns = Object.fromEntries(Object.entries(columns).filter(([c]) => tbl.columns.includes(c)));
  const rows = tbl.rows.map((r) => {
    const o: Record<string, string> = {};
    for (const [c, f] of Object.entries(columns)) if (r[c] !== undefined && r[c] !== "") o[f] = r[c];
    return o;
  });
  return { provider, rows };
}

/** Fill blanks from the merchant's invoices and the quotes file; a disagreement becomes a question. */
function mergeSupplements(rows: Record<string, string>[], invoices: Record<string, string>[] | null, quotes: Record<string, string>[] | null, gaps: Gaps) {
  if (invoices) {
    const byOrder = new Map(invoices.filter((r) => r.orderId).map((r) => [r.orderId, r]));
    for (const r of rows) {
      const inv = r.orderId ? byOrder.get(r.orderId) : undefined;
      if (!inv) continue;
      for (const f of INVOICE_FIELDS) {
        if (!inv[f]) continue;
        if (r[f] !== undefined && r[f] !== inv[f])
          gaps.ask(`invoice-${f}-${r.orderId}`, `Order ${r.orderId}: the export says ${FIELD_TEXT[f]} ${r[f]}, the merchant's invoice says ${inv[f]} — which did the customer agree to pay?`, "The merchant's invoice is used for accounts receivable.");
        r[f] = inv[f]; // [ASSUMPTION] the merchant's invoice is the truth for the receivable
      }
    }
    const exported = new Set(rows.map((r) => r.orderId));
    const missing = [...byOrder.keys()].filter((id) => !exported.has(id)).sort(cmp);
    if (missing.length) gaps.ask("invoices-without-record", `${plural(missing.length, "invoice")} have no record in the export (${missing.join(", ")}) — were they ever quoted or paid?`, "An invoice with no quote cannot be matched.");
  }
  if (quotes) {
    const byQuote = new Map(quotes.filter((r) => r.quoteId).map((r) => [r.quoteId, r]));
    for (const r of rows) {
      const q = r.quoteId ? byQuote.get(r.quoteId) : undefined;
      if (!q) continue;
      for (const f of QUOTE_FIELDS) {
        if (!q[f]) continue;
        if (r[f] === undefined) r[f] = q[f];
        else if (r[f] !== q[f]) gaps.ask(`quote-${f}-${r.quoteId}`, `Quote ${r.quoteId}: the export and the quotes file disagree on the ${FIELD_TEXT[f]} — which is right?`, "The export's value is used.");
      }
    }
  }
}

function exportGaps(rows: Record<string, string>[], gaps: Gaps) {
  const SRC = "provider export";
  const missing = (fields: readonly ProviderField[], rs: Record<string, string>[], qid: string, noun: string) => {
    for (const f of fields) {
      const n = rs.filter((r) => r[f] === undefined).length;
      if (!n) continue;
      gaps.unmappable.push({ source: SRC, field: f, kind: "missing_required", records: n, detail: `Required field ${FIELD_TEXT[f]} is missing on ${n} of ${plural(rs.length, noun)}.` });
      gaps.ask(`${qid}-${f}`, `No ${FIELD_TEXT[f]} on ${plural(n, noun)} — which field carries it?`, `A ${noun} without ${FIELD_TEXT[f]} is rejected.`);
    }
  };
  missing(REQUIRED_ON_RECORD, rows, "missing", "record");
  const payments = rows.filter((r) => r.providerPaymentId !== undefined);
  if (rows.length && !payments.length) {
    gaps.unmappable.push({ source: SRC, field: "providerPaymentId", kind: "missing_required", records: rows.length, detail: `No record carries a ${FIELD_TEXT.providerPaymentId}, so no payment can be read.` });
    gaps.ask("missing-providerPaymentId", `No ${FIELD_TEXT.providerPaymentId} on ${plural(rows.length, "record")} — which field carries it?`, "Without a payment ID nothing was paid as far as the export shows.");
  }
  missing(REQUIRED_ON_PAYMENT, payments, "missing-payment", "payment record");
  const links = rows.filter((r) => r.linkId !== undefined);
  missing(LINK_FIELDS, links, "missing-link", "payment link record");
  const noTx = payments.filter((r) => r.txHash === undefined || r.logIndex === undefined).length;
  if (noTx) {
    gaps.unmappable.push({ source: SRC, field: "txHash", kind: "missing_required", records: noTx, detail: `The transaction hash and log index are missing on ${noTx} of ${plural(payments.length, "payment record")}; without them a payment has no chain evidence.` });
    gaps.ask("missing-txHash", `No transaction hash on ${plural(noTx, "payment record")} — can the export include the transaction hash and log index for each payment?`, "A payment is evidenced only by its on-chain transfer.");
  }
  const odd = [...new Set(payments.map((r) => r.statusClaim).filter((s): s is string => !!s && !CLAIMS.includes(s)))].sort(cmp);
  for (const s of odd) gaps.ask(`status-${s}`, `Payment status "${s}" is not documented — what does it mean, and is it final?`, "Records with an unknown status are rejected.");
}

/** Strip settlement fields Clearline does not read (listed as unmappable) so the adapter reads the rest. */
function cleanSettlement(raw: unknown, gaps: Gaps): unknown {
  if (!isObj(raw)) return raw;
  const SRC = "settlement report";
  const out: Record<string, unknown> = {};
  const unknown = new Map<string, number>();
  for (const [k, v] of Object.entries(raw)) {
    if (!(SETTLEMENT_KEYS.top as readonly string[]).includes(k)) { unknown.set(k, (unknown.get(k) ?? 0) + 1); continue; }
    if ((k === "batches" || k === "lines" || k === "totals") && Array.isArray(v)) {
      const allowed: readonly string[] = SETTLEMENT_KEYS[k];
      out[k] = v.map((row) => {
        if (!isObj(row)) return row;
        const kept: Record<string, unknown> = {};
        for (const [rk, rv] of Object.entries(row)) {
          if (allowed.includes(rk)) kept[rk] = rv;
          else unknown.set(`${k}.${rk}`, (unknown.get(`${k}.${rk}`) ?? 0) + 1);
        }
        return kept;
      });
    } else out[k] = v;
  }
  const keys = [...unknown.keys()].sort(cmp);
  for (const k of keys) gaps.unmappable.push({ source: SRC, field: k, kind: "unmapped_column", records: unknown.get(k)!, detail: `Settlement field "${k}" is not read.` });
  if (keys.length) gaps.ask("settlement-unknown-fields", `The settlement report has ${plural(keys.length, "field")} Clearline does not read (${keys.join(", ")}) — what do they contain?`, "Unread fields cannot explain a difference.");
  return out;
}

function settlementGaps(raw: unknown, res: SettlementResult | null, gaps: Gaps) {
  if (!res) {
    gaps.ask("no-settlement", "No settlement report was supplied — can you export the day's settlement with batch IDs and per-payment lines?", "Without a settlement no batch can be bridged to the bank.");
    return;
  }
  if (res.shape === "totals_only" || res.shape === "mixed")
    gaps.ask("settlement-totals-only", "Settlement report has totals only — can you export per-payment lines with batch ID?", "Totals without lines can only be grouped by provider day, and a person must confirm the grouping.");
  const rows = isObj(raw) ? [...(Array.isArray(raw.batches) ? raw.batches : []), ...(Array.isArray(raw.totals) ? raw.totals : [])] : [];
  if (rows.length && rows.some((r) => !isObj(r) || r.providerTimeZone === undefined)) {
    gaps.assumptions.push("Provider day time zone not stated in the settlement report: UTC is assumed for the provider day.");
    gaps.ask("provider-timezone", "Provider day boundary/time zone not stated — which time zone and cut-off time define a settlement day?", "The bridge from the merchant's day to the provider's batch depends on it.");
  }
}

/** Recorded transfers from chain.json, served to the read-only chain adapter. No network. */
class FileChainClient implements ChainClient {
  readonly mode = "recorded" as const;
  constructor(private readonly transfers: unknown[]) {}
  async transfersTo(network: NetworkId, address: string): Promise<unknown[]> {
    const want = normAddress(network, address);
    return this.transfers.filter((t) => isObj(t) && t.network === network && typeof t.to === "string" && normAddress(network, t.to) === want);
  }
  async confirmations(): Promise<ChainHead | null> { return null; }
}

function bankLines(file: InputFile | undefined, currency: FiatCurrency, gaps: Gaps): BankLine[] {
  if (!file) { gaps.notes.push("No bank lines (bank-lines.csv) were supplied: no batch can tie to a bank credit."); return []; }
  const parsed = parseStatementCsv(file.bytes);
  if (!parsed.ok) {
    for (const e of parsed.errors) {
      if (e.code === "unknown_column") gaps.unmappable.push({ source: "bank lines", field: e.column ?? "", kind: "unmapped_column", records: null, detail: e.message });
      else if (e.code === "missing_column") gaps.unmappable.push({ source: "bank lines", field: e.column ?? "", kind: "missing_required", records: null, detail: e.message });
      else gaps.rejected.push({ source: file.name, row: e.row, code: e.code, reason: e.column ? `${e.column}: ${e.message}` : e.message });
    }
    gaps.notes.push(`bank-lines.csv does not meet the rc5 statement CSV rules (${plural(parsed.errorCount, "error")}); under those rules the whole file is refused, so no bank line was used.`);
    return [];
  }
  const lines: BankLine[] = [];
  let skipped = 0;
  for (const r of parsed.rows) {
    const l = r.line;
    // As the product's bankLinesFromImport: credits in the entity currency, reference as the description.
    if (l.direction !== "credit" || l.currency !== currency) { skipped++; continue; }
    lines.push({ bankLineId: l.lineId, account: l.accountRef, currency, valueDate: l.valueDate, amountMinor: BigInt(l.amountMinor), description: l.reference, source: "csv_import", provenance: `${IMPORTED_BANK_LINE_LABEL}: ${file.name} line ${r.row}` });
  }
  if (skipped) gaps.notes.push(`${plural(skipped, "bank line")} not used: only ${currency} credits can settle a batch.`);
  return lines;
}

// ---------- views ----------

const outcome = (r: ReconcileResult["records"][number]): ReportOutcome => ({
  result: r.explanation.decision, resultText: DECISION_TEXT[r.explanation.decision], rule: r.explanation.ruleId, decidingStep: r.explanation.decidingStep,
});

function journalView(j: JournalProposal): ReportJournal {
  return {
    id: j.id, kind: j.kind, kindText: JOURNAL_KIND_TEXT[j.kind], status: "proposed", postingRule: POSTING_RULE_PENDING, ruleId: j.ruleId, entryDate: j.entryDate,
    requiresApprovalOf: j.requiresApprovalOf ?? null, memo: j.memo,
    lines: j.lines.map((l) => ({ side: l.side, account: MERCHANT_ACCOUNTS[l.account], amount: fmtFiat(l.amountMinor, j.currency), orderId: l.orderId ?? null, batchId: l.batchId ?? null })),
  };
}

function figures(run: EngineRun, confirmed: EngineRun, cur: FiatCurrency): ReportFigure[] {
  const f = (r: EngineRun) => {
    const recs = r.result.records;
    return {
      orders: String(recs.length),
      invoiced: fmtFiat(sum(recs.map((x) => x.ledger.invoice.amountMinor)), cur),
      credited: fmtFiat(sum(recs.map((x) => x.ledger.creditedMinor)), cur),
      fees: fmtFiat(sum(r.result.bridges.map((b) => -(b.lines.find((l) => l.kind === "provider_fee")?.amountMinor ?? 0n))), cur),
      net: fmtFiat(sum(r.result.bridges.map((b) => b.lines.find((l) => l.kind === "net")?.amountMinor ?? 0n)), cur),
      owed: fmtFiat(sum(recs.map((x) => x.ledger.openBalanceMinor)), cur),
      liability: fmtFiat(sum(recs.map((x) => x.ledger.customerOverpaymentMinor)), cur),
      writeOffs: fmtFiat(sum(r.result.writeOffs.map((w) => w.amountMinor)), cur),
      exceptions: String(r.result.exceptions.length),
      verified: `${r.result.bridges.filter((b) => b.settlementVerified).length} of ${r.result.bridges.length}`,
    };
  };
  const a = f(run);
  const b = f(confirmed);
  const LABELS: [keyof typeof a, string, string?][] = [
    ["orders", "Orders"], ["invoiced", "Invoiced"], ["credited", "Credited by the provider"], ["fees", "Provider fees"],
    ["net", "Net bank credit (settlement report)"], ["owed", "Open on invoices", "Still owed by customers, before any write-off."],
    ["liability", "Customer overpayments (liability)"], ["writeOffs", "Write-offs proposed", "Each needs approval by a second person."],
    ["exceptions", "Exceptions"], ["verified", "Batches with verified settlement"],
  ];
  return LABELS.map(([key, label, note]) => ({ key, label, value: a[key], ...(b[key] !== a[key] ? { onceBankConfirmed: b[key] } : {}), ...(note ? { note } : {}) }));
}

const CHECK_TEXT: Record<keyof ReconcileResult["bridges"][number]["checks"], string> = {
  linesEqualGross: "Per-payment lines add up to the gross", bridgeEqualsGross: "Merchant-day bridge reaches the gross",
  grossLessFeesRefundsEqualsNet: "Gross − fees − refunds = net", netEqualsBankLine: "Net = the bank line", noUnexplained: "Nothing unexplained",
};

const tzText = (t: TimeZoneRef) => `${t.name} (UTC${t.utcOffsetMinutes < 0 ? "−" : "+"}${String(Math.floor(Math.abs(t.utcOffsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(t.utcOffsetMinutes) % 60).padStart(2, "0")})`;

// ---------- entry point ----------

export async function reconstructDay(files: readonly InputFile[], opts: ReconstructOptions): Promise<Reconstruction> {
  const gaps = new Gaps();
  const byName = new Map(files.map((f) => [f.name, f]));
  const pick = (role: Role): InputFile | undefined => INPUT_FILES[role].map((n) => byName.get(n)).find((f): f is InputFile => !!f);
  const known = new Set<string>(Object.values(INPUT_FILES).flat());
  for (const role of Object.keys(INPUT_FILES) as Role[]) {
    const present = INPUT_FILES[role].filter((n) => byName.has(n));
    if (present.length > 1) gaps.notes.push(`Both ${present.join(" and ")} are present; only ${present[0]} is read.`);
  }
  for (const f of [...files].sort((a, b) => cmp(a.name, b.name))) if (!known.has(f.name)) gaps.notes.push(`${f.name} is not an input the tool reads; it was ignored.`);
  const tooBig = files.filter((f) => f.bytes.byteLength > MAX_INPUT_BYTES).map((f) => f.name);
  for (const n of tooBig) { gaps.rejected.push({ source: n, row: null, code: "file_too_large", reason: `${n} is over ${MAX_INPUT_BYTES} bytes and was not read.` }); byName.delete(n); }

  const used: { role: Role; file: InputFile }[] = [];
  if (opts.mapping) used.push({ role: "mapping", file: opts.mapping });
  for (const role of Object.keys(INPUT_FILES) as Role[]) {
    if (role === "mapping" && opts.mapping) continue;
    const f = pick(role);
    if (f) used.push({ role, file: f });
  }
  const fileOf = (role: Role) => used.find((u) => u.role === role)?.file;
  const digest = sha256.create();
  for (const u of [...used].sort((a, b) => cmp(a.role, b.role))) { digest.update(new TextEncoder().encode(`${u.role}\u0000${u.file.name}\u0000${u.file.bytes.byteLength}\u0000`)); digest.update(u.file.bytes); }

  // Day, entity and policy.
  const dayFile = fileOf("day");
  const day = dayConfig(dayFile ? json(dayFile, gaps) : undefined, gaps);

  // Provider export through the mapping, with the optional invoices and quotes.
  const exportFile = fileOf("export");
  const mappingFile = fileOf("mapping");
  let mappedRows: Record<string, string>[] = [];
  let mappingProvider: string | null = null;
  let exportLines: number[] = [];
  if (!exportFile) {
    gaps.ask("no-export", "No provider export was supplied — can you export the day's payments with order, quote, deposit address, transaction hash and batch?", "The export is the provider's record of every payment.");
  } else {
    const tbl = table(exportFile, gaps);
    if (tbl) {
      const m = mapExport(tbl, mappingFile ? json(mappingFile, gaps) : undefined, gaps);
      mappingProvider = m.provider;
      mappedRows = m.rows;
      exportLines = tbl.lines;
      const inv = fileOf("invoices");
      const quo = fileOf("quotes");
      mergeSupplements(mappedRows, inv ? table(inv, gaps)?.rows ?? null : null, quo ? table(quo, gaps)?.rows ?? null : null, gaps);
      exportGaps(mappedRows, gaps);
    }
  }
  const identity = { provider: mappingProvider ?? "provider", columns: Object.fromEntries(PROVIDER_FIELDS.map((f) => [f, f])) };
  const firstCurrency = [...mappedRows.map((r) => r.orderCurrency).filter((c): c is FiatCurrency => c === "SGD" || c === "USD" || c === "AED")].sort(cmp)[0];
  const entity: MerchantEntity = day.entity ?? { id: "ENT-RECON", name: "Merchant entity (not stated)", functionalCurrency: firstCurrency ?? "USD", ledger: "LEDGER-RECON", timeZone: { name: "UTC", utcOffsetMinutes: 0 } };
  if (!day.entity) gaps.assumptions.push(`Merchant entity not stated in day.json: entity currency ${entity.functionalCurrency} (from the orders) and time zone UTC are assumed.`);
  const cur = entity.functionalCurrency;

  const provider: ProviderExportResult = await readProviderExport([{ id: exportFile?.name ?? "provider export", read: () => ({ records: mappedRows }) }], identity, { entityId: entity.id, tokens: TOKENS });
  // Rows as the person sees them in their file (CSV: physical line, header = 1), whichever stage refused them.
  gaps.reject(provider.errors.map((e) => ({ ...e, source: exportFile?.name ?? e.source, row: e.row === null ? null : exportLines[e.row - 1] ?? e.row })));
  for (const d of provider.duplicates) gaps.notes.push(`${d.key} appears more than once in the export (row ${exportLines[d.row - 1] ?? d.row}); the copies are identical and read once.`);
  const foreign = provider.invoices.filter((i) => i.currency !== cur).map((i) => i.orderId);
  if (foreign.length) gaps.notes.push(`${plural(foreign.length, "order")} are not in the entity currency ${cur} (${foreign.join(", ")}).`);

  // Settlement report.
  const settlementFile = fileOf("settlement");
  const settlementRaw = settlementFile ? cleanSettlement(json(settlementFile, gaps), gaps) : undefined;
  const settlement: SettlementResult | null = settlementRaw === undefined ? null : await readSettlementReports([{ id: settlementFile!.name, read: () => settlementRaw }]);
  if (settlement) gaps.reject(settlement.errors);
  settlementGaps(settlementRaw, settlement, gaps);
  const settlementParts = settlement ?? { batches: [], batchLines: [], groupings: [] } as unknown as SettlementResult;

  // Chain transfers (recorded) and FX.
  const chainFile = fileOf("chain");
  let transfers: ReconcileInput["transfers"] = [];
  if (!chainFile) gaps.notes.push("No chain recording (chain.json) was supplied: no payment has chain evidence, so nothing can be matched.");
  else {
    const raw = json(chainFile, gaps);
    const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.transfers) ? raw.transfers : null;
    if (!list) gaps.rejected.push({ source: chainFile.name, row: null, code: "malformed", reason: `${chainFile.name} must be an array of transfers or an object with "transfers".` });
    else {
      const targets = [...provider.quotes.map((q) => ({ network: q.network, address: q.depositAddress })), ...provider.paymentLinks.map((l) => ({ network: l.token.network, address: l.depositAddress }))]
        .filter((x, i, xs) => xs.findIndex((y) => y.network === x.network && normAddress(x.network, y.address) === normAddress(x.network, x.address)) === i);
      const read = await readChainTransfers(new FileChainClient(list), targets, { since: "1970-01-01T00:00:00.000Z" });
      gaps.reject(read.errors, chainFile.name);
      transfers = read.accepted.map(({ finalised, ...t }) => (void finalised, t));
    }
  }
  const fxFile = fileOf("fx");
  let fxRates: ReconcileInput["fxRates"] = [];
  if (fxFile) {
    const raw = json(fxFile, gaps);
    if (raw !== undefined) { const fx = await readFxRates([{ id: fxFile.name, read: () => raw }]); gaps.reject(fx.errors); fxRates = fx.accepted; }
  }

  // Bank lines under the rc5 statement CSV rules: always imported, not bank-authenticated.
  const bank = bankLines(fileOf("bank"), cur, gaps);
  gaps.assumptions.push("Bank lines come from a CSV file, so they are imported, not bank-authenticated: under the rc5 rule they never make settlement verified on their own. Each item also shows its result once the bank line is confirmed in the bank feed.");

  const input = assembleInput({ entity, policy: day.policy, networks: NETWORKS, tokens: TOKENS }, {
    provider, settlement: settlementParts, transfers, fxRates, bankLines: bank, addressFacts: day.addressFacts,
  });
  const run = (i: ReconcileInput): EngineRun => { const result = reconcile(i); return { input: i, result, journals: proposeJournals(i, result) }; };
  const engine = run(input);
  const bankConfirmed = run({ ...input, bankLines: input.bankLines.map((l) => ({ ...l, source: "bank_feed" as const })) });

  for (const b of engine.result.bridges) if (!b.bankLineId && bank.length)
    gaps.ask(`no-bank-line-${b.batchId}`, `No bank credit references batch ${b.batchId} — what reference does the payout carry on the bank statement?`, "A batch ties only to a bank line that names it.");

  // Report.
  const confirmedOf = new Map(bankConfirmed.result.records.map((r) => [r.orderId, r]));
  const items: ReportItem[] = engine.result.records.map((r) => {
    const e = r.explanation;
    return {
      orderId: r.orderId, invoice: fmtFiat(r.ledger.invoice.amountMinor, cur), credited: fmtFiat(r.ledger.creditedMinor, cur), openBalance: fmtFiat(r.ledger.openBalanceMinor, cur),
      difference: fmtFiat(sum(e.differences.map((d) => d.amountMinor)), cur),
      differences: e.differences.map((d) => ({ id: d.id, type: d.type, typeText: DIFFERENCE_TEXT[d.type], amount: fmtFiat(d.amountMinor, d.currency), reason: d.reason, ruleId: d.ruleId })),
      ...outcome(r), ruleText: ruleText(e.ruleId), owner: r.attention?.owner ?? null, reason: r.attention?.reason ?? null, nextStep: r.attention?.nextStep ?? null,
      history: e.history.map((h) => ({ step: h.step, ruleId: h.ruleId, outcome: h.outcome, detail: h.detail })),
      onceBankConfirmed: outcome(confirmedOf.get(r.orderId) ?? r),
    };
  });
  const confirmedBridge = new Map(bankConfirmed.result.bridges.map((b) => [b.batchId, b]));
  const bridges: ReportBridge[] = engine.result.bridges.map((b) => ({
    batchId: b.batchId, currency: b.currency, merchantDay: b.merchantDay, merchantTimeZone: tzText(b.merchantTimeZone), providerDay: b.providerDay, providerTimeZone: tzText(b.providerTimeZone),
    bankLineId: b.bankLineId, bankLineLabel: b.bankLineLabel, tied: b.tied, settlementVerified: b.settlementVerified,
    settlementVerifiedOnceBankConfirmed: confirmedBridge.get(b.batchId)?.settlementVerified ?? false,
    checks: (Object.keys(CHECK_TEXT) as (keyof typeof CHECK_TEXT)[]).map((k) => ({ check: CHECK_TEXT[k], ok: b.checks[k] })),
    lines: b.lines.map((l) => ({ kind: l.kind, label: l.label, amount: fmtFiat(l.amountMinor, b.currency), reason: l.reason })),
  }));
  const groupings = [
    ...settlementParts.groupings.map((g) => ({ id: g.id, status: g.status, providerDay: g.providerDay, currency: g.currency, total: `gross ${fmtFiat(g.grossMinor, g.currency)}, net ${fmtFiat(g.netMinor, g.currency)}`, orderIds: [], note: g.note })),
    ...engine.result.proposedGroupings.map((g) => ({ id: g.id, status: g.status, providerDay: g.providerDay, currency: g.currency, total: fmtFiat(g.totalMinor, g.currency), orderIds: g.orderIds, note: g.reason })),
  ];
  const providerName = day.provider ?? mappingProvider ?? "Provider (not stated)";
  const label = opts.sample ? SAMPLE_LABEL : REAL_LABEL;
  const report: ReconstructionReport = {
    format: RECONSTRUCTION_FORMAT, label,
    title: `Case reconstruction · ${providerName} · ${day.day ?? "day not stated"}`,
    generatedAt: opts.generatedAt ?? null, inputDigest: bytesToHex(digest.digest()),
    inputs: used.map((u) => ({ file: u.file.name, role: ROLE_TEXT[u.role], bytes: u.file.bytes.byteLength, sha256: hex(u.file.bytes) })),
    provider: providerName, day: day.day ?? null,
    entity: { id: entity.id, name: entity.name, currency: cur, timeZone: tzText(entity.timeZone) },
    policy: {
      band: `min(${(day.policy.tolerancePct / 100).toFixed(2)}% of the invoice, ${fmtFiat(day.policy.toleranceAbsMinor, cur)})`, writeOffThreshold: fmtFiat(day.policy.writeoffThresholdMinor, cur),
      senderFeeBound: `${fromUnits(day.policy.senderFeeBoundBaseUnits, 6)} token units`, importedBankLinesVerify: false,
    },
    figures: figures(engine, bankConfirmed, cur), items, bridges, groupings,
    journals: engine.journals.map(journalView), journalsOnceBankConfirmed: bankConfirmed.journals.map(journalView),
    unmappable: gaps.unmappable, questions: gaps.questions, rejected: gaps.rejected, notes: gaps.notes, assumptions: gaps.assumptions,
  };
  return { report, engine, bankConfirmed };
}
