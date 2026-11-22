/**
 * Case 3 — partial payment across chains. UAE entity, AED. Invoice BK-25102 for 18,365.00, quoted as 5,000 USD at
 * 3.6730, paid in two parts through two payment links on two networks. Test mode · illustrative data: every name,
 * address and hash is fictional.
 */
import { DEFAULT_POLICY } from "../config";
import type { MerchantEntity, MerchantPolicy, PaymentLink, ReconcileInput, SettlementBatch } from "../types";
import { GST, USDC, USDT, UTC, depositAddress, label, minor, networks, quote, record, tokens, transfer, txHash, units, walletAddress } from "./common";

export const CASE3_ENTITY: MerchantEntity = { id: "ENT-AE-03", name: "Dunehaven Demo Trading L.L.C. (fictional)", functionalCurrency: "AED", ledger: "LEDGER-AE-03", timeZone: GST };

/**
 * Explicit Case 3 policy. Under the default (min of 0.5% and AED 5.00 → 5.00) the 14.16 gap would be
 * suggested_for_review, not matched_with_difference. The default is unchanged.
 */
export const CASE3_POLICY: MerchantPolicy = {
  ...DEFAULT_POLICY,
  // [ASSUMPTION] pending founder decision: see RC6_PLAN.md §5
  toleranceAbsMinor: minor("100.00"),
  // [ASSUMPTION] pending founder decision: see RC6_PLAN.md §5 (write-off threshold raised with the band)
  writeoffThresholdMinor: minor("100.00"),
};

export const REGISTERED_WALLET = walletAddress("tron", "REGISTERED_25102");
export const INTERMEDIATE_WALLET = walletAddress("tron", "INTERMEDIATE_25102");
export const EXCHANGE_HOT_WALLET = walletAddress("ethereum", "EXCHANGE_HOT_2");

export function case3(): ReconcileInput {
  const q = quote("BK-25102", USDT, "5000.00", "3.6730", "2026-12-01T05:00:00.000Z", 60, "PL-1");
  const links: PaymentLink[] = [
    { linkId: "PL-1", orderId: "BK-25102", quoteId: q.quoteId, kind: "full", token: USDT, depositAddress: q.depositAddress, requestedBaseUnits: units("5000.00"), createdAt: q.createdAt, expiresAt: q.expiresAt },
    { linkId: "PL-2", orderId: "BK-25102", quoteId: q.quoteId, kind: "balance", token: USDC, depositAddress: depositAddress(USDC, "PL-2"), requestedBaseUnits: units("2000.00"), createdAt: "2026-12-02T06:00:00.000Z", expiresAt: "2026-12-03T06:00:00.000Z" },
  ];
  // Part 1: registered wallet → intermediate wallet → PL-1 deposit address (the hop is recorded as a fact).
  const t1 = {
    ...transfer(USDT, "25102_1", links[0].depositAddress, INTERMEDIATE_WALLET, "3000.00", "2026-12-01T05:20:00.000Z", 70_300_001),
    priorHops: [{ from: REGISTERED_WALLET, to: INTERMEDIATE_WALLET, txHash: txHash("tron", "25102_hop") }],
  };
  // Part 2: exchange hot wallet → PL-2 balance-link deposit address.
  const t2 = transfer(USDC, "25102_2", links[1].depositAddress, EXCHANGE_HOT_WALLET, "1996.50", "2026-12-03T04:00:00.000Z", 21_500_002);
  const providerRecords = [
    record("PP-25102-1", t1, { linkId: "PL-1" }, "partially_paid", "11017.50", "3.6725", "B-UAE-1201"),
    record("PP-25102-2", t2, { linkId: "PL-2" }, "paid", "7333.34", "3.6731", "B-UAE-1203"),
  ];
  // [ASSUMPTION] the prompt gives no fee for the Case 3 batches: fee 0.
  const batch = (batchId: string, providerDay: string, amount: string): SettlementBatch => ({
    batchId, providerDay, providerTimeZone: UTC, currency: "AED", targetBankAccount: "AED-OPS-FICT-003", grossMinor: minor(amount), feesMinor: 0n, refundsMinor: 0n, netMinor: minor(amount),
  });
  const bank = (bankLineId: string, valueDate: string, amount: string, batchId: string) => ({
    bankLineId, account: "AED-OPS-FICT-003", currency: "AED" as const, valueDate, amountMinor: minor(amount), description: `Fictional Pay Provider settlement ${batchId}`, source: "bank_feed" as const, provenance: `fictional bank feed ${valueDate}`,
  });
  return {
    label, entity: CASE3_ENTITY, policy: CASE3_POLICY, networks, tokens,
    invoices: [{ orderId: "BK-25102", entityId: CASE3_ENTITY.id, amountMinor: minor("18365.00"), currency: "AED", status: "open" }],
    quotes: [q], paymentLinks: links, transfers: [t1, t2], providerRecords,
    batches: [batch("B-UAE-1201", "2026-12-01", "11017.50"), batch("B-UAE-1203", "2026-12-03", "7333.34")],
    batchLines: [
      { batchId: "B-UAE-1201", kind: "payment", providerPaymentId: "PP-25102-1", orderId: "BK-25102", amountMinor: minor("11017.50") },
      { batchId: "B-UAE-1203", kind: "payment", providerPaymentId: "PP-25102-2", orderId: "BK-25102", amountMinor: minor("7333.34") },
    ],
    bankLines: [bank("BL-AE-1202-03", "2026-12-02", "11017.50", "B-UAE-1201"), bank("BL-AE-1204-03", "2026-12-04", "7333.34", "B-UAE-1203")],
    fxRates: [
      { pair: "USD/AED", rate: "3.6730", source: "Fictional Rate Desk", timestamp: "2026-12-01T05:00:00.000Z" },
      { pair: "USDT/AED", rate: "3.6725", source: "Fictional Pay Provider", timestamp: "2026-12-01T05:20:00.000Z" },
      { pair: "USDC/AED", rate: "3.6731", source: "Fictional Pay Provider", timestamp: "2026-12-03T04:00:00.000Z" },
    ],
    addressFacts: [
      { network: "tron", address: REGISTERED_WALLET, fact: "registered_wallet" },
      { network: "tron", address: INTERMEDIATE_WALLET, fact: "intermediate_wallet" },
      { network: "ethereum", address: EXCHANGE_HOT_WALLET, fact: "exchange_hot_wallet" },
    ],
  };
}

/** The state after part 1 only: PL-2 has been issued but not paid yet. */
export function case3AfterPart1(): ReconcileInput {
  const input = case3();
  return {
    ...input,
    transfers: input.transfers.slice(0, 1), providerRecords: input.providerRecords.slice(0, 1),
    batches: input.batches.slice(0, 1), batchLines: input.batchLines.slice(0, 1), bankLines: input.bankLines.slice(0, 1),
  };
}

/** Case 3 under the unchanged default policy, documenting the tolerance conflict. */
export const case3DefaultPolicy = (): ReconcileInput => ({ ...case3(), policy: DEFAULT_POLICY });
