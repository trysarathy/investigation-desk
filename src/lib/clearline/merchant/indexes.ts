/**
 * rc7 performance: lookups built once per reconcile input instead of scanning every array once per order (which
 * made a month of 10,000 payments quadratic). Pure; each map keeps the FIRST element for a key, exactly like the
 * `Array.prototype.find` it replaces, so results are identical. Inputs are treated as immutable.
 */
import { normAddress } from "./config";
import type { AddressFact, SettlementBatchLine, SettlementPaymentLine, PaymentLink, ProviderPaymentRecord, Quote, ReconcileInput, ChainTransfer, TransferRef } from "./types";

export const transferKey = (r: TransferRef): string => `${r.network}|${r.txHash}|${r.logIndex}`;

export interface InputIndexes {
  quoteById: Map<string, Quote>;
  linkById: Map<string, PaymentLink>;
  quotesByOrder: Map<string, Quote[]>;
  linksByOrder: Map<string, PaymentLink[]>;
  transferByKey: Map<string, ChainTransfer>;
  /** provider record → its position in input.providerRecords (to reproduce first-match order). */
  recordPos: Map<ProviderPaymentRecord, number>;
  recordByTransfer: Map<string, ProviderPaymentRecord>;
  recordByPaymentId: Map<string, ProviderPaymentRecord>;
  /** records without a transferRef, first by linkId, and first by quoteId among those without a linkId. */
  untransferredByLink: Map<string, ProviderPaymentRecord>;
  untransferredByQuoteNoLink: Map<string, ProviderPaymentRecord>;
  /** first record with no transferRef, no linkId and no quoteId (matched by a transfer with no reference). */
  untransferredNoRef: ProviderPaymentRecord | undefined;
  /** every record by its linkId ?? quoteId. */
  recordsByRef: Map<string, ProviderPaymentRecord[]>;
  /** v1 phase 3: address facts by "network|normalised address", in input order (what the per-transfer filter kept). */
  factsByAddress: Map<string, AddressFact[]>;
  /** v1 phase 3: every record by its quoteId, and by its linkId (a record may appear under both). */
  recordsByQuote: Map<string, ProviderPaymentRecord[]>;
  recordsByLink: Map<string, ProviderPaymentRecord[]>;
  /** v1 phase 3: order ids with a refund batch line; order ids and payment ids with a refund settlement line. */
  refundBatchLineOrders: Set<string>;
  refundPaymentLineOrders: Set<string>;
  refundPaymentLinePayments: Set<string>;
}

const firstBy = <T>(xs: readonly T[], key: (x: T) => string | undefined): Map<string, T> => {
  const m = new Map<string, T>();
  for (const x of xs) { const k = key(x); if (k !== undefined && !m.has(k)) m.set(k, x); }
  return m;
};
const groupBy = <T>(xs: readonly T[], key: (x: T) => string | undefined): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); if (k === undefined) continue; const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
};

const cache = new WeakMap<ReconcileInput, InputIndexes>();

export function indexesOf(input: ReconcileInput): InputIndexes {
  const hit = cache.get(input);
  if (hit) return hit;
  const recs = input.providerRecords;
  const idx: InputIndexes = {
    quoteById: firstBy(input.quotes, (q) => q.quoteId),
    linkById: firstBy(input.paymentLinks, (l) => l.linkId),
    quotesByOrder: groupBy(input.quotes, (q) => q.orderId),
    linksByOrder: groupBy(input.paymentLinks, (l) => l.orderId),
    transferByKey: firstBy(input.transfers, (t) => transferKey(t)),
    recordPos: new Map(recs.map((r, i) => [r, i] as const)),
    recordByTransfer: firstBy(recs, (r) => (r.transferRef ? transferKey(r.transferRef) : undefined)),
    recordByPaymentId: firstBy(recs, (r) => r.providerPaymentId),
    untransferredByLink: firstBy(recs, (r) => (!r.transferRef && r.ref.linkId ? r.ref.linkId : undefined)),
    untransferredByQuoteNoLink: firstBy(recs, (r) => (!r.transferRef && !r.ref.linkId ? r.ref.quoteId : undefined)),
    untransferredNoRef: recs.find((r) => !r.transferRef && !r.ref.linkId && r.ref.quoteId === undefined),
    recordsByRef: groupBy(recs, (r) => r.ref.linkId ?? r.ref.quoteId ?? ""),
    recordsByQuote: groupBy(recs, (r) => r.ref.quoteId),
    recordsByLink: groupBy(recs, (r) => r.ref.linkId),
    factsByAddress: groupBy(input.addressFacts, (f) => `${f.network}|${normAddress(f.network, f.address)}`),
    refundBatchLineOrders: new Set(input.batchLines.filter((l: SettlementBatchLine) => l.kind === "refund" && l.orderId !== undefined).map((l) => l.orderId!)),
    refundPaymentLineOrders: new Set((input.settlementPaymentLines ?? []).filter((l: SettlementPaymentLine) => l.kind === "refund" && l.orderId !== undefined).map((l) => l.orderId!)),
    refundPaymentLinePayments: new Set((input.settlementPaymentLines ?? []).filter((l: SettlementPaymentLine) => l.kind === "refund" && l.providerPaymentId !== undefined).map((l) => l.providerPaymentId!)),
  };
  cache.set(input, idx);
  return idx;
}
