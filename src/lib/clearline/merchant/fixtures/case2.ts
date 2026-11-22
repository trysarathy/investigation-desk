/**
 * Case 2 — one settlement, many payments. Two bank accounts (SGD and USD); the provider's day is UTC, the merchant's
 * day is SGT. Orders are generated deterministically (no randomness) so every total ties exactly.
 * Test mode · illustrative data: every name, address and hash is fictional.
 */
import { divRoundHalfUp } from "../amounts";
import { DEFAULT_POLICY } from "../config";
import type { ChainTransfer, Invoice, MerchantEntity, ProviderPaymentRecord, Quote, ReconcileInput, SettlementBatchLine, TokenRef } from "../types";
import { SGT, USDC, USDT, UTC, label, minor, networks, quote, record, tokens, transfer, walletAddress } from "./common";

export const CASE2_SG: MerchantEntity = { id: "ENT-SG-02", name: "Lanternfield Demo Pte. Ltd. (fictional)", functionalCurrency: "SGD", ledger: "LEDGER-SG-02", timeZone: SGT };
export const CASE2_US: MerchantEntity = { id: "ENT-US-02", name: "Lanternfield Demo Pte. Ltd., USD book (fictional)", functionalCurrency: "USD", ledger: "LEDGER-US-02", timeZone: SGT };
export const HELD_ORDER = "BK-24871";
export const REFUND_ORDER = "BK-24788";

interface Spec { orderId: string; amount: bigint; at: string; batchId?: string; held?: boolean }

const iso = (base: string, minutes: number) => new Date(Date.parse(base) + minutes * 60_000).toISOString();
const formatMinor = (m: bigint) => `${m / 100n}.${(m % 100n).toString().padStart(2, "0")}`;
/** Base units (6 decimals) whose value at `rateCents` per token rounds half-up to exactly `amount` minor units. */
const baseFor = (amount: bigint, rateCents: bigint) => divRoundHalfUp(amount * 1_000_000n, rateCents);
const fmtUnits = (u: bigint) => `${u / 1_000_000n}.${(u % 1_000_000n).toString().padStart(6, "0")}`;

/** The 33 merchant-day orders (25 Nov SGT) plus 2 next-day orders, all at 1.3500. */
export function case2SgdSpecs(): Spec[] {
  const specs: Spec[] = [];
  const prior = [minor("900.00"), minor("990.00"), minor("1080.00")]; // 2,970.00, settled in the prior batch
  prior.forEach((amount, i) => specs.push({ orderId: `BK-2485${i}`, amount, at: iso("2026-11-24T16:10:00.000Z", i * 30), batchId: "B-1124-SGD" }));
  let k = 0;
  let regular = 0n;
  for (let n = 24853; n <= 24882; n++) {
    const at = iso("2026-11-25T00:30:00.000Z", (n - 24853) * 30);
    if (`BK-${n}` === HELD_ORDER) { specs.push({ orderId: HELD_ORDER, amount: minor("1200.00"), at, held: true }); continue; }
    const amount = k < 28 ? minor("1100.00") + BigInt((k * 37) % 17) * minor("35.00") : minor("40242.30") - regular; // last one ties the total
    regular += amount;
    k++;
    specs.push({ orderId: `BK-${n}`, amount, at, batchId: "B-1125-SGD" });
  }
  specs.push({ orderId: "BK-24883", amount: minor("810.00"), at: "2026-11-25T16:30:00.000Z", batchId: "B-1125-SGD" }); // 26 Nov SGT, 25 Nov UTC
  specs.push({ orderId: "BK-24884", amount: minor("810.00"), at: "2026-11-25T17:15:00.000Z", batchId: "B-1125-SGD" });
  return specs;
}

const USD_AMOUNTS = ["1000.00", "1200.00", "1250.00", "1300.00", "1400.00", "1500.00", "1800.00"]; // 9,450.00

