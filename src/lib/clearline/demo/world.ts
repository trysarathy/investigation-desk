/**
 * The demo world (`npm run demo`): one fictional provider, "Provider P (demo)", and one fictional merchant,
 * "Northwind Travel (demo)", with 30 days of stablecoin payments ending the day before DEMO_TODAY. Pure and
 * deterministic: the seeded synthetic generator (src/lib/clearline/synthetic) for the bulk, plus the three documented
 * rc6 cases with their exact numbers. Every name, address, hash and account is fictional; the only real values are the
 * public USDT and USDC contracts.
 *
 * Entities [ASSUMPTION, the existing model]: an entity has one functional currency, and reconciliation reads only
 * statement lines in that currency. v1 added a table of bank accounts (one row per entity below, DEMO_BANK_ACCOUNTS),
 * but the Singapore company's USD account stays its USD book, a second entity row in USD (as rc6 Case 2 and the
 * synthetic month preset do): moving it under NW-SG as a second account would need the engine to reconcile USD lines
 * in an SGD entity, which would change Case 2's USD payments. The account a batch or statement names is still a text
 * reference (NW-SGD-OPS-DEMO-01 and so on).
 *
 * Cases: Case 1 and Case 2 (SGD) are in the Singapore SGD book, Case 2's USD payments in the USD book, Case 3 in the
 * UAE entity. Only the entity id and the bank account reference of each fixture are changed (to Northwind's); every
 * amount, id, date and rate is the fixture's own. The generated payments avoid the cases' days in those books
 * (`blockedDays`), because the bridge runs per merchant day: a generated payment on a case's day would change the
 * case's merchant-day line.
 */
import { defaultPolicyFor } from "../merchant/config";
import { case1 } from "../merchant/fixtures/case1";
import { case2Sgd, case2Usd } from "../merchant/fixtures/case2";
import { case3 } from "../merchant/fixtures/case3";
import type { FiatCurrency, ReconcileInput } from "../merchant/types";
import { TARGET_POLICY, generateWorld, toReconcileInput, type SyntheticWorld, type WorldParams } from "../synthetic";
import type { WorldEntitySpec } from "../synthetic/world";
import { DEMO_FIRST_DAY, DEMO_WINDOW_DAYS } from "./clock";

export const DEMO_SEED = 20_261_207;

export const DEMO_PROVIDER = { slug: "provider-p-demo", name: "Provider P (demo)" } as const;
export const DEMO_MERCHANT = { slug: "northwind-travel-demo", name: "Northwind Travel (demo)", timezone: "Asia/Singapore" } as const;

/** White-label theme of the demo provider: a simple placeholder mark (no image file) and calm colours. */
export const DEMO_THEME = {
  label: "Demo · fictional data",
  name: "Provider P (demo)",
  colours: { primary: "#2F5D62", accent: "#C98A2B", surface: "#F6F8F7", text: "#16242A" },
  logo: { kind: "placeholder", text: "P", alt: "Provider P (demo) logo placeholder" },
};
/** The same mark as an SVG (docs and the runbook; nothing in the app loads it from the network). */
export const DEMO_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Provider P (demo) logo placeholder"><rect width="64" height="64" rx="14" fill="#2F5D62"/><path d="M22 46V18h12a9 9 0 0 1 0 18H28" fill="none" stroke="#F6F8F7" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="46" cy="46" r="4" fill="#C98A2B"/></svg>';

const SGT = { name: "Asia/Singapore", utcOffsetMinutes: 480 };
const GST = { name: "Asia/Dubai", utcOffsetMinutes: 240 };

export const DEMO_ACCOUNTS = { SGD: "NW-SGD-OPS-DEMO-01", USD: "NW-USD-OPS-DEMO-02", AED: "NW-AED-OPS-DEMO-03" } as const;
export const DEMO_ENTITY_IDS = { SG: "NW-SG", SG_USD: "NW-SG-USD", AE: "NW-AE" } as const;

