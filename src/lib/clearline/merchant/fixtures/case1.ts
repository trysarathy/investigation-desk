/**
 * Case 1 — Singapore entity, SGD, rate 1.3500, provider fee 1%, batch B-1124-001. Test mode · illustrative data.
 * Every name, address and hash is fictional.
 */
import { DEFAULT_POLICY } from "../config";
import type { MerchantEntity, ReconcileInput } from "../types";
import { SGT, USDC, USDT, UTC, depositAddress, label, minor, networks, quote, record, tokens, transfer, walletAddress } from "./common";

export const CASE1_ENTITY: MerchantEntity = { id: "ENT-SG-01", name: "Harbourline Demo Pte. Ltd. (fictional)", functionalCurrency: "SGD", ledger: "LEDGER-SG-01", timeZone: SGT };
export const CASE1_BATCH = "B-1124-001";
export const EXCHANGE_SENDER = walletAddress("tron", "EXCHANGE_HOT_1");

export function case1(): ReconcileInput {
  const q17 = quote("BK-24817", USDT, "1000.00", "1.3500", "2026-11-24T02:00:00.000Z");
  const q23 = quote("BK-24823", USDT, "2000.00", "1.3500", "2026-11-24T02:10:00.000Z");
  const q30 = quote("BK-24830", USDC, "600.00", "1.3500", "2026-11-24T02:20:00.000Z");
  const q36 = quote("BK-24836", USDT, "1000.00", "1.3500", "2026-11-24T03:00:00.000Z");
  const t17 = transfer(USDT, "24817", q17.depositAddress, EXCHANGE_SENDER, "999.00", "2026-11-24T02:05:00.000Z", 70_100_017);
  const t23 = transfer(USDT, "24823", q23.depositAddress, walletAddress("tron", "CUSTOMER_23"), "1760.00", "2026-11-24T02:15:00.000Z", 70_100_023);
  const t30 = transfer(USDC, "24830", q30.depositAddress, walletAddress("ethereum", "CUSTOMER_30"), "708.00", "2026-11-24T02:25:00.000Z", 21_400_030);
  // 26 minutes after the quote expired (03:30), re-quoted by the provider at 1.3410.
  const t36 = transfer(USDT, "24836", q36.depositAddress, walletAddress("tron", "CUSTOMER_36"), "1000.00", "2026-11-24T03:56:00.000Z", 70_100_036);
  const providerRecords = [
    record("PP-24817", t17, { quoteId: q17.quoteId }, "paid", "1348.65", "1.3500", CASE1_BATCH),
    record("PP-24823", t23, { quoteId: q23.quoteId }, "underpaid", "2376.00", "1.3500", CASE1_BATCH),
    record("PP-24830", t30, { quoteId: q30.quoteId }, "overpaid", "955.80", "1.3500", CASE1_BATCH),
    record("PP-24836", t36, { quoteId: q36.quoteId }, "re_quoted", "1341.00", "1.3410", CASE1_BATCH),
  ];
  return {
    label, entity: CASE1_ENTITY, policy: DEFAULT_POLICY, networks, tokens,
    invoices: [
      { orderId: "BK-24817", entityId: CASE1_ENTITY.id, amountMinor: minor("1350.00"), currency: "SGD", status: "open" },
      { orderId: "BK-24823", entityId: CASE1_ENTITY.id, amountMinor: minor("2700.00"), currency: "SGD", status: "open" },
      { orderId: "BK-24830", entityId: CASE1_ENTITY.id, amountMinor: minor("810.00"), currency: "SGD", status: "open" },
      { orderId: "BK-24836", entityId: CASE1_ENTITY.id, amountMinor: minor("1350.00"), currency: "SGD", status: "open" },
    ],
    quotes: [q17, q23, q30, q36],
    paymentLinks: [],
    transfers: [t17, t23, t30, t36],
    providerRecords,
    batches: [{
      batchId: CASE1_BATCH, providerDay: "2026-11-24", providerTimeZone: UTC, currency: "SGD", targetBankAccount: "SGD-OPS-FICT-001",
      grossMinor: minor("6021.45"), feesMinor: minor("60.21"), refundsMinor: 0n, netMinor: minor("5961.24"),
    }],
    batchLines: providerRecords.map((r) => ({ batchId: CASE1_BATCH, kind: "payment" as const, providerPaymentId: r.providerPaymentId, orderId: `BK-${r.providerPaymentId.slice(3)}`, amountMinor: r.creditedMinor })),
    bankLines: [{
      bankLineId: "BL-SG-1125-01", account: "SGD-OPS-FICT-001", currency: "SGD", valueDate: "2026-11-25", amountMinor: minor("5961.24"),
      description: `Fictional Pay Provider settlement ${CASE1_BATCH}`, source: "bank_feed", provenance: "fictional bank feed, statement 2026-11-25",
    }],
    fxRates: [{ pair: "USDT/SGD", rate: "1.3500", source: "Fictional Rate Desk", timestamp: "2026-11-24T02:00:00.000Z" }],
    addressFacts: [{ network: "tron", address: EXCHANGE_SENDER, fact: "exchange_hot_wallet" }],
    merchantDay: "2026-11-24",
  };
}

/** Deposit addresses of the two SGD 1,350.00 orders, for the never-cross-matched test. */
export const CASE1_TWIN_ADDRESSES = { "BK-24817": depositAddress(USDT, "BK-24817"), "BK-24836": depositAddress(USDT, "BK-24836") };
