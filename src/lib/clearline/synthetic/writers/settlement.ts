/** Settlement reports: per-payment lines (CSV) and totals only (JSON). Synthetic · fictional data. */
import { SYNTHETIC_LABEL } from "../fictional";
import type { SyntheticWorld } from "../world";
import { csv, json, minorPlain, utf8 } from "./format";

/**
 * One row per batch line, batches in id order: payments, refunds, and (rc7) one batch-level fee line per batch, as a
 * real per-payment settlement report shows them. Refunds and fees are written as negative amounts.
 */
export function settlementLinesCsv(world: SyntheticWorld): Uint8Array {
  const batch = new Map(world.batches.map((b) => [b.batchId, b]));
  const fees = world.batches.filter((b) => b.feesMinor !== 0n)
    .map((b) => [b.batchId, b.providerDay, b.currency, "fee", "", "", "", minorPlain(-b.feesMinor), b.targetBankAccount]);
  const rows = [...world.batchLines]
    .sort((a, b) => (a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : (a.providerPaymentId ?? a.refundId ?? "") < (b.providerPaymentId ?? b.refundId ?? "") ? -1 : 1))
    .map((l) => {
      const b = batch.get(l.batchId)!;
      return [l.batchId, b.providerDay, b.currency, l.kind, l.providerPaymentId ?? "", l.refundId ?? "", l.orderId, minorPlain(l.kind === "refund" ? -l.amountMinor : l.amountMinor), b.targetBankAccount];
    });
  const all = [...rows, ...fees].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[3] === "fee" ? 1 : b[3] === "fee" ? -1 : 0));
  return utf8(csv([["batch_id", "provider_day_utc", "currency", "line_type", "payment_id", "refund_id", "order_ref", "amount", "bank_account"], ...all]));
}

export function settlementTotalsJson(world: SyntheticWorld): Uint8Array {
  return utf8(json({
    _note: SYNTHETIC_LABEL,
    provider: world.providerName,
    period: world.month,
    fee_basis: `${world.providerFeeBps / 100}% of gross per batch`,
    batches: world.batches.map((b) => ({
      batch_id: b.batchId, provider_day: b.providerDay, provider_time_zone: b.providerTimeZone.name, currency: b.currency, target_bank_account: b.targetBankAccount,
      payment_count: world.batchLines.filter((l) => l.batchId === b.batchId && l.kind === "payment").length,
      gross: minorPlain(b.grossMinor), fees: minorPlain(b.feesMinor), refunds: minorPlain(b.refundsMinor), net: minorPlain(b.netMinor),
    })),
  }));
}
