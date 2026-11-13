/**
 * Fictional sample records mirrored from the product's test-mode engine
 * (src/lib/clearline/core.ts on release/clearline-unified-20261113 @ 6002b13: initialWorkspace,
 * quoteFor(kycTier 2), reconcile, liquiditySnapshots, explain). Amounts are the engine's own minor-unit
 * values formatted to two decimals. Providers are fictional sandbox names. Nothing here is a customer record.
 */
import type { ExecState, EvidenceState, ReconState } from "@/components/Status";

export type SampleEvent = { time: string; label: string; source: string; evidence: string };
export type SamplePayment = {
  id: string; reference: string; beneficiary: string; amount: string; corridor: string; provider: string;
  exec: ExecState; evidence: EvidenceState; recon: ReconState; label: string;
  explanation: string; nextAction: string; events: SampleEvent[];
};

const steps: Record<string, string> = {
  created: "Intent created", quoted: "Eligible routes priced", approved: "Approved in sandbox",
  submitted: "Instruction sent to sandbox partner", in_transit: "Partner reports payout in progress",
};
const times = ["16:46 SGT", "16:55 SGT", "17:04 SGT", "17:13 SGT", "17:22 SGT", "17:31 SGT"];
function timeline(seq: string[], last: string): SampleEvent[] {
  return seq.map((s, i) => ({
    time: times[i],
    label: i === seq.length - 1 ? last : steps[s],
    source: i === 0 ? "Clearline Connect" : i < 3 ? "Clearline test mode" : "Sandbox provider",
    evidence: i >= 3 ? "Partner-reported sandbox event; not independent settlement proof" : "Synthetic test-mode event",
  }));
}

export const SAMPLE_PAYMENTS: SamplePayment[] = [
  {
    id: "pi_3p6x92wa", reference: "INV-2026-141", beneficiary: "Redwood Supplies Ltd", amount: "USD 12,784.90", corridor: "USD → SGD",
    provider: "Harbour FX (sandbox)", exec: "returned", evidence: "none", recon: "unreconciled", label: "Returned",
    explanation: "Harbour FX reported the payout returned. Beneficiary details were rejected. Your operations team should verify the account details before reissuing.",
    nextAction: "Check beneficiary details before reissuing the payment.",
    events: timeline(["created", "quoted", "approved", "submitted", "in_transit", "returned"], "Returned: beneficiary account details rejected"),
  },
  {
    id: "pi_6q1m5y48", reference: "INV-2026-145", beneficiary: "Eastport Trading", amount: "SGD 8,839.50", corridor: "SGD → USD",
    provider: "Northline Payments (sandbox)", exec: "on_hold", evidence: "none", recon: "unreconciled", label: "On hold",
    explanation: "Northline Payments placed this payout on hold and requested supporting invoice documents. Your compliance team decides how to respond.",
    nextAction: "Your compliance team must review the document request.",
    events: timeline(["created", "quoted", "approved", "submitted", "on_hold"], "On hold: supporting invoice requested"),
  },
  {
    id: "pi_2d8b9x71", reference: "INV-2026-149", beneficiary: "Stonebridge Exports", amount: "USDC 6,427.83", corridor: "USDC → USD",
    provider: "USDC on Base Sepolia (testnet)", exec: "in_transit", evidence: "none", recon: "unreconciled", label: "Finality pending",
    explanation: "The testnet transfer has been reported but is waiting for finality confirmations. No independent bank settlement has been verified.",
    nextAction: "Wait for additional testnet block confirmations.",
    events: timeline(["created", "quoted", "approved", "submitted", "in_transit"], "Awaiting testnet finality"),
  },
  {
    id: "pi_7j4e8n20", reference: "INV-2026-126", beneficiary: "Oakwell Engineering", amount: "SGD 24,651.37", corridor: "SGD → PHP",
    provider: "Northline Payments (sandbox)", exec: "completed", evidence: "provider_reported_completed", recon: "matched", label: "Provider says completed",
    explanation: "The sandbox provider reported completion. A settlement statement has not been independently verified.",
    nextAction: "Obtain independent settlement evidence before marking the payment reconciled.",
    events: timeline(["created", "quoted", "approved", "submitted", "in_transit", "completed"], "Partner reports payout completed"),
  },
  {
    id: "pi_8f3k2t90", reference: "INV-2026-137", beneficiary: "Maya Components Pte Ltd", amount: "SGD 48,215.37", corridor: "SGD → PHP",
    provider: "Unassigned", exec: "created", evidence: "none", recon: "unreconciled", label: "Created",
    explanation: "Payment intent created. No quote has been accepted and no payout instruction has been sent.",
    nextAction: "Compare eligible routes and record an approval.",
    events: timeline(["created"], "Payment intent created"),
  },
];

/** quoteFor({ amountMinor: 4821537, currency: "SGD", destinationCurrency: "PHP", kycTier: 2 }) */
export const SAMPLE_QUOTES = [
  { id: "qt_nl91", provider: "Northline Payments (sandbox)", route: "Fiat · local payout", rate: "42.1738", fee: "SGD 18.45", eta: "Within 2 hours", eligible: true, reason: "" },
  { id: "qt_hf28", provider: "Harbour FX (sandbox)", route: "Fiat · correspondent", rate: "42.1651", fee: "SGD 12.75", eta: "Next business day", eligible: true, reason: "" },
  { id: "qt_us67", provider: "USDC on Base Sepolia (testnet)", route: "Stablecoin · testnet", rate: "42.1284", fee: "SGD 7.92", eta: "After confirmation", eligible: true, reason: "" },
  { id: "qt_ex01", provider: "Eastern Corridor (sandbox)", route: "Fiat · restricted", rate: "—", fee: "—", eta: "—", eligible: false, reason: "KYC tier 3 required" },
];

/** reconcile(initialWorkspace()) */
export const SAMPLE_RECON: { reference: string; paymentId: string; amount: string; source: string; recon: ReconState; reason: string }[] = [
  { reference: "INV-2026-126", paymentId: "pi_7j4e8n20", amount: "SGD 24,651.37", source: "Northline settlement export (fictional)", recon: "matched", reason: "Reference and source amount agree (unverified)" },
  { reference: "INV-2026-008", paymentId: "—", amount: "SGD 148.93", source: "Harbour statement (fictional)", recon: "exception", reason: "Unmatched reference" },
];

/** liquiditySnapshots() for the seeded workspace. free = balance − safeguarded − pending − buffer */
export const SAMPLE_LIQUIDITY = [
  { provider: "Northline Payments (sandbox)", currency: "SGD", balance: "112,486.73", safeguarded: "18,542.17", pending: "9,823.38", buffer: "4,800.00", free: "79,321.18" },
  { provider: "Harbour FX (sandbox)", currency: "USD", balance: "64,278.43", safeguarded: "11,000.00", pending: "17,236.34", buffer: "4,500.00", free: "31,542.09" },
  { provider: "USDC on Base Sepolia (testnet)", currency: "USDC", balance: "17,562.82", safeguarded: "0.00", pending: "830.57", buffer: "1,000.00", free: "15,732.25" },
];
