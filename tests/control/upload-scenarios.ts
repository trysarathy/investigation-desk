/**
 * rc7 end-to-end scenarios: FICTIONAL orders, payments, settlements and statements for three live entities, and the
 * real-world-shaped files a merchant would upload for them (built here, never committed as files). The same values
 * also build the engine's ReconcileInput directly, so a test can prove uploaded data reconciles exactly like data
 * given to the engine any other way. Only the public USDT (TRON) and USDC (Ethereum) contracts are real.
 */
import ExcelJS from "exceljs";
import { NETWORKS, TOKENS, USDC_ETHEREUM, USDT_TRON, defaultPolicyFor } from "../../src/lib/clearline/merchant/config";
import { TEST_MODE_LABEL, type ChainTransfer, type FiatCurrency, type NetworkId, type ReconcileInput } from "../../src/lib/clearline/merchant/types";
import type { Mapping } from "../../src/lib/clearline/mapping";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const tron = (i: number) => "T" + Array.from({ length: 33 }, (_, j) => B58[(i * 13 + j * 7 + 3) % 58]).join("");
export const evm = (i: number) => "0x" + (0xf1c7000 + i).toString(16).padStart(40, "0");
export const hash = (i: number) => (0xabc000 + i).toString(16).padStart(64, "d");
const utf8 = (s: string) => new TextEncoder().encode(s);
const minor = (s: string) => BigInt(s.replace(".", ""));
const base = (s: string) => { const [w, f = ""] = s.split("."); return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0")); };

export interface Order {
  orderId: string; invoice: string; quoteId: string; quoted: string; rate: string; address: string; created: string; expires: string;
  payment?: { id: string; status: string; claim: "paid" | "underpaid" | "overpaid" | "re_quoted"; received: string; credited: string; exec: string; fee: string; batch?: string; paidAt: string; recorded: boolean; txIndex: number };
}
export interface Scenario {
  entityId: string; currency: FiatCurrency; offset: number; network: NetworkId; contract: string; account: string;
  orders: Order[]; batch: { id: string; day: string; gross: string; fees: string; net: string; perPayment: boolean };
}

export const SG: Scenario = {
  entityId: "ENT-LIVE-SG", currency: "SGD", offset: 480, network: "tron", contract: USDT_TRON, account: "SG00FICT0000000001",
  batch: { id: "B-SG-1102", day: "2026-11-02", gross: "4048.65", fees: "40.49", net: "4008.16", perPayment: true },
  orders: [
    { orderId: "SG-1001", invoice: "1350.00", quoteId: "Q-SG-1", quoted: "1000", rate: "1.35", address: tron(1), created: "2026-11-02T01:00:00.000Z", expires: "2026-11-02T01:30:00.000Z",
      payment: { id: "P-SG-1", status: "Completed", claim: "paid", received: "1000", credited: "1350.00", exec: "1.35", fee: "13.50", batch: "B-SG-1102", paidAt: "2026-11-02T01:10:00.000Z", recorded: true, txIndex: 1 } },
    { orderId: "SG-1002", invoice: "2700.00", quoteId: "Q-SG-2", quoted: "2000", rate: "1.35", address: tron(2), created: "2026-11-02T01:30:00.000Z", expires: "2026-11-02T02:00:00.000Z",
      payment: { id: "P-SG-2", status: "Completed", claim: "paid", received: "1999", credited: "2698.65", exec: "1.35", fee: "26.99", batch: "B-SG-1102", paidAt: "2026-11-02T01:45:00.000Z", recorded: true, txIndex: 2 } },
    { orderId: "SG-1003", invoice: "1350.00", quoteId: "Q-SG-3", quoted: "1000", rate: "1.35", address: tron(3), created: "2026-11-03T01:00:00.000Z", expires: "2026-11-03T01:30:00.000Z",
      payment: { id: "P-SG-3", status: "Short paid", claim: "underpaid", received: "800", credited: "1080.00", exec: "1.35", fee: "10.80", paidAt: "2026-11-03T01:15:00.000Z", recorded: true, txIndex: 3 } },
    { orderId: "SG-1004", invoice: "675.00", quoteId: "Q-SG-4", quoted: "500", rate: "1.35", address: tron(4), created: "2026-11-04T01:00:00.000Z", expires: "2026-11-04T01:30:00.000Z",
      payment: { id: "P-SG-4", status: "Completed", claim: "paid", received: "500", credited: "675.00", exec: "1.35", fee: "6.75", paidAt: "2026-11-04T01:10:00.000Z", recorded: false, txIndex: 4 } },
  ],
};
export const US: Scenario = {
  entityId: "ENT-LIVE-US", currency: "USD", offset: 0, network: "ethereum", contract: USDC_ETHEREUM, account: "US00FICT0000000002",
  batch: { id: "B-US-1113", day: "2026-11-13", gross: "1590.00", fees: "15.90", net: "1574.10", perPayment: true },
  orders: [
    { orderId: "US-2001", invoice: "1000.00", quoteId: "Q-US-1", quoted: "1000", rate: "1.0000", address: evm(1), created: "2026-11-13T14:50:00.000Z", expires: "2026-11-13T15:20:00.000Z",
      payment: { id: "P-US-1", status: "Settled", claim: "paid", received: "1000", credited: "1000.00", exec: "1.0000", fee: "10.00", batch: "B-US-1113", paidAt: "2026-11-13T15:00:00.000Z", recorded: true, txIndex: 11 } },
    { orderId: "US-2002", invoice: "500.00", quoteId: "Q-US-2", quoted: "500", rate: "1.0000", address: evm(2), created: "2026-11-13T15:50:00.000Z", expires: "2026-11-13T16:20:00.000Z",
      payment: { id: "P-US-2", status: "Overpaid", claim: "overpaid", received: "590", credited: "590.00", exec: "1.0000", fee: "5.90", batch: "B-US-1113", paidAt: "2026-11-13T16:00:00.000Z", recorded: true, txIndex: 12 } },
    { orderId: "US-2003", invoice: "250.00", quoteId: "Q-US-3", quoted: "250", rate: "1.0000", address: evm(3), created: "2026-11-14T10:00:00.000Z", expires: "2026-11-14T10:30:00.000Z",
      payment: { id: "P-US-3", status: "Requoted", claim: "re_quoted", received: "250", credited: "242.50", exec: "0.9700", fee: "2.43", paidAt: "2026-11-14T10:45:00.000Z", recorded: true, txIndex: 13 } },
  ],
};
export const AE: Scenario = {
  entityId: "ENT-LIVE-AE", currency: "AED", offset: 240, network: "tron", contract: USDT_TRON, account: "AE00FICT0000000003",
  batch: { id: "B-AE-1120", day: "2026-11-20", gross: "5508.75", fees: "55.09", net: "5453.66", perPayment: false },
  orders: [
    { orderId: "AE-3001", invoice: "3672.50", quoteId: "Q-AE-1", quoted: "1000", rate: "3.6725", address: tron(31), created: "2026-11-20T04:50:00.000Z", expires: "2026-11-20T05:20:00.000Z",
      payment: { id: "P-AE-1", status: "paid", claim: "paid", received: "1000", credited: "3672.50", exec: "3.6725", fee: "36.73", batch: "B-AE-1120", paidAt: "2026-11-20T05:00:00.000Z", recorded: true, txIndex: 31 } },
    { orderId: "AE-3002", invoice: "1836.25", quoteId: "Q-AE-2", quoted: "500", rate: "3.6725", address: tron(32), created: "2026-11-20T05:50:00.000Z", expires: "2026-11-20T06:20:00.000Z",
      payment: { id: "P-AE-2", status: "paid", claim: "paid", received: "500", credited: "1836.25", exec: "3.6725", fee: "18.36", batch: "B-AE-1120", paidAt: "2026-11-20T06:00:00.000Z", recorded: true, txIndex: 32 } },
  ],
};

const txHashOf = (sc: Scenario, o: Order) => (sc.network === "ethereum" ? "0x" : "") + hash(o.payment!.txIndex);

/** What a chain reader would have observed (Phase 2): final transfers for the payments marked recorded. */
export function observedTransfers(sc: Scenario): ChainTransfer[] {
  return sc.orders.filter((o) => o.payment?.recorded).map((o, i) => ({
    network: sc.network, txHash: txHashOf(sc, o), logIndex: 0, tokenContract: sc.contract, claimedSymbol: sc.network === "tron" ? "USDT" : "USDC",
    from: sc.network === "tron" ? tron(900 + i) : evm(900 + i), to: o.address, amountBaseUnits: base(o.payment!.received), decimals: 6, block: 70_000 + i,
    timestamp: o.payment!.paidAt, confirmations: 100,
  }));
}

/** The same scenario handed to the engine directly (bank line imported, as an upload's is). */
export function engineInput(sc: Scenario): ReconcileInput {
  // rc7 phase 2: a provider's claimed transfer is not chain data; one no chain read has covered is "chain data unavailable"
  const unread = sc.orders.filter((o) => o.payment && !o.payment.recorded).map((o) => ({ network: sc.network, txHash: txHashOf(sc, o), source: "not read", reason: "not read from the chain yet", at: o.payment!.paidAt }));
  const inBatch = sc.orders.filter((o) => o.payment?.batch === sc.batch.id);
  return {
    label: TEST_MODE_LABEL, entity: { id: sc.entityId, name: `${sc.entityId} (fictional)`, functionalCurrency: sc.currency, ledger: "xero", timeZone: { name: "fixed", utcOffsetMinutes: sc.offset } },
    policy: { ...defaultPolicyFor(sc.currency), approverRoles: ["approver"] }, networks: NETWORKS, tokens: TOKENS,
    invoices: sc.orders.map((o) => ({ orderId: o.orderId, entityId: sc.entityId, amountMinor: minor(o.invoice), currency: sc.currency, status: "open" })),
    quotes: sc.orders.map((o) => ({ quoteId: o.quoteId, orderId: o.orderId, token: { network: sc.network, contract: sc.contract }, network: sc.network, quotedBaseUnits: base(o.quoted), rate: o.rate, rateSource: "provider quote", rateAt: o.created, createdAt: o.created, expiresAt: o.expires, depositAddress: o.address })),
    paymentLinks: [],
    transfers: observedTransfers(sc),
    ...(unread.length ? { chainUnavailable: unread } : {}),
    providerRecords: sc.orders.filter((o) => o.payment).map((o) => ({
      providerPaymentId: o.payment!.id, ref: { quoteId: o.quoteId }, transferRef: { network: sc.network, txHash: txHashOf(sc, o), logIndex: 0 }, statusClaim: o.payment!.claim, displayedStatus: o.payment!.status,
      receivedBaseUnits: base(o.payment!.received), creditedMinor: minor(o.payment!.credited), executedRate: o.payment!.exec, feeMinor: minor(o.payment!.fee), ...(o.payment!.batch ? { batchId: o.payment!.batch } : {}),
    })),
    batches: [{ batchId: sc.batch.id, providerDay: sc.batch.day, providerTimeZone: { name: "UTC", utcOffsetMinutes: 0 }, currency: sc.currency, targetBankAccount: sc.account, grossMinor: minor(sc.batch.gross), feesMinor: minor(sc.batch.fees), refundsMinor: 0n, netMinor: minor(sc.batch.net) }],
    batchLines: sc.batch.perPayment ? inBatch.map((o) => ({ batchId: sc.batch.id, kind: "payment" as const, providerPaymentId: o.payment!.id, orderId: o.orderId, amountMinor: minor(o.payment!.credited) })) : [],
    bankLines: [{ bankLineId: "X", account: sc.account, currency: sc.currency, valueDate: sc.batch.day, amountMinor: minor(sc.batch.net), description: `PAYOUT ${sc.batch.id}`, source: "csv_import", provenance: "imported" }],
    fxRates: [], addressFacts: [],
  };
}

// ---------- files ----------

const thousands = (s: string) => { const [w, f] = s.split("."); return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f !== undefined ? "." + f : ""}`; };
const dmy = (iso: string, offset: number) => { const d = new Date(Date.parse(iso) + offset * 60_000).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`; };
const q = (s: string) => `"${s}"`;

