/** Order / invoice list as CSV and XLSX, plus the chain-transfer feed and FX rates. Synthetic · fictional data. */
import ExcelJS from "exceljs";
import { SYNTHETIC_LABEL } from "../fictional";
import { ms } from "../time";
import type { SyntheticWorld } from "../world";
import { csv, ddmmyyyyHHmm, json, minorPlain, toNumber, unitsPlain, utf8 } from "./format";
import { normalizeZipTimes } from "./zip";

function orderRows(world: SyntheticWorld): string[][] {
  const customers = new Map(world.customers.map((c) => [c.customerId, c]));
  const entity = new Map(world.entitySpecs.map((e) => [e.id, e]));
  return [...world.orders]
    .sort((a, b) => ms(a.issuedAt) - ms(b.issuedAt) || (a.orderId < b.orderId ? -1 : 1))
    .map((o) => {
      const c = customers.get(o.customerId)!;
      const e = entity.get(o.entityId)!;
      return [o.orderId, e.id, c.customerId, c.name, c.email, o.description, minorPlain(o.invoice.amountMinor), o.invoice.currency, ddmmyyyyHHmm(o.issuedAt, e.timeZone.utcOffsetMinutes), o.invoice.status];
    });
}
const ORDER_HEADER = ["Order ID", "Entity", "Customer ID", "Customer", "Customer Email", "Description", "Amount", "Currency", "Issued (local)", "Status"];

export function orderListCsv(world: SyntheticWorld): Uint8Array {
  return utf8(csv([ORDER_HEADER, ...orderRows(world)]));
}

export async function orderListXlsx(world: SyntheticWorld): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const at = new Date(ms(world.asOf));
  wb.creator = "Clearline synthetic generator";
  wb.lastModifiedBy = "Clearline synthetic generator";
  wb.created = at;
  wb.modified = at;
  wb.subject = SYNTHETIC_LABEL;
  wb.description = SYNTHETIC_LABEL;
  const ws = wb.addWorksheet("orders");
  ws.addRow(ORDER_HEADER);
  for (const r of orderRows(world)) ws.addRow([...r.slice(0, 6), toNumber(BigInt(r[6].replace(".", "")), 2), ...r.slice(7)]);
  ws.getColumn(7).numFmt = "#,##0.00";
  const buf = await wb.xlsx.writeBuffer();
  return normalizeZipTimes(new Uint8Array(buf as ArrayBuffer), world.asOf.slice(0, 10));
}

/** An explorer-style feed of every transfer the merchant's watchers saw (order and non-order transfers alike). */
export function chainTransfersJson(world: SyntheticWorld): Uint8Array {
  const transfers = [...world.transfers]
    .sort((a, b) => ms(a.timestamp) - ms(b.timestamp) || (a.txHash < b.txHash ? -1 : 1))
    .map((t) => ({
      network: t.network, tx_hash: t.txHash, log_index: t.logIndex, token_contract: t.tokenContract, symbol: t.claimedSymbol ?? null, from: t.from, to: t.to,
      amount: unitsPlain(t.amountBaseUnits), decimals: t.decimals, block: t.block, timestamp: t.timestamp, confirmations: t.confirmations,
    }));
  return utf8(json({ _note: SYNTHETIC_LABEL, observed_at: world.asOf, transfers }));
}

export function fxRatesCsv(world: SyntheticWorld): Uint8Array {
  return utf8(csv([["pair", "rate", "source", "timestamp"], ...world.fxRates.map((r) => [r.pair, r.rate, r.source, r.timestamp])]));
}
