/**
 * Fictional sample records taken from the TESTED sandbox engine's deterministic sample
 * (src/lib/clearline/sample.ts → sampleWorkspace(), scenarios s1–s5, on
 * release/clearline-unified-20261113 @ b250bb4, ENGINE_API CHANGE 2; re-run against 0490e40 (CHANGE 5) and against
 * rc3/clearline-app @ cf8732e and efabe6a on 13 Nov 2026: every status, statement line, exception, quote and due date agrees
 * (efabe6a renamed the fictional statement line ids to SIMBANK-000N so that no real bank is named); exact engine
 * strings restored for the eligible-quote reason, the hold exception action and the s5 next action).
 * The investigation view reads lib/investigations.ts, which is generated from the engine (scripts/engine-investigations.gen.ts). Values were read by running the engine's own read models
 * (investigate, timelineFor, listExceptions, computeLiquidity, fundingProjection) and its
 * formatMinor(); times are the engine's simulated clock converted to SGT (UTC+8).
 * Engine intent ids are sequential and may shift, so the site shows internal references instead.
 * Every organisation, provider, person and amount is fictional. Nothing here is a customer record.
 */
import type { ExecState, ReconState, SettlementScope, SettlementState } from "@/components/Status";

export type SampleEvent = { time: string; label: string; source: string; outcome: string };
export type SamplePayment = {
  scenario: "s1_success" | "s2_returned" | "s3_hold" | "s4_chain" | "s5_funding";
  reference: string; beneficiary: string; amount: string; corridor: string; provider: string; label: string;
  execution: ExecState; settlement: SettlementState; settlementScope: SettlementScope; reconciliation: ReconState;
  /** PaymentIntent.returnStatus — only set when the provider reported a return. */
  returnStatus?: "provider_reported" | "confirmed_by_statement";
  whoActs: string; nextAction: string; unknown: string; events: SampleEvent[];
};

const API = "Provider API response";
const HOOK = "Provider webhook (sandbox)";
const BANK = "Bank statement line (fictional)";