/** Provider export, CSV: UTF-8 BOM, DD/MM local times (no offset), thousand separators, a trailing TOTAL row. */
export function sgExportCsv(marker = ""): Uint8Array {
  const head = "Order No.,Quote ID,Payment ID,Invoice Amount,Ccy,Quoted USDT,Received USDT,Credited,Quote Rate,Exec Rate,Contract,Chain,Deposit Address,Tx Hash,Status,Batch,Fee,Created (SGT),Expires (SGT),Paid At (SGT),Note";
  const rows = SG.orders.map((o) => [o.orderId, o.quoteId, o.payment!.id, q(thousands(o.invoice)), "SGD", q(thousands(`${o.quoted}.000000`)), o.payment!.received, q(thousands(o.payment!.credited)), o.rate, o.payment!.exec,
    SG.contract, "TRC20", o.address, hash(o.payment!.txIndex), o.payment!.status, o.payment!.batch ?? "", o.payment!.fee, dmy(o.created, 480), dmy(o.expires, 480), dmy(o.payment!.paidAt, 480), marker].join(","));
  // The total sits under "Credited" (a total under a header naming an id-like word, e.g. "Invoice", is not detected).
  const total = ["TOTAL", "", "", "", "", "", "", q(thousands("5803.65")), ...Array(13).fill("")].join(",");
  return new Uint8Array([0xef, 0xbb, 0xbf, ...utf8([head, ...rows, total].join("\r\n") + "\r\n")]);
}
export const SG_EXPORT_MAPPING: Mapping = {
  fileType: "provider_export",
  columns: {
    order_id: { header: "Order No." }, quote_id: { header: "Quote ID" }, payment_id: { header: "Payment ID" }, invoice_amount: { header: "Invoice Amount" }, currency: { header: "Ccy" },
    quoted_token_amount: { header: "Quoted USDT" }, received_token_amount: { header: "Received USDT" }, credited_fiat: { header: "Credited" }, quote_rate: { header: "Quote Rate" },
    executed_rate: { header: "Exec Rate" }, rate_source: { constant: "provider quote" }, token_contract: { header: "Contract" }, network: { header: "Chain" }, deposit_address: { header: "Deposit Address" },
    tx_hash: { header: "Tx Hash" }, status: { header: "Status", statusValueMap: { Completed: "paid", "Short paid": "underpaid" } }, batch_id: { header: "Batch" }, fee: { header: "Fee" },
    created_at: { header: "Created (SGT)", dateFormat: "dmy", defaultUtcOffsetMinutes: 480 }, expires_at: { header: "Expires (SGT)", dateFormat: "dmy", defaultUtcOffsetMinutes: 480 },
    paid_at: { header: "Paid At (SGT)", dateFormat: "dmy", defaultUtcOffsetMinutes: 480 },
  },
};
export function sgSettlementCsv(): Uint8Array {
  const rows = SG.orders.filter((o) => o.payment?.batch).map((o) => [SG.batch.id, SG.batch.day, "SGD", SG.account, o.payment!.id, o.orderId, o.payment!.credited, o.payment!.fee].join(","));
  return utf8(["Payout ID,Settlement Day,Currency,Account,Payment ID,Order,Amount,Fee", ...rows].join("\n") + "\n");
}
export const SG_SETTLEMENT_MAPPING: Mapping = {
  fileType: "settlement_report", shape: "per_payment_lines",
  columns: { batch_id: { header: "Payout ID" }, provider_day: { header: "Settlement Day" }, currency: { header: "Currency" }, bank_account: { header: "Account" }, payment_id: { header: "Payment ID" }, order_id: { header: "Order" }, line_amount: { header: "Amount" }, fee: { header: "Fee" } },
};
/** Bank statement, CSV: semicolons, decimal comma, bracket negatives, DD.MM.YYYY. */
export function sgBankCsv(marker = ""): Uint8Array {
  return utf8(["Buchungstag;Valuta;Betrag;Verwendungszweck;Auftraggeber", `03.11.2026;03.11.2026;4.008,16;PAYOUT ${SG.batch.id};Provider A (fictional)`, "04.11.2026;04.11.2026;(12,00);BANK FEE NOV;",
    `05.11.2026;05.11.2026;1.234,50;TRANSFER ${marker};Fictional Payer`].join("\n") + "\n");
}
export const SG_BANK_MAPPING: Mapping = {
  fileType: "bank_statement",
  columns: { bank_account: { constant: SG.account }, value_date: { header: "Valuta", dateFormat: "dmy" }, booking_date: { header: "Buchungstag", dateFormat: "dmy" }, amount: { header: "Betrag", decimalSeparator: "," }, currency: { constant: "SGD" }, reference: { header: "Verwendungszweck" }, counterparty: { header: "Auftraggeber" } },
};
export function sgOrdersCsv(extra: string[] = []): Uint8Array {
  return utf8(["Invoice,Total,Currency,Issued", ...SG.orders.map((o) => `${o.orderId},${o.invoice},SGD,2026-11-01T00:00:00Z`), ...extra].join("\n") + "\n");
}
export const SG_ORDERS_MAPPING: Mapping = { fileType: "orders_invoices", columns: { order_id: { header: "Invoice" }, invoice_amount: { header: "Total" }, currency: { header: "Currency" }, issued_at: { header: "Issued" } } };

