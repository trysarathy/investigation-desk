/**
 * A provider export of shape A with the quote columns shape A leaves out appended (invoice amount, quote rate, rate
 * source, token contract, quote created and expiry) [ASSUMPTION: a provider export that also lists its quotes].
 * Every value comes from the synthetic world; nothing is real. Used by the e2e upload journey and the truth test as
 * the "full quote terms" variant, next to the plain shapes A, B and C.
 */
import { paymentRows, CHAIN_LABEL } from "../../../src/lib/clearline/synthetic/writers/provider";
import { concat, csv, ddmmyyyyHHmm, minorGrouped, unitsGrouped, utf8, UTF8_BOM } from "../../../src/lib/clearline/synthetic/writers/format";
import { partsAt, ms } from "../../../src/lib/clearline/synthetic/time";
import type { SyntheticWorld } from "../../../src/lib/clearline/synthetic";

const SGT = 480;
const withSeconds = (instant: string) => { const p = partsAt(ms(instant), SGT); return `${p.dd}/${p.mm}/${p.yyyy} ${p.HH}:${p.MI}:${p.SS}`; };

export const QUOTE_EXPORT_HEADERS = (cur: string) => ["Order Ref", "Quote", "Amount Quoted", "Amount Received", "Asset", "Chain", "Tx Hash", "From", "Status", "Settled In", "Created (SGT)", "Payment ID", "Payment Link", "Deposit Address", "Rate", `Credited (${cur})`,
  "Invoice Amount", "Quote Rate", "Rate Source", "Token Contract", "Quote Created (SGT)", "Quote Expires (SGT)"];

export function providerExportWithQuotes(world: SyntheticWorld, entityId: string) {
  const cur = world.entities.find((e) => e.id === entityId)!.functionalCurrency;
  const rows = paymentRows(world, entityId);
  const body = rows.map(({ rec, meta }) => {
    const link = rec.ref.linkId ? world.paymentLinks.find((l) => l.linkId === rec.ref.linkId) : undefined;
    const quote = world.quotes.find((q) => q.quoteId === (rec.ref.quoteId ?? link?.quoteId))!;
    const invoice = world.orders.find((o) => o.orderId === meta.orderId)!.invoice;
    return [
      meta.orderId, quote.quoteId, unitsGrouped(meta.quotedBaseUnits), unitsGrouped(rec.receivedBaseUnits), meta.tokenSymbol, CHAIN_LABEL[meta.network],
      rec.transferRef?.txHash ?? "", meta.payerWallet ?? "", meta.displayedStatus, rec.batchId ?? "", ddmmyyyyHHmm(meta.createdAt, SGT),
      rec.providerPaymentId, rec.ref.linkId ?? "", meta.depositAddress, rec.executedRate, minorGrouped(rec.creditedMinor),
      // the payment's own token contract (a balance payment may be on another chain than its quote)
      minorGrouped(invoice.amountMinor), quote.rate, quote.rateSource, meta.tokenContract, withSeconds(quote.createdAt), withSeconds(quote.expiresAt),
    ];
  });
  const total = ["TOTAL", "", "", unitsGrouped(rows.reduce((s, r) => s + r.rec.receivedBaseUnits, 0n)), "", "", "", "", `${rows.length} payments`, "", "", "", "", "", "", minorGrouped(rows.reduce((s, r) => s + r.rec.creditedMinor, 0n)), "", "", "", "", "", ""];
  return {
    name: `${world.month} provider-A export with quotes ${cur} (synthetic, fictional).csv`, bytes: concat(UTF8_BOM, utf8(csv([QUOTE_EXPORT_HEADERS(cur), ...body, total]))),
    rows: rows.length, statuses: [...new Set(rows.map((r) => r.meta.displayedStatus))],
  };
}
