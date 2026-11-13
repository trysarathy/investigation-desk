"use client";
/** Display text + tone for engine enum values. No status is computed here; labels read engine fields only. */
import type {
  AdvanceState, ExceptionStatus, ExecutionState, HoldStatus, ProcessingOutcome, ReconciliationState,
  SettlementEvidenceState, SettlementScope, Severity, RailKind, PaymentIntent,
} from "@/lib/clearline";
import { Chip, type Family, type Tone } from "./ui";

type Map<T extends string> = Record<T, [string, Tone]>;

export const EXECUTION: Map<ExecutionState> = {
  created: ["Created", "neutral"],
  quoted: ["Quoted", "neutral"],
  approved: ["Approved", "info"],
  submitted: ["Submitted to provider", "info"],
  in_transit: ["In transit (provider-reported)", "info"],
  provider_reported_completed: ["Provider reports completed", "ok"],
  awaiting_information: ["Awaiting information", "warn"],
  on_hold: ["On hold (partner)", "warn"],
  failed: ["Failed", "bad"],
  returned: ["Returned", "bad"],
  cancelled: ["Cancelled", "neutral"],
  expired: ["Expired", "neutral"],
};

export const SETTLEMENT: Map<SettlementEvidenceState> = {
  none: ["No settlement evidence", "neutral"],
  observed: ["Evidence observed", "warn"],
  pending_finality: ["Pending finality", "warn"],
  verified: ["Evidence verified", "info"],
  contradicted: ["Evidence contradicted", "bad"],
};

export const SCOPE: Record<SettlementScope, string> = {
  none: "no evidence yet",
  provider_report: "provider report only",
  bank_statement: "bank statement",
  onchain_transfer: "on-chain transfer (not a bank credit)",
};

export const RECON: Map<ReconciliationState> = {
  not_started: ["Not started", "neutral"],
  pending: ["Pending", "neutral"],
  matched: ["Matched", "info"],
  partially_matched: ["Partially matched", "warn"],
  exception: ["Exception", "bad"],
};

export const SEVERITY: Map<Severity> = {
  low: ["Low", "neutral"], medium: ["Medium", "warn"], high: ["High", "bad"], critical: ["Critical", "bad"],
};

export const EXC_STATUS: Map<ExceptionStatus> = {
  open: ["Open", "bad"], in_review: ["In review", "warn"], resolved: ["Resolved", "ok"], reopened: ["Reopened", "bad"],
};

export const HOLD: Map<HoldStatus> = {
  open: ["Open — partner hold", "warn"],
  documents_submitted: ["Documents submitted", "info"],
  partner_release_reported: ["Partner reports release — reviewer decision needed", "warn"],
  released: ["Released (reviewer recorded)", "ok"],
  rejected: ["Rejected (reviewer recorded)", "bad"],
};

export const ADVANCE: Map<AdvanceState> = {
  proposed: ["Proposed", "neutral"], approved: ["Approved", "info"], declined: ["Declined", "neutral"],
  supplier_paid: ["Supplier paid (provider-reported)", "info"], partly_repaid: ["Partly repaid", "warn"],
  repaid: ["Repaid", "ok"], overdue: ["Overdue", "bad"],
};

export const OUTCOME: Map<ProcessingOutcome> = {
  applied: ["Applied", "ok"],
  recorded_no_state_change: ["Recorded, no state change", "neutral"],
  duplicate_ignored: ["Duplicate ignored", "warn"],
  stored_late_no_regression: ["Late, stored without regression", "warn"],
  contradictory_exception_raised: ["Contradiction — exception raised", "bad"],
  rejected_signature: ["Rejected: bad signature", "bad"],
  rejected_unknown_payment: ["Rejected: unknown payment", "bad"],
};

export const RAIL: Record<RailKind, string> = {
  fiat_local: "Local fiat rail",
  fiat_correspondent: "Correspondent fiat rail",
  stablecoin_testnet: "Stablecoin (testnet)",
};

export function human(code: string): string {
  return code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function chipFrom<T extends string>(m: Map<T>, v: T | undefined, family?: Family, extra?: { shape?: string; solid?: boolean }) {
  if (!v) return <Chip family={family}>Unknown</Chip>;
  const e = m[v] ?? [human(v), "neutral" as Tone];
  return <Chip tone={e[1]} family={family} {...extra}>{e[0]}</Chip>;
}

const EVIDENCE_SHAPE: Record<SettlementEvidenceState, string> = { none: "○", observed: "◇", pending_finality: "◇", verified: "◆", contradicted: "◇" };

export const ExecChip = ({ v }: { v: ExecutionState }) => chipFrom(EXECUTION, v, "exec");
export const SettleChip = ({ v }: { v: SettlementEvidenceState }) => chipFrom(SETTLEMENT, v, "evidence", { shape: EVIDENCE_SHAPE[v], solid: v === "verified" });
/**
 * Reconciliation chip. A returned payout whose bank debit and statement-confirmed return are both
 * allocated is "matched" by the engine but nets to zero: the supplier is still unpaid (CHANGE 4, N2).
 */
export const ReconChip = ({ v, returnStatus }: { v: ReconciliationState; returnStatus?: PaymentIntent["returnStatus"] }) =>
  v === "matched" && returnStatus === "confirmed_by_statement"
    ? <Chip tone="warn" family="recon" title="Debit and return both evidenced; the supplier is still unpaid.">Returned — net zero</Chip>
    : chipFrom(RECON, v, "recon");
export const SevChip = ({ v }: { v: Severity }) => chipFrom(SEVERITY, v);
export const ExcChip = ({ v }: { v: ExceptionStatus }) => chipFrom(EXC_STATUS, v);
export const HoldChip = ({ v }: { v: HoldStatus }) => chipFrom(HOLD, v);
export const AdvChip = ({ v }: { v: AdvanceState }) => chipFrom(ADVANCE, v);
/** `held`: the event arrived during a compliance hold and was recorded but not applied (engine detail.suppressedOnHold). */
export const OutcomeChip = ({ v, held }: { v: ProcessingOutcome; held?: boolean }) =>
  held ? <Chip tone="warn" title="Recorded during a compliance hold; a person decides. Not applied.">Held: not applied</Chip> : chipFrom(OUTCOME, v);

/** Titles for explanation codes that need more than the category name. */
const CODE_TITLE: Record<string, string> = {
  EV_TERMINAL_EVENT_WHILE_ON_HOLD: "Payout returned or failed during a compliance hold (not applied)",
  EV_PROVIDER_EVENT_WHILE_ON_HOLD: "Provider event during a compliance hold (not applied)",
};
export const exceptionTitle = (e: { category: string; explanationCode: string }) => CODE_TITLE[e.explanationCode] ?? human(e.category);