/** Provider export, XLSX: MM/DD with mixed offsets (+08:00, Z, none), amounts as numbers. */
export async function usExportXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Payments");
  ws.addRow(["Export of payments (fictional)"]);
  ws.addRow([]);
  ws.addRow(["Order", "Quote", "Payment", "Amount USD", "Quoted", "Received", "Credited USD", "Rate", "Executed", "Token Contract", "Network", "Address", "TxID", "State", "Payout", "Fee", "Created", "Expires", "Paid"]);
  const stamp = ["+08:00", "Z", ""];
  US.orders.forEach((o, i) => {
    const local = (iso: string, k: number) => { const off = stamp[(i + k) % 3] === "+08:00" ? 480 : 0; const d = new Date(Date.parse(iso) + off * 60_000).toISOString(); return `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)} ${d.slice(11, 16)}${stamp[(i + k) % 3] ? (stamp[(i + k) % 3] === "Z" ? "Z" : " +08:00") : ""}`; };
    ws.addRow([o.orderId, o.quoteId, o.payment!.id, Number(o.invoice), Number(o.quoted), Number(o.payment!.received), Number(o.payment!.credited), o.rate, o.payment!.exec, US.contract, "Ethereum", o.address, `0x${hash(o.payment!.txIndex)}`,
      o.payment!.status, o.payment!.batch ?? "", Number(o.payment!.fee), local(o.created, 0), local(o.expires, 1), local(o.payment!.paidAt, 2)]);
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
export const US_EXPORT_MAPPING: Mapping = {
  fileType: "provider_export",
  columns: {
    order_id: { header: "Order" }, quote_id: { header: "Quote" }, payment_id: { header: "Payment" }, invoice_amount: { header: "Amount USD" }, currency: { constant: "USD" }, quoted_token_amount: { header: "Quoted" },
    received_token_amount: { header: "Received" }, credited_fiat: { header: "Credited USD" }, quote_rate: { header: "Rate" }, executed_rate: { header: "Executed" }, rate_source: { constant: "provider quote" },
    token_contract: { header: "Token Contract" }, network: { header: "Network" }, deposit_address: { header: "Address" }, tx_hash: { header: "TxID" },
    status: { header: "State", statusValueMap: { Settled: "paid", Overpaid: "overpaid", Requoted: "re_quoted" } }, batch_id: { header: "Payout" }, fee: { header: "Fee" },
    created_at: { header: "Created", defaultUtcOffsetMinutes: 0 }, expires_at: { header: "Expires", defaultUtcOffsetMinutes: 0 }, paid_at: { header: "Paid", defaultUtcOffsetMinutes: 0 },
  },
};
export function usSettlementCsv(): Uint8Array {
  const rows = US.orders.filter((o) => o.payment?.batch).map((o) => `${US.batch.id}\t11/13/2026\tUSD\t${US.account}\t${o.payment!.id}\t${o.orderId}\t${o.payment!.credited}\t${o.payment!.fee}\t${US.batch.net}`);
  return utf8(["batch\tday\tccy\taccount\tpayment\torder\tamount\tfee\tnet", ...rows].join("\n") + "\n");
}
export const US_SETTLEMENT_MAPPING: Mapping = {
  fileType: "settlement_report", shape: "per_payment_lines",
  columns: { batch_id: { header: "batch" }, provider_day: { header: "day", dateFormat: "mdy" }, currency: { header: "ccy" }, bank_account: { header: "account" }, payment_id: { header: "payment" }, order_id: { header: "order" }, line_amount: { header: "amount" }, fee: { header: "fee" }, net: { header: "net" } },
};
export function usMt940(): Uint8Array {
  return utf8(["{1:F01FICTXX00AXXX0000000000}{2:I940FICTXX00XXXXN}{4:", ":20:STMT-US-1113", `:25:${US.account}`, ":28C:00001/001", ":60F:C261112USD100,00",
    `:61:2611141114C1574,10NTRF${US.batch.id}//FICTREF0101`, `:86:PAYOUT ${US.batch.id}`, ":61:2611141114D25,00NCHGNONREF//FICTREF0102", ":86:Wire fee",
    ":62F:C261114USD1649,10", "-}"].join("\r\n"));
}

/** Provider export, JSON: nested objects per payment. Settlement report, JSON: batch totals only. Bank: camt.053. */
export function aeExportJson(): Uint8Array {
  return utf8(JSON.stringify({ exported: "2026-11-21", data: AE.orders.map((o) => ({
    order: { id: o.orderId, amount: o.invoice, currency: "AED" },
    quote: { id: o.quoteId, rate: o.rate, address: o.address, created: o.created.replace(".000Z", "+00:00"), expires: o.expires.replace(".000Z", "Z"), crypto: { amount: o.quoted, contract: AE.contract, network: "tron", symbol: "USDT" } },
    payment: { id: o.payment!.id, status: o.payment!.status, received: o.payment!.received, credited: o.payment!.credited, rate: o.payment!.exec, fee: o.payment!.fee, batch: o.payment!.batch, tx: { hash: hash(o.payment!.txIndex), index: 0 }, at: o.payment!.paidAt },
  })) }));
}
export const AE_EXPORT_MAPPING: Mapping = {
  fileType: "provider_export",
  columns: {
    order_id: { header: "order.id" }, invoice_amount: { header: "order.amount" }, currency: { header: "order.currency" }, quote_id: { header: "quote.id" }, quote_rate: { header: "quote.rate" },
    deposit_address: { header: "quote.address" }, created_at: { header: "quote.created" }, expires_at: { header: "quote.expires" }, quoted_token_amount: { header: "quote.crypto.amount" },
    token_contract: { header: "quote.crypto.contract" }, network: { header: "quote.crypto.network" }, token_symbol: { header: "quote.crypto.symbol" }, rate_source: { constant: "provider quote" },
    payment_id: { header: "payment.id" }, status: { header: "payment.status", statusValueMap: { paid: "paid" } }, received_token_amount: { header: "payment.received" }, credited_fiat: { header: "payment.credited" },
    executed_rate: { header: "payment.rate" }, fee: { header: "payment.fee" }, batch_id: { header: "payment.batch" }, tx_hash: { header: "payment.tx.hash" }, log_index: { header: "payment.tx.index" }, paid_at: { header: "payment.at" },
  },
};
export function aeSettlementJson(): Uint8Array {
  return utf8(JSON.stringify({ report: { provider: "Provider B (fictional)" }, batches: [{ id: AE.batch.id, day: AE.batch.day, currency: "AED", account: AE.account, totals: { gross: AE.batch.gross, fees: AE.batch.fees, refunds: "0.00", net: AE.batch.net } }] }));
}
export const AE_SETTLEMENT_MAPPING: Mapping = {
  fileType: "settlement_report", shape: "batch_totals",
  columns: { batch_id: { header: "id" }, provider_day: { header: "day" }, currency: { header: "currency" }, bank_account: { header: "account" }, gross: { header: "totals.gross" }, fee: { header: "totals.fees" }, refund: { header: "totals.refunds" }, net: { header: "totals.net" } },
};
export function aeCamt053(): Uint8Array {
  return utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><GrpHdr><MsgId>FICT-AE-1</MsgId><CreDtTm>2026-11-21T01:00:00</CreDtTm></GrpHdr>
<Stmt><Id>FICT-AE-STMT-1</Id><Acct><Id><IBAN>${AE.account}</IBAN></Id><Ccy>AED</Ccy></Acct>
<Ntry><NtryRef>FICT-AE-N1</NtryRef><Amt Ccy="AED">5453.66</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-11-21</Dt></BookgDt><ValDt><Dt>2026-11-21</Dt></ValDt>
<AcctSvcrRef>FICT-AE-REF-1</AcctSvcrRef><NtryDtls><TxDtls><Refs><EndToEndId>${AE.batch.id}</EndToEndId></Refs><RmtInf><Ustrd>PAYOUT ${AE.batch.id}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`);
}
