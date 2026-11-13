/**
 * The engine's three status dimensions, rendered separately (never one combined badge).
 * Names match src/lib/clearline/types.ts on the engine branch:
 *   intent.status = { execution, settlement, settlementScope, reconciliation }
 *  - Execution (ExecutionState): tinted rounded tag — what the payment/provider state machine says.
 *  - Settlement (SettlementEvidenceState + SettlementScope): outlined pill with a shape marker;
 *    dashed border = not (yet) verified, solid = verified or contradicted. The scope says what was evidenced.
 *  - Reconciliation (ReconciliationState): square mono uppercase tag with a left rule.
 */
export type ExecState =
  | "created" | "quoted" | "approved" | "submitted" | "in_transit" | "provider_reported_completed"
  | "awaiting_information" | "on_hold" | "failed" | "returned" | "cancelled" | "expired";
const execTone: Record<ExecState, string> = {
  created: "neutral", quoted: "neutral", approved: "neutral", submitted: "info", in_transit: "info",
  provider_reported_completed: "info", awaiting_information: "warning", on_hold: "warning",
  failed: "danger", returned: "danger", cancelled: "neutral", expired: "neutral",
};
export function ExecStatus({ state }: { state: ExecState }) {
  return <span className={"st-exec tone-" + execTone[state]}><span className="sr-only">Execution: </span>{state}</span>;
}

export type SettlementState = "none" | "observed" | "pending_finality" | "verified" | "contradicted";
export type SettlementScope = "none" | "provider_report" | "bank_statement" | "onchain_transfer";
const settlementMark: Record<SettlementState, string> = { none: "○", observed: "◇", pending_finality: "◇", verified: "◆", contradicted: "✕" };
export function SettlementStatus({ state, scope }: { state: SettlementState; scope?: SettlementScope }) {
  return (
    <span className={"st-settlement stl-" + state}>
      <span aria-hidden="true">{settlementMark[state]}</span>
      <span className="sr-only">Settlement evidence: </span>{state}
      {scope && scope !== "none" && <span className="stl-scope"> · {scope}</span>}
    </span>
  );
}

export type ReconState = "not_started" | "pending" | "matched" | "partially_matched" | "exception";
const reconTone: Record<ReconState, string> = { not_started: "neutral", pending: "neutral", matched: "success", partially_matched: "warning", exception: "danger" };
export function ReconStatus({ state }: { state: ReconState }) {
  return <span className={"st-recon tone-" + reconTone[state]}><span className="sr-only">Reconciliation: </span>{state}</span>;
}
