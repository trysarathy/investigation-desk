/**
 * Upload files for the rc7 upload journeys, all from the synthetic generator's small preset (fictional).
 *
 * The provider export is shape A (UTF-8 with BOM, comma, DD/MM/YYYY HH:mm SGT, thousand separators, a trailing TOTAL
 * row) with the quote columns that shape A leaves out appended: the mapping catalogue requires the invoice amount,
 * quote rate, rate source, token contract and quote window for a provider export, and plain shape A carries none of
 * them [ASSUMPTION: a provider export that also lists its quotes]. Every value still comes from the generator's world.
 */
import { smallPreset, type SyntheticFile } from "../../src/lib/clearline/synthetic";
import { paymentRows, CHAIN_LABEL } from "../../src/lib/clearline/synthetic/writers/provider";
import { concat, csv, ddmmyyyyHHmm, minorGrouped, unitsGrouped, utf8, UTF8_BOM } from "../../src/lib/clearline/synthetic/writers/format";
import { partsAt, ms } from "../../src/lib/clearline/synthetic/time";

const SGT = 480;
const withSeconds = (instant: string) => { const p = partsAt(ms(instant), SGT); return `${p.dd}/${p.mm}/${p.yyyy} ${p.HH}:${p.MI}:${p.SS}`; };

export const PROVIDER_HEADERS = (cur: string) => ["Order Ref", "Quote", "Amount Quoted", "Amount Received", "Asset", "Chain", "Tx Hash", "From", "Status", "Settled In", "Created (SGT)", "Payment ID", "Payment Link", "Deposit Address", "Rate", `Credited (${cur})`,
  "Invoice Amount", "Quote Rate", "Rate Source", "Token Contract", "Quote Created (SGT)", "Quote Expires (SGT)"];

export async function uploadFiles() {
  const { world, files, truth } = await smallPreset();
  const pick = (kind: SyntheticFile["kind"], account?: string) => files.find((f) => f.kind === kind && (!account || f.account === account))!;
  const providerExport = (entityId: string) => {
    const cur = world.entities.find((e) => e.id === entityId)!.functionalCurrency;
    const rows = paymentRows(world, entityId);
    const body = rows.map(({ rec, meta }) => {
      const link = rec.ref.linkId ? world.paymentLinks.find((l) => l.linkId === rec.ref.linkId) : undefined;
      const quote = world.quotes.find((q) => q.quoteId === (rec.ref.quoteId ?? link?.quoteId))!;
      const invoice = world.orders.find((o) => o.orderId === meta.orderId)!.invoice;
      return [
        meta.orderId, quote.quoteId, unitsGrouped(quote.quotedBaseUnits), unitsGrouped(rec.receivedBaseUnits), meta.tokenSymbol, CHAIN_LABEL[meta.network],
        rec.transferRef?.txHash ?? "", meta.payerWallet ?? "", meta.displayedStatus, rec.batchId ?? "", ddmmyyyyHHmm(meta.createdAt, SGT),
        rec.providerPaymentId, rec.ref.linkId ?? "", quote.depositAddress, rec.executedRate, minorGrouped(rec.creditedMinor),
        minorGrouped(invoice.amountMinor), quote.rate, quote.rateSource, quote.token.contract, withSeconds(quote.createdAt), withSeconds(quote.expiresAt),
      ];
    });
    const total = ["TOTAL", "", "", unitsGrouped(rows.reduce((s, r) => s + r.rec.receivedBaseUnits, 0n)), "", "", "", "", `${rows.length} payments`, "", "", "", "", "", "", minorGrouped(rows.reduce((s, r) => s + r.rec.creditedMinor, 0n)), "", "", "", "", "", ""];
    return { name: `2026-11 provider-A export ${cur} (synthetic, fictional).csv`, bytes: concat(UTF8_BOM, utf8(csv([PROVIDER_HEADERS(cur), ...body, total]))), rows: rows.length, statuses: [...new Set(rows.map((r) => r.meta.displayedStatus))] };
  };
  const sg = world.entitySpecs[0], us = world.entitySpecs[1];
  return {
    world, truth,
    providerSg: providerExport(sg.id),
    settlementTotals: pick("settlement_totals"),
    bankCsvSg: pick("bank_csv", sg.bankAccountId),
    bankCsvUs: pick("bank_csv", us.bankAccountId),
    mt940Us: pick("bank_mt940", us.bankAccountId),
  };
}