export const SAMPLE_PAYMENTS: SamplePayment[] = [
  {
    scenario: "s1_success", reference: "INV-2026-126", beneficiary: "Oakwell Engineering", amount: "SGD 24,651.37", corridor: "SGD → PHP",
    provider: "Northline Payments (sandbox)", label: "Completed, bank-matched",
    execution: "provider_reported_completed", settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched",
    whoActs: "No one — nothing outstanding", nextAction: "No action required.",
    unknown: "The bank statement evidences the payout debit, not the beneficiary's credit.",
    events: [
      { time: "08:15 SGT", label: "payout.accepted", source: API, outcome: "recorded, no state change" },
      { time: "08:18 SGT", label: "payout.in_transit", source: HOOK, outcome: "applied" },
      { time: "08:21 SGT", label: "payout.completed", source: HOOK, outcome: "applied → provider_reported_completed" },
      { time: "08:24 SGT", label: "Debit SGD 24,651.37 · SIMBANK-0001", source: BANK, outcome: "matched → settlement verified (bank_statement)" },
    ],
  },
  {
    scenario: "s2_returned", reference: "INV-2026-141", beneficiary: "Redwood Supplies Ltd", amount: "USD 12,784.90", corridor: "USD → SGD",
    provider: "Northline Payments (sandbox)", label: "Returned",
    execution: "returned", settlement: "none", settlementScope: "none", reconciliation: "exception", returnStatus: "confirmed_by_statement",
    whoActs: "Exception owner: Maya Tan, Operations (fictional)",
    nextAction: "Verify beneficiary details with the supplier, confirm the returned funds, then create a correction intent.",
    unknown: "No bank statement or chain evidence of settlement yet.",
    events: [
      { time: "08:39 SGT", label: "payout.accepted", source: API, outcome: "recorded, no state change" },
      { time: "08:42 SGT", label: "payout.in_transit", source: HOOK, outcome: "applied" },
      { time: "08:45 SGT", label: "payout.returned", source: HOOK, outcome: "applied → returned; reconciliation exception (returnStatus provider_reported)" },
      { time: "08:48 SGT", label: "Return credit USD 12,784.90 · SIMBANK-0002", source: BANK, outcome: "allocated → returnStatus confirmed_by_statement; still an exception: supplier unpaid" },
    ],
  },
  {
    scenario: "s3_hold", reference: "INV-2026-145", beneficiary: "Eastport Trading", amount: "SGD 8,839.50", corridor: "SGD → USD",
    provider: "Harbour FX (sandbox)", label: "Compliance hold",
    execution: "on_hold", settlement: "none", settlementScope: "none", reconciliation: "pending",
    whoActs: "Compliance reviewer: Priya Nair (fictional)",
    nextAction: "The partner requested documents. Your compliance reviewer decides the response; the hold is never released automatically.",
    unknown: "Partner hold is open; the outcome depends on the partner and your compliance reviewer.",
    events: [
      { time: "09:12 SGT", label: "payout.accepted", source: API, outcome: "recorded, no state change" },
      { time: "09:15 SGT", label: "payout.in_transit", source: HOOK, outcome: "applied" },
      { time: "09:18 SGT", label: "payout.on_hold · documents requested", source: HOOK, outcome: "applied → on_hold" },
      { time: "09:21 SGT", label: "Compliance reviewer assigned", source: "Clearline (sandbox)", outcome: "no automatic release" },
    ],
  },
  {
    scenario: "s4_chain", reference: "INV-2026-149", beneficiary: "Stonebridge Exports", amount: "USDC 6,427.830000", corridor: "USDC → USDC",
    provider: "Tidewater Digital (testnet sandbox)", label: "Base Sepolia, finality pending",
    execution: "provider_reported_completed", settlement: "pending_finality", settlementScope: "onchain_transfer", reconciliation: "pending",
    whoActs: "Unassigned — operations should assign",
    nextAction: "Wait until the finality threshold is reached; observation is not finality. 6 of 12 confirmations so far.",
    unknown: "A chain transfer never proves a supplier bank credit.",
    events: [
      { time: "09:39 SGT", label: "payout.accepted", source: API, outcome: "recorded, no state change" },
      { time: "09:42 SGT", label: "payout.in_transit", source: HOOK, outcome: "applied" },
      { time: "09:45 SGT", label: "Transfer observed on Base Sepolia", source: "Synthetic testnet observation", outcome: "settlement observed (0 confirmations)" },
      { time: "09:48 SGT", label: "payout.completed", source: HOOK, outcome: "applied → provider_reported_completed" },
      { time: "09:51 SGT", label: "6 of 12 confirmations", source: "Synthetic testnet observation", outcome: "settlement pending_finality" },
    ],
  },
  {
    scenario: "s5_funding", reference: "INV-PM-5011", beneficiary: "Pacific Metals (supplier)", amount: "SGD 50,000.00", corridor: "SGD → SGD",
    provider: "Northline Payments (sandbox)", label: "Funded advance",
    execution: "provider_reported_completed", settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched",
    whoActs: "Unassigned — operations should assign",
    nextAction: "Ask the remitter for the payment reference; without it the receipt cannot be allocated.",
    unknown: "The bank statement evidences the payout debit, not the beneficiary's credit.",
    events: [
      { time: "10:00 SGT", label: "Advance approved · maker Maya Tan, checker Daniel Ong", source: "Clearline (sandbox)", outcome: "maker ≠ checker" },
      { time: "10:18 SGT", label: "payout.completed", source: HOOK, outcome: "applied → provider_reported_completed" },
      { time: "10:21 SGT", label: "Debit SGD 50,000.00 · SIMBANK-0003", source: BANK, outcome: "matched → settlement verified (bank_statement)" },
      { time: "10:24 SGT", label: "Credit SGD 30,000.00 · RPY-SEABRIGHT-0001", source: BANK, outcome: "allocated to the repayment obligation (partial)" },
      { time: "10:27 SGT", label: "Credit SGD 20,000.00 · no reference", source: BANK, outcome: "exception: missing_payment_reference" },
    ],
  },
];

