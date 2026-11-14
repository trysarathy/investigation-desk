"use client";
/** Display text + tone for engine enum values. No status is computed here; labels read engine fields only. */
import type {
  AdvanceState, ExceptionStatus, ExecutionState, HoldStatus, ProcessingOutcome, ReconciliationState,
  SettlementEvidenceState, SettlementScope, Severity, RailKind, PaymentIntent,
} from "@/lib/clearline";
import { Chip, ui, type Family, type Tone } from "./ui";
import { engineLabel } from "./human";
import { TERMINAL_FOR_SETTLEMENT_REPORT } from "@/lib/clearline";

type Map<T extends string> = Record<T, [string, Tone]>;

/* Human labels and tones follow site docs/design/DESIGN_SYSTEM.md v2.0 §8. Provider claims are neutral
 * (never blue or green); green only for evidenced success; amber pending/uncertain; red failed/contradicted. */
export const EXECUTION: Map<ExecutionState> = {
  created: ["Created", "neutral"],
  quoted: ["Quoted", "neutral"],
  approved: ["Approved", "neutral"],
  submitted: ["Submitted to provider", "neutral"],
  in_transit: ["Provider reports in transit", "neutral"],
  provider_reported_completed: ["Provider reports completed", "neutral"],
  awaiting_information: ["Provider needs information", "warn"],
  on_hold: ["On hold with partner", "warn"],
  failed: ["Failed", "bad"],
  returned: ["Returned", "bad"],
  cancelled: ["Cancelled", "neutral"],
  expired: ["Expired", "neutral"],
};

export const SETTLEMENT: Map<SettlementEvidenceState> = {
  none: ["No settlement evidence", "neutral"],
  observed: ["Observed, not verified", "warn"],
  pending_finality: ["Awaiting finality", "warn"],
  verified: ["Verified", "ok"],
  contradicted: ["Evidence contradicts", "bad"],
};

/** Fallback only: the words shown come from the engine (scopeText → HUMAN_LABELS.settlementScope). */
export const SCOPE: Record<SettlementScope, string> = {
  none: "no evidence yet",
  provider_report: "provider report only",
  bank_statement: "by bank statement",
  onchain_transfer: "by on-chain transfer (not a bank credit)",
};

/** Settlement scope in the engine's words (HUMAN_LABELS.settlementScope). */
export const scopeText = (v: SettlementScope): string => engineLabel("settlementScope", v) ?? SCOPE[v];

export const RECON: Map<ReconciliationState> = {
  not_started: ["Not started", "neutral"],
  pending: ["Awaiting match", "warn"],
  matched: ["Matched", "ok"],
  partially_matched: ["Partly matched", "warn"],
  exception: ["Exception", "bad"],
};

export const SEVERITY: Map<Severity> = {
  low: ["Low", "neutral"], medium: ["Medium", "warn"], high: ["High", "bad"], critical: ["Critical", "bad"],
};

export const EXC_STATUS: Map<ExceptionStatus> = {
  open: ["Open", "bad"], in_review: ["In review", "warn"], resolved: ["Resolved", "neutral"], reopened: ["Reopened", "bad"],
};

export const HOLD: Map<HoldStatus> = {
  open: ["Open — partner hold", "warn"],
  documents_submitted: ["Documents submitted", "warn"],
  partner_release_reported: ["Partner reports release — reviewer decision needed", "warn"],
  released: ["Released (reviewer recorded)", "neutral"],
  rejected: ["Rejected (reviewer recorded)", "bad"],
};

export const ADVANCE: Map<AdvanceState> = {
  proposed: ["Proposed", "neutral"], approved: ["Approved", "neutral"], declined: ["Declined", "neutral"],
  supplier_paid: ["Supplier paid (provider-reported)", "neutral"], partly_repaid: ["Partly repaid", "warn"],
  repaid: ["Repaid", "ok"], overdue: ["Overdue", "bad"],
};

