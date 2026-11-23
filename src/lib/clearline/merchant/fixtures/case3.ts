/**
 * Case 3 — partial payment across chains. UAE entity, AED. Invoice BK-25102 for 18,365.00, quoted as 5,000 USD at
 * 3.6730, paid in two parts through two payment links on two networks. Test mode · illustrative data: every name,
 * address and hash is fictional.
 */
import { defaultPolicyFor } from "../config";
import type { MerchantEntity, MerchantPolicy, PaymentLink, ReconcileInput, SettlementBatch } from "../types";
import { GST, USDC, USDT, UTC, depositAddress, label, minor, networks, quote, record, tokens, transfer, txHash, units, walletAddress } from "./common";

export const CASE3_ENTITY: MerchantEntity = { id: "ENT-AE-03", name: "Dunehaven Demo Trading L.L.C. (fictional)", functionalCurrency: "AED", ledger: "LEDGER-AE-03", timeZone: GST };

/**
 * The AED entity's default policy (founder decision, rc7): band = the larger of 0.5% of the invoice (91.83) or
 * AED 20.00 → 91.83; write-off threshold AED 20.00 [ASSUMPTION: threshold = the fixed amount].
 */
export const CASE3_POLICY: MerchantPolicy = defaultPolicyFor("AED");

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
  // Document A: provider fee 1% of value credited (110.18 and 73.33). [ASSUMPTION] the other 46 and 52 payments in
  // these batches are left out, so each batch here carries only its BK-25102 part.
  const batch = (batchId: string, providerDay: string, gross: string, fee: string, net: string): SettlementBatch => ({
    batchId, providerDay, providerTimeZone: UTC, currency: "AED", targetBankAccount: "AED-OPS-FICT-003", grossMinor: minor(gross), feesMinor: minor(fee), refundsMinor: 0n, netMinor: minor(net),
  });
  const bank = (bankLineId: string, valueDate: string, amount: string, batchId: string) => ({
    bankLineId, account: "AED-OPS-FICT-003", currency: "AED" as const, valueDate, amountMinor: minor(amount), description: `Fictional Pay Provider settlement ${batchId}`, source: "bank_feed" as const, provenance: `fictional bank feed ${valueDate}`,
  });
  return {
    label, entity: CASE3_ENTITY, policy: CASE3_POLICY, networks, tokens,
    invoices: [{ orderId: "BK-25102", entityId: CASE3_ENTITY.id, amountMinor: minor("18365.00"), currency: "AED", status: "open" }],
    quotes: [q], paymentLinks: links, transfers: [t1, t2], providerRecords,
    batches: [batch("B-UAE-1201", "2026-12-01", "11017.50", "110.18", "10907.32"), batch("B-UAE-1203", "2026-12-03", "7333.34", "73.33", "7260.01")],
    batchLines: [
      { batchId: "B-UAE-1201", kind: "payment", providerPaymentId: "PP-25102-1", orderId: "BK-25102", amountMinor: minor("11017.50") },
      { batchId: "B-UAE-1203", kind: "payment", providerPaymentId: "PP-25102-2", orderId: "BK-25102", amountMinor: minor("7333.34") },
    ],
    bankLines: [bank("BL-AE-1202-03", "2026-12-02", "10907.32", "B-UAE-1201"), bank("BL-AE-1204-03", "2026-12-04", "7260.01", "B-UAE-1203")],
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

/** Case 3 under the rejected alternative ("smaller of" 0.5% or AED 20.00 → 20.00): kept to document the difference. */
export const case3SmallerOfPolicy = (): ReconcileInput => ({ ...case3(), policy: { ...CASE3_POLICY, toleranceCombine: "smaller" } });