/** request_quotes for INV-2026-126 (SGD 24,651.37 → PHP). Every quote is labelled by the engine. */
export const QUOTE_LABEL = "Indicative sandbox quote — not executable";
export const SAMPLE_QUOTES = [
  { provider: "Northline Payments (sandbox)", rail: "fiat_local", rate: "42.1738", providerFee: "SGD 18.45", platformFee: "SGD 24.65", recipient: "PHP 1,037,824.25", eta: "Within 2 hours (sandbox)", eligible: true, reason: "Corridor, currency, country and amount are within this sandbox route's limits." },
  { provider: "Harbour FX (sandbox)", rail: "fiat_correspondent", rate: "42.1651", providerFee: "SGD 12.75", platformFee: "SGD 19.72", recipient: "PHP 1,038,058.38", eta: "Next business day (sandbox)", eligible: true, reason: "Corridor, currency, country and amount are within this sandbox route's limits." },
  { provider: "Harbour FX (sandbox)", rail: "fiat_local", rate: "—", providerFee: "—", platformFee: "—", recipient: "—", eta: "Same day (sandbox)", eligible: false, reason: "Sandbox corridor requires KYC tier 3, which this fictional organisation does not hold." },
  { provider: "Tidewater Digital (testnet sandbox)", rail: "stablecoin_testnet", rate: "—", providerFee: "—", platformFee: "—", recipient: "—", eta: "After 12 testnet confirmations (sandbox)", eligible: false, reason: "PHP payouts are not offered on this route." },
];

/** ws.statementLines after the sample build, with the engine's RC_* explanation codes and texts. */
export const SAMPLE_STATEMENT_LINES: { lineId: string; direction: string; kind: string; amount: string; reference: string; result: "allocated" | "exception"; code: string; text: string }[] = [
  { lineId: "SIMBANK-0001", direction: "debit", kind: "payment", amount: "SGD 24,651.37", reference: "NORTHLINE PAYOUT NLPO-047422AD85", result: "allocated", code: "RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW", text: "Trusted reference, amount, currency and time window all agree." },
  { lineId: "SIMBANK-0002", direction: "credit", kind: "return", amount: "USD 12,784.90", reference: "RETURN NLPO-F93A65C106 ACCOUNT INVALID", result: "allocated", code: "RC_RETURN_CONFIRMS_PROVIDER_RETURN", text: "Return line agrees with the provider's returned-payout report." },
  { lineId: "SIMBANK-0003", direction: "debit", kind: "payment", amount: "SGD 50,000.00", reference: "NORTHLINE PAYOUT NLPO-BD03EA879C", result: "allocated", code: "RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW", text: "Trusted reference, amount, currency and time window all agree." },
  { lineId: "SIMBANK-0004", direction: "credit", kind: "payment", amount: "SGD 30,000.00", reference: "RPY-SEABRIGHT-0001 PART PAYMENT", result: "allocated", code: "RC_REPAYMENT_BY_REFERENCE · RC_PARTIAL_AMOUNT", text: "Repayment allocated by its repayment reference; the remainder stays outstanding." },
  { lineId: "SIMBANK-0005", direction: "credit", kind: "payment", amount: "SGD 20,000.00", reference: "(none)", result: "exception", code: "RC_AMOUNT_ONLY_CANDIDATES", text: "Only the amount agrees with one or more items. Amount alone is never treated as attribution." },
];

/** computeLiquidity(sampleWorkspace()). usable = eligible − restricted − safeguarded − committed payouts − buffer. */
export const LIQUIDITY_POLICY_LABEL = "Illustrative provider-defined liquidity policy (sandbox). Not a regulatory or safeguarding classification; confirm classifications with counsel.";
export const SAMPLE_LIQUIDITY = [
  { account: "NL-SGD-OPS-01", provider: "Northline", currency: "SGD", eligible: "212,486.73", restricted: "5,000.00", safeguarded: "18,542.17", committed: "0.00", buffer: "10,624.33", usable: "178,320.23", freshness: "fresh · 30 min" },
  { account: "HF-USD-NOSTRO-02", provider: "Harbour FX", currency: "USD", eligible: "64,278.43", restricted: "0.00", safeguarded: "11,000.00", committed: "0.00", buffer: "4,500.00", usable: "48,778.43", freshness: "stale · 41 h, excluded" },
  { account: "HF-SGD-OPS-03", provider: "Harbour FX", currency: "SGD", eligible: "42,000.00", restricted: "12,000.00", safeguarded: "9,000.00", committed: "8,839.50", buffer: "4,800.00", usable: "7,360.50", freshness: "fresh · 75 min" },
  { account: "Base Sepolia treasury wallet (synthetic)", provider: "Tidewater", currency: "USDC", eligible: "17,562.820000", restricted: "2,000.000000", safeguarded: "0.000000", committed: "0.000000", buffer: "878.141000", usable: "14,684.679000", freshness: "fresh · 15 min" },
];
export const SAMPLE_USABLE_NOW = "SGD 185,680.73 · USDC 14,684.679000 (stale USD row excluded)";