export const DEMO_ENTITIES: readonly (WorldEntitySpec & { ledgerProduct: "xero" | "quickbooks" })[] = [
  { id: DEMO_ENTITY_IDS.SG, code: "SG", name: "Northwind Travel Pte. Ltd. (demo)", currency: "SGD", timeZone: SGT, ledger: "LEDGER-NW-SG", bankAccountId: DEMO_ACCOUNTS.SGD, share: 0.6, ledgerProduct: "xero" },
  { id: DEMO_ENTITY_IDS.SG_USD, code: "SU", name: "Northwind Travel Pte. Ltd., USD account (demo)", currency: "USD", timeZone: SGT, ledger: "LEDGER-NW-SG", bankAccountId: DEMO_ACCOUNTS.USD, share: 0.15, ledgerProduct: "xero" },
  { id: DEMO_ENTITY_IDS.AE, code: "AE", name: "Northwind Travel FZ-LLC (demo)", currency: "AED", timeZone: GST, ledger: "LEDGER-NW-AE", bankAccountId: DEMO_ACCOUNTS.AED, share: 0.25, ledgerProduct: "quickbooks" },
];

/** v1: each demo entity's bank account as a bank_accounts row (masked number only; fictional). */
export const DEMO_BANK_ACCOUNTS: Readonly<Record<string, { name: string; last4: string; bankName: string }>> = {
  [DEMO_ENTITY_IDS.SG]: { name: `${DEMO_ACCOUNTS.SGD} (SGD operating)`, last4: "DE01", bankName: "Fictional Harbour Bank (demo)" },
  [DEMO_ENTITY_IDS.SG_USD]: { name: `${DEMO_ACCOUNTS.USD} (USD operating)`, last4: "DE02", bankName: "Fictional Harbour Bank (demo)" },
  [DEMO_ENTITY_IDS.AE]: { name: `${DEMO_ACCOUNTS.AED} (AED operating)`, last4: "DE03", bankName: "Fictional Harbour Bank (demo)" },
};

const BANK_ACCOUNTS = DEMO_ENTITIES.map((e) => ({
  accountId: e.bankAccountId, currency: e.currency, bankName: "Fictional Harbour Bank (demo)", holderName: e.name,
  openingBalanceMinor: e.currency === "AED" ? 61_250_000n : e.currency === "USD" ? 8_400_000n : 24_310_000n,
}));

/** Days the generated payments avoid, per entity (provider day UTC or merchant day): the documented cases' days. */
export const CASE_DAYS: Readonly<Record<string, readonly string[]>> = {
  [DEMO_ENTITY_IDS.SG]: ["2026-11-24", "2026-11-25", "2026-11-26"],
  [DEMO_ENTITY_IDS.SG_USD]: ["2026-11-25"],
  [DEMO_ENTITY_IDS.AE]: ["2026-12-01", "2026-12-02", "2026-12-03"],
};

/**
 * Situation mix for the demo [ASSUMPTION, chosen for a realistic month, not from data]: most payments exact; a
 * minority with explained differences (fees, rates, re-quotes, small under- and overpayments, partials across chains)
 * and a small number that should not close (beyond the band, held, unknown batch, pending, no transfer, look-alike).
 */
export const DEMO_MIX: NonNullable<WorldParams["mix"]> = {
  duplicate_amount: 0.006, amount_coincidence: 0.004, sender_side_fee: 0.04,
  underpayment_within: 0.02, underpayment_beyond: 0.006, overpayment_within: 0.02, overpayment_beyond: 0.005,
  requote_within: 0.015, requote_beyond: 0.004, rate_difference: 0.03, credit_mismatch: 0.002,
  partial_open: 0.006, partial_completed: 0.012, held_by_provider: 0.0005, unknown_batch: 0.002,
  pending_claimed_paid: 0.002, pending_claim: 0.002, no_chain_transfer: 0.002, lookalike_token: 0.001,
  late_settlement: 0.02, policy_band_small: 0.003, policy_band_large: 0.003, unpaid: 0.02,
};

const ORDER_BASE: Readonly<Record<string, number>> = { SG: 30_000, SU: 50_000, AE: 70_000 };

