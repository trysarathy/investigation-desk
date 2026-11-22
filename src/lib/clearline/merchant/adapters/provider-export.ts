/**
 * Provider export adapter. Reads a provider's payment export (CSV text or a JSON array of objects) through a
 * per-provider column mapping (source column → canonical field) and produces the engine's invoices, quotes, payment
 * links and ProviderPaymentRecords. A provider status is a CLAIM: it is carried as `statusClaim`, never as proof.
 * Each row is one payment (or one quote/link with no payment yet). Test mode · illustrative data.
 */
import { z } from "zod";
import { parseCsv } from "../../../csv/parse";
import { parseRate } from "../amounts";
import { FIAT_DECIMALS, TOKENS, normAddress } from "../config";
import type { FiatCurrency, Invoice, NetworkId, PaymentLink, ProviderPaymentRecord, Quote, TokenConfig } from "../types";
import { type AdapterResult, type AdapterSource, type ItemError, type RawItem, RowError, collect, isoInstant, jsonItems, stableJson, toUnits } from "./common";

export const PROVIDER_FIELDS = [
  "orderId", "orderAmount", "orderCurrency",
  "quoteId", "quoteNetwork", "quoteTokenContract", "quoteDepositAddress", "quotedAmount", "quoteRate", "quoteRateSource", "quoteRateAt", "quoteCreatedAt", "quoteExpiresAt",
  "linkId", "linkKind", "linkNetwork", "linkTokenContract", "linkDepositAddress", "linkRequestedAmount", "linkCreatedAt", "linkExpiresAt",
  "providerPaymentId", "txHash", "logIndex", "statusClaim", "displayedStatus", "receivedAmount", "creditedAmount", "executedRate", "feeAmount", "batchId",
] as const;
export type ProviderField = (typeof PROVIDER_FIELDS)[number];

/** A provider's mapping: which source column (or JSON key) holds which canonical field. */
export const ProviderMapping = z.object({
  provider: z.string().min(1).max(120),
  columns: z.record(z.string().min(1).max(120), z.enum(PROVIDER_FIELDS)),
}).strict().superRefine((m, ctx) => {
  const targets = Object.values(m.columns);
  for (const f of ["orderId", "orderAmount", "orderCurrency", "quoteId"] as const) if (!targets.includes(f)) ctx.addIssue({ code: "custom", message: `mapping has no column for ${f}` });
  const dup = targets.filter((f, i) => targets.indexOf(f) !== i);
  if (dup.length) ctx.addIssue({ code: "custom", message: `fields mapped twice: ${[...new Set(dup)].join(", ")}` });
});
export type ProviderMapping = z.infer<typeof ProviderMapping>;

const NETWORKS = ["tron", "ethereum", "polygon", "solana", "arbitrum_one", "ton", "base"] as const;
const CLAIMS = ["paid", "underpaid", "overpaid", "held_for_review", "re_quoted", "partially_paid", "pending"] as const;
const s = (max = 200) => z.string().min(1).max(max);
const Row = z.object({
  orderId: s(64), orderAmount: s(40), orderCurrency: z.enum(["SGD", "USD", "AED"]),
  quoteId: s(64), quoteNetwork: z.enum(NETWORKS), quoteTokenContract: s(120), quoteDepositAddress: s(120), quotedAmount: s(40),
  quoteRate: s(40), quoteRateSource: s(), quoteRateAt: s(40), quoteCreatedAt: s(40), quoteExpiresAt: s(40),
  linkId: s(64).optional(), linkKind: z.enum(["full", "balance"]).optional(), linkNetwork: z.enum(NETWORKS).optional(), linkTokenContract: s(120).optional(),
  linkDepositAddress: s(120).optional(), linkRequestedAmount: s(40).optional(), linkCreatedAt: s(40).optional(), linkExpiresAt: s(40).optional(),
  providerPaymentId: s(64).optional(), txHash: s(200).optional(), logIndex: z.string().regex(/^\d{1,6}$/).optional(), statusClaim: z.enum(CLAIMS).optional(),
  displayedStatus: s(60).optional(), receivedAmount: s(40).optional(), creditedAmount: s(40).optional(), executedRate: s(40).optional(),
  feeAmount: s(40).optional(), batchId: s(64).optional(),
}).strict();