/** fundingProjection(sampleWorkspace()) — one row. */
export const FUNDING_PROJECTION_LABEL = "Sandbox projection linking a Connect payment to a Funding Desk advance. Not a shared production ledger; the provider makes every credit decision.";
export const SAMPLE_FUNDING = {
  supplierPayout: "INV-PM-5011 · SGD 50,000.00 to Pacific Metals (fictional supplier)",
  payoutStatus: { execution: "provider_reported_completed" as ExecState, settlement: "verified" as SettlementState },
  customer: "Seabright Trading (fictional)",
  principal: "SGD 50,000.00",
  approval: "Prepared by Maya Tan (operator) · approved by Daniel Ong (approver) — maker ≠ checker",
  obligation: "RPY-SEABRIGHT-0001 · due 2026-11-20",
  allocations: "SGD 30,000.00 by repayment reference (SIMBANK-0004)",
  repaid: "SGD 30,000.00",
  outstanding: "SGD 20,000.00",
  state: "partly_repaid",
  /** CHANGE 5 m5: the evidence basis behind "supplier paid". Here the supplier debit is bank-statement verified. */
  supplierPaidBasis: "verified_settlement" as "none" | "provider_reported" | "verified_settlement",
  exception: "SGD 20,000.00 receipt without a reference stays an exception (missing_payment_reference); it is not allocated by amount.",
};

/** listExceptions(sampleWorkspace()). Every exception has a dueDate: explicit, or creation date +
 * EXCEPTION_DUE_DAYS[severity] (critical 1, high 1, medium 3, low 5 — an illustrative sandbox policy). */
export const EXCEPTION_DUE_POLICY = "Due dates follow an illustrative sandbox policy: critical and high 1 day, medium 3 days, low 5 days from creation, unless a date is set explicitly.";
export const SAMPLE_EXCEPTIONS = [
  { category: "returned_payout", reference: "INV-2026-141", severity: "high", status: "in_review", owner: "Maya Tan (fictional)", dueDate: "2026-11-13", action: "Verify beneficiary details with the supplier, confirm the returned funds, then create a correction intent." },
  { category: "compliance_hold", reference: "INV-2026-145", severity: "high", status: "in_review", owner: "Priya Nair (fictional)", dueDate: "2026-11-13", action: "The partner requested documents. Your compliance reviewer decides the response; the hold is never released automatically." },
  { category: "missing_payment_reference", reference: "SIMBANK-0005", severity: "medium", status: "open", owner: "Unassigned", dueDate: "2026-11-15", action: "Ask the remitter for the payment reference; without it the receipt cannot be allocated." },
  { category: "pending_finality", reference: "INV-2026-149", severity: "low", status: "open", owner: "Unassigned", dueDate: "2026-11-17", action: "Wait until the finality threshold is reached; observation is not finality." },
];

/** CHANGE 5 (F2) worked example, using the engine's own amountDifferenceAction() wording and its F2 test amounts
 * (tests/clearline/change5.test.ts: payout SGD 10,000.00, provider report SGD 4,000.00). Not part of the s1–s5 sample. */
export const UNDER_AMOUNT_EXAMPLE = {
  code: "RC_UNDER_AMOUNT_REPORT", category: "unmatched_reconciliation", source: "provider_settlement_report",
  expected: "SGD 10,000.00", reported: "SGD 4,000.00", difference: "SGD 6,000.00", currency: "SGD",
  requiredNextAction: "Ask the provider to explain the SGD 6,000.00 shortfall (fees, partial settlement or a further report) and obtain the bank statement line for the payout. Do not treat the payout as settled until the full amount is evidenced.",
};
