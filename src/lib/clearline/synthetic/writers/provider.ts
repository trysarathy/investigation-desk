/**
 * Provider payment exports in three deliberately different shapes (A: CSV, B: XLSX, C: nested JSON + totals-only
 * settlement JSON). All render the same provider records of a synthetic world; nothing here is real.
 */
import ExcelJS from "exceljs";
import { SYNTHETIC_LABEL } from "../fictional";
import { ms } from "../time";
import type { PaymentMeta, SyntheticWorld } from "../world";
import type { ProviderPaymentRecord } from "../../merchant/types";
import { csv, concat, ddmmyyyyHHmm, json, minorGrouped, minorPlain, mmddyyyy, toNumber, unitsGrouped, unitsPlain, utf8, UTF8_BOM } from "./format";
import { normalizeZipTimes } from "./zip";
import { isoWithOffset } from "../time";

export const CHAIN_LABEL: Readonly<Record<string, string>> = { tron: "TRON", ethereum: "Ethereum", polygon: "Polygon" };
const SGT_OFFSET = 480;

export interface PaymentRow { rec: ProviderPaymentRecord; meta: PaymentMeta }

/** Provider records joined with their display facts, in creation order (then payment id). */
export function paymentRows(world: SyntheticWorld, entityId?: string): PaymentRow[] {
  const meta = new Map(world.paymentMeta.map((m) => [m.providerPaymentId, m]));
  return world.providerRecords
    .map((rec) => ({ rec, meta: meta.get(rec.providerPaymentId)! }))
    .filter((r) => !entityId || r.meta.entityId === entityId)
    .sort((a, b) => ms(a.meta.createdAt) - ms(b.meta.createdAt) || (a.rec.providerPaymentId < b.rec.providerPaymentId ? -1 : 1));
}

/** Shape A: CSV, comma, UTF-8 with BOM, DD/MM/YYYY HH:mm SGT, thousand separators, trailing TOTAL row. One entity. */
export function providerExportA(world: SyntheticWorld, entityId: string): Uint8Array {
  const rows = paymentRows(world, entityId);
  const cur = world.entities.find((e) => e.id === entityId)!.functionalCurrency;
  const header = ["Order Ref", "Quote", "Amount Quoted", "Amount Received", "Asset", "Chain", "Tx Hash", "From", "Status", "Settled In", "Created (SGT)", "Payment ID", "Payment Link", "Deposit Address", "Rate", `Credited (${cur})`];
  const body = rows.map(({ rec, meta }) => [
    meta.orderId, rec.ref.quoteId ?? "", unitsGrouped(meta.quotedBaseUnits), unitsGrouped(rec.receivedBaseUnits), meta.tokenSymbol, CHAIN_LABEL[meta.network],
    rec.transferRef?.txHash ?? "", meta.payerWallet ?? "", meta.displayedStatus, rec.batchId ?? "", ddmmyyyyHHmm(meta.createdAt, SGT_OFFSET),
    rec.providerPaymentId, rec.ref.linkId ?? "", meta.depositAddress, rec.executedRate, minorGrouped(rec.creditedMinor),
  ]);
  const received = rows.reduce((t, r) => t + r.rec.receivedBaseUnits, 0n);
  const credited = rows.reduce((t, r) => t + r.rec.creditedMinor, 0n);
  const total = ["TOTAL", "", "", unitsGrouped(received), "", "", "", "", `${rows.length} payments`, "", "", "", "", "", "", minorGrouped(credited)];
  return concat(UTF8_BOM, utf8(csv([header, ...body, total])));
}

/** Shape B: XLSX with snake_case headers, numeric cells, MM/DD/YYYY dates and ISO datetimes with mixed offsets. */
export async function providerExportB(world: SyntheticWorld): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const at = new Date(ms(world.asOf));
  wb.creator = world.providerName;
  wb.lastModifiedBy = world.providerName;
  wb.created = at;
  wb.modified = at;
  wb.title = `${world.providerName} payments ${world.month}`;
  wb.subject = SYNTHETIC_LABEL;
  wb.description = SYNTHETIC_LABEL;
  const ws = wb.addWorksheet("payments");
  ws.addRow(["merchant_order_id", "payment_id", "reference", "crypto_amount", "fiat_credited", "currency", "network", "transaction_hash", "deposit_address", "payer_wallet", "payment_status", "batch", "fee", "rate", "created_date", "created_at"]);
  const OFFSETS = [480, 240, 0]; // +08:00, +04:00, Z — the provider's systems disagree
  paymentRows(world).forEach(({ rec, meta }, i) => {
    const off = OFFSETS[i % OFFSETS.length];
    ws.addRow([
      meta.orderId, rec.providerPaymentId, rec.ref.linkId ?? rec.ref.quoteId ?? "", toNumber(rec.receivedBaseUnits, 6), toNumber(rec.creditedMinor, 2), meta.currency,
      meta.network, rec.transferRef?.txHash ?? "", meta.depositAddress, meta.payerWallet ?? "", rec.statusClaim, rec.batchId ?? "", toNumber(meta.indicativeFeeMinor, 2),
      Number(rec.executedRate), mmddyyyy(meta.createdAt, off), isoWithOffset(ms(meta.createdAt), off),
    ]);
  });
  ws.getColumn(4).numFmt = "0.000000";
  ws.getColumn(5).numFmt = "#,##0.00";
  ws.getColumn(13).numFmt = "#,##0.00";
  ws.getColumn(14).numFmt = "0.0000";
  const buf = await wb.xlsx.writeBuffer();
  return normalizeZipTimes(new Uint8Array(buf as ArrayBuffer), world.asOf.slice(0, 10));
}

/** Shape C: nested JSON, amounts as strings. */
export function providerExportC(world: SyntheticWorld): Uint8Array {
  const data = paymentRows(world).map(({ rec, meta }) => ({
    order: { id: meta.orderId, quote: rec.ref.quoteId ?? null, link: rec.ref.linkId ?? null },
    pay: { id: rec.providerPaymentId, amount: unitsPlain(rec.receivedBaseUnits), asset: meta.tokenSymbol, quoted: unitsPlain(meta.quotedBaseUnits), credited: minorPlain(rec.creditedMinor), currency: meta.currency, rate: rec.executedRate, status: rec.statusClaim, status_label: meta.displayedStatus, created: meta.createdAt },
    chain: { network: meta.network, contract: meta.tokenContract, tx: rec.transferRef?.txHash ?? null, from: meta.payerWallet ?? null, to: meta.depositAddress },
    settlement: { batch: rec.batchId ?? null, fee: minorPlain(meta.indicativeFeeMinor) },
  }));
  return utf8(json({ _note: SYNTHETIC_LABEL, provider: world.providerName, period: world.month, data }));
}

/** Shape C settlement report: TOTALS ONLY per batch (no per-payment lines). */
export function providerSettlementTotalsC(world: SyntheticWorld): Uint8Array {
  const settlements = world.batches.map((b) => ({
    batch: b.batchId, day: b.providerDay, tz: b.providerTimeZone.name, currency: b.currency, account: b.targetBankAccount,
    totals: { gross: minorPlain(b.grossMinor), fees: minorPlain(b.feesMinor), refunds: minorPlain(b.refundsMinor), net: minorPlain(b.netMinor) },
  }));
  return utf8(json({ _note: SYNTHETIC_LABEL, provider: world.providerName, period: world.month, settlements }));
}
