/**
 * Shape D ("blind"): a further provider export format, reserved for a BLIND mapping test.
 *
 * DO NOT reference this file's field names anywhere else in the code base (no parser, mapping, fixture, test or doc
 * may name them): a blind test only means something if nothing was built knowing this shape. Other modules may call
 * the exported functions by name; they must not read or assert on the output's field names.
 *
 * JSON, settlement TOTALS only (no per-payment settlement lines). Synthetic · fictional data.
 */
import { SYNTHETIC_LABEL } from "./fictional";
import { ms } from "./time";
import type { SyntheticWorld } from "./world";
import { json, minorPlain, unitsPlain, utf8 } from "./writers/format";

export function blindProviderExport(world: SyntheticWorld): Uint8Array {
  const meta = new Map(world.paymentMeta.map((m) => [m.providerPaymentId, m]));
  const records = [...world.providerRecords]
    .sort((a, b) => ms(meta.get(a.providerPaymentId)!.createdAt) - ms(meta.get(b.providerPaymentId)!.createdAt) || (a.providerPaymentId < b.providerPaymentId ? -1 : 1))
    .map((r) => {
      const m = meta.get(r.providerPaymentId)!;
      return {
        txn: r.providerPaymentId, ext_ref: m.orderId, link_code: r.ref.linkId ?? r.ref.quoteId ?? null, coin: m.tokenSymbol, rail: m.network.toUpperCase(),
        amt_crypto: unitsPlain(r.receivedBaseUnits), booked_fiat: minorPlain(r.creditedMinor), ccy: m.currency, fx: r.executedRate,
        hash: r.transferRef?.txHash ?? null, src_addr: m.payerWallet ?? null, dst_addr: m.depositAddress, state: r.statusClaim.toUpperCase(),
        payout_ref: r.batchId ?? null, ts_epoch: Math.floor(ms(m.createdAt) / 1000),
      };
    });
  const payouts = world.batches.map((b) => ({
    payout_ref: b.batchId, for_day: b.providerDay, ccy: b.currency, gross: minorPlain(b.grossMinor),
    deductions: { fees: minorPlain(b.feesMinor), refunds: minorPlain(b.refundsMinor) }, net: minorPlain(b.netMinor),
  }));
  return utf8(json({ _note: SYNTHETIC_LABEL, src: world.providerName, records, payouts }));
}