export const OUTCOME: Map<ProcessingOutcome> = {
  applied: ["Applied", "neutral"],
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

/** Human label with the exact API value as hidden text and tooltip ("Execution: Provider reports completed, API value provider_reported_completed"). */
function chipFrom<T extends string>(table: string, m: Map<T>, v: T | undefined, family?: Family, extra?: { shape?: string; solid?: boolean; showValue?: boolean; preferLocal?: boolean }) {
  if (!v) return <Chip family={family}>Unknown</Chip>;
  const local = m[v] ?? [human(v), "neutral" as Tone];
  const e: [string, Tone] = [extra?.preferLocal ? local[0] : engineLabel(table, v) ?? local[0], local[1]];
  return (
    <span className="cl-tag" data-api-value={v}>
      <Chip tone={e[1]} family={family} shape={extra?.shape} solid={extra?.solid} title={`API value: ${v}`}>
        {e[0]}<span className={ui.srOnly}>, API value {v}</span>
      </Chip>
      {extra?.showValue && <> <code className={ui.apiValue} aria-hidden="true">{v}</code></>}
    </span>
  );
}

const EVIDENCE_SHAPE: Record<SettlementEvidenceState, string> = { none: "○", observed: "◇", pending_finality: "◇", verified: "◆", contradicted: "✕" };

type V<T> = { v: T; showValue?: boolean };
export const ExecChip = ({ v, showValue }: V<ExecutionState>) => chipFrom("execution", EXECUTION, v, "exec", { showValue });
/**
 * Execution states in which settlement must never look like success (green), whatever evidence
 * exists: the engine's own terminal list (TERMINAL_FOR_SETTLEMENT_REPORT: failed, cancelled, expired,
 * returned) plus the states where the partner still has the money or needs something first
 * (code review rc3 M1). Derived from the engine so the two lists cannot drift.
 */
export const NO_GREEN_SETTLEMENT: readonly ExecutionState[] = [...TERMINAL_FOR_SETTLEMENT_REPORT, "on_hold", "awaiting_information"];
/** Tone for a settlement value, never green when the payout is terminal, held or awaiting information. */
export function settlementTone(v: SettlementEvidenceState, execution?: ExecutionState): Tone {
  const t = SETTLEMENT[v]?.[1] ?? "neutral";
  return t === "ok" && execution && NO_GREEN_SETTLEMENT.includes(execution) ? "warn" : t;
}
/** Words added when verified evidence is not success, so the meaning never rests on colour alone. */
const QUALIFIER: Partial<Record<ExecutionState, string>> = {
  on_hold: "supplier not paid (partner hold)",
  awaiting_information: "supplier not confirmed paid (provider needs information)",
  returned: "supplier not paid (payout returned)",
  failed: "supplier not paid (payout failed)",
  cancelled: "supplier not paid (payout cancelled)",
  expired: "supplier not paid (payout expired)",
};
export function settlementQualifier(v: SettlementEvidenceState, execution?: ExecutionState): string | undefined {
  return v === "verified" && execution && NO_GREEN_SETTLEMENT.includes(execution) ? QUALIFIER[execution] : undefined;
}
export const SettleChip = ({ v, showValue, execution }: V<SettlementEvidenceState> & { execution?: ExecutionState }) => {
  const tone = settlementTone(v, execution);
  const base = SETTLEMENT[v];
  if (!base) return chipFrom("settlement", SETTLEMENT, v, "evidence", { showValue });
  const q = settlementQualifier(v, execution);
  const words = `${engineLabel("settlement", v) ?? base[0]}${q ? ` — ${q}` : ""}`;
  const map: Map<SettlementEvidenceState> = { ...SETTLEMENT, [v]: [words, tone] };
  return chipFrom("settlement", map, v, "evidence", { shape: EVIDENCE_SHAPE[v], solid: v === "verified" || v === "contradicted", showValue, preferLocal: Boolean(q) });
};
/**
 * Reconciliation chip. A returned payout whose bank debit and statement-confirmed return are both
 * allocated is "matched" by the engine but nets to zero: the supplier is still unpaid (CHANGE 4, N2).
 */
export const ReconChip = ({ v, returnStatus, showValue }: V<ReconciliationState> & { returnStatus?: PaymentIntent["returnStatus"] }) =>
  v === "matched" && returnStatus === "confirmed_by_statement"
    ? <span className="cl-tag" data-api-value={v}><Chip tone="warn" family="recon" title={`API value: ${v} (return confirmed by statement). Debit and return both evidenced; the supplier is still unpaid.`}>Returned — net zero<span className={ui.srOnly}>, API value {v}</span></Chip>{showValue && <> <code className={ui.apiValue} aria-hidden="true">{v}</code></>}</span>
    : chipFrom("reconciliation", RECON, v, "recon", { showValue });
export const SevChip = ({ v }: { v: Severity }) => chipFrom("severity", SEVERITY, v);
export const ExcChip = ({ v }: { v: ExceptionStatus }) => chipFrom("exceptionStatus", EXC_STATUS, v);
/**
 * An over-amount accepted above 1% is `resolved` in the engine but waits for a second, different staff
 * person (resolution.acceptedDifference.secondApproval). It is not done: it is shown amber, stays in the open
 * queue and counts as needing attention (review rc3 final m-B).
 */
export function awaitingSecondApproval(e: { status: ExceptionStatus; resolution?: { acceptedDifference?: { secondApproval?: { required: true; approvedBy?: string } } } }): boolean {
  const sa = e.resolution?.acceptedDifference?.secondApproval;
  return e.status === "resolved" && Boolean(sa?.required && !sa.approvedBy);
}
/** Needs a person: not resolved, or resolved but still awaiting a second approval. */
export const needsAttention = (e: Parameters<typeof awaitingSecondApproval>[0]) => e.status !== "resolved" || awaitingSecondApproval(e);
/** Exception status chip that never shows a pending acceptance as plain "Resolved". */
export const ExcStatusChip = ({ e }: { e: Parameters<typeof awaitingSecondApproval>[0] }) =>
  awaitingSecondApproval(e)
    ? <span className="cl-tag" data-api-value={e.status} data-awaiting-approval="true"><Chip tone="warn" title="API value: resolved (accepted difference; secondApproval pending)">Accepted — awaiting second approval<span className={ui.srOnly}>, API value {e.status}</span></Chip></span>
    : <ExcChip v={e.status} />;
export const HoldChip = ({ v }: { v: HoldStatus }) => chipFrom("holdStatus", HOLD, v);
/**
 * Advance state. `supplier_paid` alone is the provider's report; when the engine's supplierPaidBasis says the
 * payout is verified by independent evidence, the chip says so, so the card never reads two ways (review nit).
 */
export const AdvChip = ({ v, basis }: { v: AdvanceState; basis?: "none" | "provider_reported" | "verified_settlement" }) =>
  v === "supplier_paid" && basis === "verified_settlement"
    ? <span className="cl-tag" data-api-value={v}><Chip tone="ok" title={`API value: ${v} (supplierPaidBasis verified_settlement)`}>Supplier paid — verified<span className={ui.srOnly}>, API value {v}</span></Chip></span>
    : chipFrom("advanceState", ADVANCE, v);
/** `held`: the event arrived during a compliance hold and was recorded but not applied (engine detail.suppressedOnHold). */
export const OutcomeChip = ({ v, held }: { v: ProcessingOutcome; held?: boolean }) =>
  held ? <Chip tone="warn" title="Recorded during a compliance hold; a person decides. Not applied.">Held: not applied</Chip> : chipFrom("processingOutcome", OUTCOME, v);

/** Titles for explanation codes that need more than the category name. */
const CODE_TITLE: Record<string, string> = {
  EV_TERMINAL_EVENT_WHILE_ON_HOLD: "Payout returned or failed during a compliance hold (not applied)",
  EV_PROVIDER_EVENT_WHILE_ON_HOLD: "Provider event during a compliance hold (not applied)",
};
export const exceptionTitle = (e: { category: string; explanationCode: string }) => CODE_TITLE[e.explanationCode] ?? engineLabel("exceptionCategory", e.category) ?? human(e.category);