export interface ProviderExportRow { invoice: Invoice; quote: Quote; link?: PaymentLink; record?: ProviderPaymentRecord }

export interface ProviderExportResult extends AdapterResult<ProviderExportRow> {
  invoices: Invoice[]; quotes: Quote[]; paymentLinks: PaymentLink[]; providerRecords: ProviderPaymentRecord[];
}

function tokenOf(network: NetworkId, contract: string, tokens: readonly TokenConfig[]): TokenConfig {
  const t = tokens.find((k) => k.network === network && normAddress(network, k.contract) === normAddress(network, contract));
  if (!t) throw new RowError(`token ${contract} on ${network} is not a configured token (a symbol never identifies a token)`);
  return t;
}
const rate = (v: string, what: string) => { try { parseRate(v); return v; } catch { throw new RowError(`${what} ${JSON.stringify(v)} is not a plain positive decimal`); } };

/** Map one source object (column → text) to the canonical fields; empty cells are absent. */
function mapped(value: unknown, mapping: ProviderMapping): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RowError("expected an object");
  const out: Record<string, string> = {};
  for (const [col, v] of Object.entries(value as Record<string, unknown>)) {
    const f = mapping.columns[col];
    if (!f || v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" && typeof v !== "number") throw new RowError(`${col} must be text`);
    out[f] = String(v);
  }
  return out;
}

export function parseProviderRow(item: RawItem, mapping: ProviderMapping, entityId: string, tokens: readonly TokenConfig[] = TOKENS): ProviderExportRow {
  const r = Row.parse(mapped(item.value, mapping));
  const cur = r.orderCurrency as FiatCurrency;
  const qTok = tokenOf(r.quoteNetwork, r.quoteTokenContract, tokens);
  const invoice: Invoice = { orderId: r.orderId, entityId, amountMinor: toUnits(r.orderAmount, FIAT_DECIMALS[cur], "order amount"), currency: cur, status: "open" };
  if (invoice.amountMinor === 0n) throw new RowError("order amount must be greater than zero");
  const quote: Quote = {
    quoteId: r.quoteId, orderId: r.orderId, token: { network: qTok.network, contract: qTok.contract }, network: qTok.network,
    quotedBaseUnits: toUnits(r.quotedAmount, qTok.decimals, "quoted amount"), rate: rate(r.quoteRate, "quote rate"), rateSource: r.quoteRateSource,
    rateAt: isoInstant(r.quoteRateAt, "quote rate time"), createdAt: isoInstant(r.quoteCreatedAt, "quote created"), expiresAt: isoInstant(r.quoteExpiresAt, "quote expiry"),
    depositAddress: r.quoteDepositAddress,
  };
  if (Date.parse(quote.expiresAt) <= Date.parse(quote.createdAt)) throw new RowError("quote expires before it was created");
  let link: PaymentLink | undefined;
  let tok = qTok;
  if (r.linkId) {
    if (!r.linkKind || !r.linkNetwork || !r.linkTokenContract || !r.linkDepositAddress || !r.linkRequestedAmount || !r.linkCreatedAt || !r.linkExpiresAt) throw new RowError(`payment link ${r.linkId} is incomplete`);
    tok = tokenOf(r.linkNetwork, r.linkTokenContract, tokens);
    link = {
      linkId: r.linkId, orderId: r.orderId, quoteId: r.quoteId, kind: r.linkKind, token: { network: tok.network, contract: tok.contract }, depositAddress: r.linkDepositAddress,
      requestedBaseUnits: toUnits(r.linkRequestedAmount, tok.decimals, "link amount"), createdAt: isoInstant(r.linkCreatedAt, "link created"), expiresAt: isoInstant(r.linkExpiresAt, "link expiry"),
    };
  }
  let record: ProviderPaymentRecord | undefined;
  if (r.providerPaymentId) {
    if (!r.statusClaim || r.receivedAmount === undefined || r.creditedAmount === undefined || !r.executedRate) throw new RowError(`payment ${r.providerPaymentId} needs a status, received and credited amounts and an executed rate`);
    if ((r.txHash === undefined) !== (r.logIndex === undefined)) throw new RowError("txHash and logIndex go together");
    record = {
      providerPaymentId: r.providerPaymentId, ref: r.linkId ? { linkId: r.linkId } : { quoteId: r.quoteId },
      ...(r.txHash ? { transferRef: { network: tok.network, txHash: r.txHash, logIndex: Number(r.logIndex) } } : {}),
      statusClaim: r.statusClaim, ...(r.displayedStatus ? { displayedStatus: r.displayedStatus } : {}),
      receivedBaseUnits: toUnits(r.receivedAmount, tok.decimals, "received amount"), creditedMinor: toUnits(r.creditedAmount, FIAT_DECIMALS[cur], "credited amount"),
      executedRate: rate(r.executedRate, "executed rate"), ...(r.feeAmount ? { feeMinor: toUnits(r.feeAmount, FIAT_DECIMALS[cur], "fee") } : {}),
      ...(r.batchId ? { batchId: r.batchId } : {}),
    };
  }
  return { invoice, quote, ...(link ? { link } : {}), ...(record ? { record } : {}) };
}