export const DEMO_PARAMS: WorldParams = {
  seed: DEMO_SEED, month: "2026-11", startDate: DEMO_FIRST_DAY, activeDays: DEMO_WINDOW_DAYS, paymentCount: 1_453,
  entities: DEMO_ENTITIES, bankAccounts: BANK_ACCOUNTS, chains: ["tron", "ethereum"], mix: DEMO_MIX, policy: TARGET_POLICY,
  providerName: "Provider P (demo)", blockedDays: CASE_DAYS,
  orderIdFor: (code, n) => `BK-${ORDER_BASE[code] + n}`,
};

/** A case fixture moved to a Northwind entity and account; every amount, id, date and rate is unchanged. */
function moveCase(input: ReconcileInput, entityId: string, account: string): ReconcileInput {
  const spec = DEMO_ENTITIES.find((e) => e.id === entityId)!;
  return {
    ...input,
    entity: { ...input.entity, id: entityId, name: spec.name, ledger: spec.ledger },
    invoices: input.invoices.map((i) => ({ ...i, entityId })),
    batches: input.batches.map((b) => ({ ...b, targetBankAccount: account })),
    bankLines: input.bankLines.map((l) => ({ ...l, account, provenance: `Demo bank feed (simulated, fictional) ${l.valueDate}` })),
  };
}

export const DEMO_CASES = (): { entityId: string; caseId: "case1" | "case2" | "case2_usd" | "case3"; input: ReconcileInput }[] => [
  { entityId: DEMO_ENTITY_IDS.SG, caseId: "case1", input: moveCase(case1(), DEMO_ENTITY_IDS.SG, DEMO_ACCOUNTS.SGD) },
  { entityId: DEMO_ENTITY_IDS.SG, caseId: "case2", input: moveCase(case2Sgd(), DEMO_ENTITY_IDS.SG, DEMO_ACCOUNTS.SGD) },
  { entityId: DEMO_ENTITY_IDS.SG_USD, caseId: "case2_usd", input: moveCase(case2Usd(), DEMO_ENTITY_IDS.SG_USD, DEMO_ACCOUNTS.USD) },
  { entityId: DEMO_ENTITY_IDS.AE, caseId: "case3", input: moveCase(case3(), DEMO_ENTITY_IDS.AE, DEMO_ACCOUNTS.AED) },
];

/**
 * Exists only where the demo world is bundled. Never in any Next build today (only `npm run demo`'s tsx scripts and the
 * tests load it); scripts/build/check-chain-recording.mjs --marker seed checks that no build ever starts carrying it.
 */
export const DEMO_SEED_MARKER = "clearline-demo-seed[demo-build-only]";

export interface DemoWorld { world: SyntheticWorld; inputs: ReconcileInput[]; marker: typeof DEMO_SEED_MARKER }

const concat = <K extends keyof ReconcileInput>(xs: ReconcileInput[], k: K) => xs.flatMap((x) => (x[k] ?? []) as unknown[]) as unknown as ReconcileInput[K];

/** One ReconcileInput per demo entity: generated payments plus the cases, under that entity's default policy. */
export function demoWorld(): DemoWorld {
  const world = generateWorld(DEMO_PARAMS);
  const cases = DEMO_CASES();
  const inputs = DEMO_ENTITIES.map((e) => {
    const gen = toReconcileInput(world, e.id);
    const parts = [gen, ...cases.filter((c) => c.entityId === e.id).map((c) => c.input)];
    const bankLines = concat(parts, "bankLines").map((l) => (l.provenance?.startsWith("Demo bank feed") ? l : { ...l, provenance: `Demo bank feed (simulated, fictional) ${l.valueDate}` }));
    return {
      ...gen, policy: defaultPolicyFor(e.currency as FiatCurrency),
      invoices: concat(parts, "invoices"), quotes: concat(parts, "quotes"), paymentLinks: concat(parts, "paymentLinks"), transfers: concat(parts, "transfers"),
      providerRecords: concat(parts, "providerRecords"), batches: concat(parts, "batches"), batchLines: concat(parts, "batchLines"), bankLines,
      fxRates: concat(parts, "fxRates"), addressFacts: concat(parts, "addressFacts"),
    } satisfies ReconcileInput;
  });
  return { world, inputs, marker: DEMO_SEED_MARKER };
}
