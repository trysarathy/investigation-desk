/**
 * The rc7 blind test's month handed to the engine in memory the way shape D's files give it (no browser): no quote
 * terms, the provider's claimed statuses and credited currency, chain facts read by Clearline's client, settlement as
 * batch totals only, and imported bank lines (confirmed by a second person, as the upload pipeline enforces for a bank
 * statement). Optionally one per-payment settlement row per payment of each batch. Shared by
 * tests/clearline/synthetic/per-payment-blind.test.ts and scripts/blind/breakdown.ts. Synthetic · fictional data.
 */
import { bpsOf, type ReconcileInput, type SettlementPaymentLine } from "../../../src/lib/clearline/merchant";
import { toReconcileInput, type SyntheticWorld } from "../../../src/lib/clearline/synthetic";

export interface BlindInputOptions {
  /** Whether the imported statement was confirmed by a second person (the upload pipeline requires it; default true). */
  secondPersonConfirmed?: boolean;
}

/** Shape-D-like input: what the blind test's files give the engine. */
export function blindInput(world: SyntheticWorld, entityId: string, o: BlindInputOptions = {}): ReconcileInput {
  const i = toReconcileInput(world, entityId);
  const confirmed = o.secondPersonConfirmed ?? true;
  return {
    ...i,
    quotes: i.quotes.map((q) => ({ ...q, unknown: ["quoted_amount", "rate", "window"] as const })),
    paymentLinks: i.paymentLinks.map((l) => ({ ...l, windowUnknown: true as const, requestedUnknown: true as const })),
    transfers: i.transfers.map((t) => ({ ...t, source: "chain_client" as const })),
    // the export gives the currency it credited in (shape D does; rc8 decision 1 needs it)
    providerRecords: i.providerRecords.map((r) => ({ ...r, creditedCurrency: i.entity.functionalCurrency })),
    batchLines: [],
    bankLines: i.bankLines.map((b) => ({ ...b, source: "csv_import" as const, ...(confirmed ? { secondPersonConfirmed: true as const } : {}) })),
  };
}

/** One row per payment of each batch (the generator's own settlement), its fee allocated so the rows sum to the batch fee. */
export function perPaymentLines(world: SyntheticWorld, input: ReconcileInput): SettlementPaymentLine[] {
  const out: SettlementPaymentLine[] = [];
  for (const b of input.batches) {
    const pays = world.batchLines.filter((l) => l.batchId === b.batchId && l.kind === "payment").sort((x, y) => (x.providerPaymentId! < y.providerPaymentId! ? -1 : 1));
    let left = b.feesMinor;
    pays.forEach((p, k) => {
      const fee = k === pays.length - 1 ? left : bpsOf(p.amountMinor, world.providerFeeBps);
      left -= fee;
      out.push({ batchId: b.batchId, providerPaymentId: p.providerPaymentId!, orderId: p.orderId, currency: b.currency, grossMinor: p.amountMinor, feeMinor: fee, netMinor: p.amountMinor - fee, settlementDate: b.providerDay });
    });
  }
  return out;
}