function build(entity: MerchantEntity, specs: Spec[], rate: string, tokenFor: (i: number) => TokenRef) {
  const rateCents = BigInt(rate.replace(".", "")) / 100n;
  const invoices: Invoice[] = [];
  const quotes: Quote[] = [];
  const transfers: ChainTransfer[] = [];
  const providerRecords: ProviderPaymentRecord[] = [];
  specs.forEach((s, i) => {
    const token = tokenFor(i);
    const tag = s.orderId.slice(3);
    const q = quote(s.orderId, token, fmtUnits(baseFor(s.amount, rateCents)), rate, iso(s.at, -5));
    const t = transfer(token, tag, q.depositAddress, walletAddress(token.network, `CUSTOMER_${tag}`), fmtUnits(q.quotedBaseUnits), s.at, 70_200_000 + i);
    const r = record(`PP-${tag}`, t, { quoteId: q.quoteId }, s.held ? "held_for_review" : "paid", formatMinor(s.amount), rate, s.batchId);
    invoices.push({ orderId: s.orderId, entityId: entity.id, amountMinor: s.amount, currency: entity.functionalCurrency, status: "open" });
    quotes.push(q);
    transfers.push(t);
    providerRecords.push(s.held ? { ...r, displayedStatus: "completed" } : r);
  });
  const batchLines: SettlementBatchLine[] = specs.filter((s) => s.batchId).map((s) => ({ batchId: s.batchId!, kind: "payment", providerPaymentId: `PP-${s.orderId.slice(3)}`, orderId: s.orderId, amountMinor: s.amount }));
  return { invoices, quotes, transfers, providerRecords, batchLines };
}

const common = { label, networks, tokens, paymentLinks: [], addressFacts: [] };

export function case2Sgd(): ReconcileInput {
  const b = build(CASE2_SG, case2SgdSpecs(), "1.3500", (i) => (i % 2 ? USDC : USDT));
  const refund: SettlementBatchLine = { batchId: "B-1125-SGD", kind: "refund", refundId: "RF-24788", orderId: REFUND_ORDER, amountMinor: minor("1215.00") }; // 900 USDT at 1.35
  const batch = (batchId: string, providerDay: string, gross: string, fees: string, refunds: string, net: string) => ({
    batchId, providerDay, providerTimeZone: UTC, currency: "SGD" as const, targetBankAccount: "SGD-OPS-FICT-002", grossMinor: minor(gross), feesMinor: minor(fees), refundsMinor: minor(refunds), netMinor: minor(net),
  });
  const bank = (id: string, valueDate: string, amount: string, batchId: string) => ({
    bankLineId: id, account: "SGD-OPS-FICT-002", currency: "SGD" as const, valueDate, amountMinor: minor(amount), description: `Fictional Pay Provider settlement ${batchId}`, source: "bank_feed" as const, provenance: `fictional bank feed ${valueDate}`,
  });
  return {
    ...common, ...b, entity: CASE2_SG, policy: DEFAULT_POLICY,
    batchLines: [...b.batchLines, refund],
    batches: [batch("B-1124-SGD", "2026-11-24", "2970.00", "29.70", "0", "2940.30"), batch("B-1125-SGD", "2026-11-25", "41862.30", "418.62", "1215.00", "40228.68")],
    bankLines: [bank("BL-SG-1125-02", "2026-11-25", "2940.30", "B-1124-SGD"), bank("BL-SG-1126-02", "2026-11-26", "40228.68", "B-1125-SGD")],
    fxRates: [{ pair: "USDT/SGD", rate: "1.3500", source: "Fictional Rate Desk", timestamp: "2026-11-25T00:00:00.000Z" }],
  };
}

export function case2Usd(): ReconcileInput {
  const specs = USD_AMOUNTS.map((a, i) => ({ orderId: `BK-2490${i + 1}`, amount: minor(a), at: iso("2026-11-25T01:00:00.000Z", i * 60), batchId: "B-1125-USD" }));
  return {
    ...common, ...build(CASE2_US, specs, "1.0000", () => USDC), entity: CASE2_US, policy: DEFAULT_POLICY,
    batches: [{ batchId: "B-1125-USD", providerDay: "2026-11-25", providerTimeZone: UTC, currency: "USD", targetBankAccount: "USD-OPS-FICT-002", grossMinor: minor("9450.00"), feesMinor: minor("94.50"), refundsMinor: 0n, netMinor: minor("9355.50") }],
    bankLines: [{ bankLineId: "BL-US-1126-02", account: "USD-OPS-FICT-002", currency: "USD", valueDate: "2026-11-26", amountMinor: minor("9355.50"), description: "Fictional Pay Provider settlement B-1125-USD", source: "bank_feed", provenance: "fictional bank feed 2026-11-26" }],
    fxRates: [{ pair: "USDC/USD", rate: "1.0000", source: "Fictional Rate Desk", timestamp: "2026-11-25T00:00:00.000Z" }],
  };
}

/** The no-batch-ID path: the USD payments with every batch ID removed. A grouping can only be proposed. */
export function case2UsdNoBatchIds(): ReconcileInput {
  const input = case2Usd();
  return { ...input, batches: [], batchLines: [], providerRecords: input.providerRecords.map((r) => { const c = { ...r }; delete c.batchId; return c; }) };
}