function explode(raw: unknown, sourceId: string): { items: RawItem[]; errors: ItemError[] } {
  if (typeof raw !== "string") return { items: jsonItems(raw, sourceId, "records"), errors: [] };
  const csv = parseCsv(raw);
  if (csv.fileErrors.length) throw new RowError(csv.fileErrors.join("; "));
  const errors: ItemError[] = csv.recordErrors.map((e) => ({ source: sourceId, row: e.line, code: "malformed", reason: e.message }));
  const items: RawItem[] = [];
  for (const rec of csv.records) {
    if (rec.cells.length !== csv.header.length) { errors.push({ source: sourceId, row: rec.line, code: "malformed", reason: `expected ${csv.header.length} cells, found ${rec.cells.length}` }); continue; }
    items.push({ source: sourceId, row: rec.line, value: Object.fromEntries(csv.header.map((h, i) => [h, rec.cells[i]])) });
  }
  return { items, errors };
}

/** Group by id; an id whose copies differ is a conflict, reported and dropped (the adapter never picks one). */
function unique<T>(xs: { row: number; v: T }[], id: (v: T) => string, what: string, errors: ItemError[], source: string): T[] {
  const m = new Map<string, { row: number; v: T }[]>();
  for (const x of xs) m.set(id(x.v), [...(m.get(id(x.v)) ?? []), x]);
  const out: T[] = [];
  for (const [k, g] of [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (g.some((x) => stableJson(x.v) !== stableJson(g[0].v))) { errors.push({ source, row: g[0].row, code: "duplicate_conflict", reason: `${what} ${k} differs between rows ${g.map((x) => x.row).join(", ")}` }); continue; }
    out.push(g[0].v);
  }
  return out;
}

export async function readProviderExport(sources: readonly AdapterSource[], mappingInput: unknown, opts: { entityId: string; tokens?: readonly TokenConfig[] }): Promise<ProviderExportResult> {
  const mapping = ProviderMapping.parse(mappingInput);
  const rowOf = new WeakMap<ProviderExportRow, number>();
  const res = await collect(sources, explode, (item) => { const r = parseProviderRow(item, mapping, opts.entityId, opts.tokens); rowOf.set(r, item.row); return r; },
    (r) => r.record ? `payment:${r.record.providerPaymentId}` : `quote:${r.quote.quoteId}|link:${r.link?.linkId ?? ""}`);
  const rows = res.accepted.map((r) => ({ ...r, row: rowOf.get(r) ?? 0 }));
  const src = `${mapping.provider} export`;
  const invoices = unique(rows.map((r) => ({ row: r.row, v: r.invoice })), (v) => v.orderId, "order", res.errors, src);
  const quotes = unique(rows.map((r) => ({ row: r.row, v: r.quote })), (v) => v.quoteId, "quote", res.errors, src);
  const paymentLinks = unique(rows.filter((r) => r.link).map((r) => ({ row: r.row, v: r.link! })), (v) => v.linkId, "payment link", res.errors, src);
  const providerRecords = rows.filter((r) => r.record).map((r) => r.record!);
  return { ...res, invoices, quotes, paymentLinks, providerRecords };
}
