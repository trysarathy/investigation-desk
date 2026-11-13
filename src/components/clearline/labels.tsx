"use client";
/** Display text + tone for engine enum values. No status is derived here; each maps 1:1. */
import type {
  AdvanceState, ExceptionStatus, ExecutionState, HoldStatus, ProcessingOutcome, ReconciliationState,
  SettlementEvidenceState, SettlementScope, Severity, RailKind,
} from "@/lib/clearline";
import { Chip, type Tone } from "./ui";

type Map<T extends string> = Record<T, [string, Tone]>;

export const EXECUTION: Map<ExecutionState> = {
  created: ["Created", "neutral"],
  quoted: ["Quoted", "neutral"],
  approved: ["Approved", "info"],
  submitted: ["Submitted to provider", "info"],
  in_transit: ["In transit (provider-reported)", "info"],
  provider_reported_completed: ["Provider reports completed", "info"],
  awaiting_information: ["Awaiting information", "warn"],
  on_hold: ["On hold (partner)", "warn"],
  failed: ["Failed", "bad"],
  returned: ["Returned", "bad"],
  cancelled: ["Cancelled", "neutral"],
  expired: ["Expired", "neutral"],
};

export const SETTLEMENT: Map<SettlementEvidenceState> = {
  none: ["No settlement evidence", "neutral"],
  observed: ["Evidence observed", "info"],
  pending_finality: ["Pending finality", "warn"],
  verified: ["Evidence verified", "ok"],
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
  matched: ["Matched", "ok"],
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

function chipFrom<T extends string>(m: Map<T>, v: T | undefined) {
  if (!v) return <Chip>Unknown</Chip>;
  const e = m[v] ?? [human(v), "neutral" as Tone];
  return <Chip tone={e[1]}>{e[0]}</Chip>;
}

export const ExecChip = ({ v }: { v: ExecutionState }) => chipFrom(EXECUTION, v);
export const SettleChip = ({ v }: { v: SettlementEvidenceState }) => chipFrom(SETTLEMENT, v);
export const ReconChip = ({ v }: { v: ReconciliationState }) => chipFrom(RECON, v);
export const SevChip = ({ v }: { v: Severity }) => chipFrom(SEVERITY, v);
export const ExcChip = ({ v }: { v: ExceptionStatus }) => chipFrom(EXC_STATUS, v);
export const HoldChip = ({ v }: { v: HoldStatus }) => chipFrom(HOLD, v);
export const AdvChip = ({ v }: { v: AdvanceState }) => chipFrom(ADVANCE, v);
export const OutcomeChip = ({ v }: { v: ProcessingOutcome }) => chipFrom(OUTCOME, v);
