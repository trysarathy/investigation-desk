/**
 * Three separate status families. They never share a style, so a reader cannot confuse
 * "the provider said so" with "we hold evidence" with "the books agree".
 *  - Execution: tinted, rounded tag (what the payment/provider state machine says)
 *  - Evidence:  outlined tag with a shape marker (dashed = reported only, solid = evidence verified)
 *  - Reconciliation: square mono uppercase tag (matched / exception / reconciled)
 */
export type ExecState = "created" | "quoted" | "approved" | "submitted" | "in_transit" | "completed" | "failed" | "returned" | "on_hold";
const execTone: Record<ExecState, string> = {
  created: "neutral", quoted: "neutral", approved: "neutral", submitted: "info", in_transit: "info",
  completed: "success", failed: "danger", returned: "danger", on_hold: "warning",
};
export function ExecStatus({ state }: { state: ExecState }) {
  return <span className={"st-exec tone-" + execTone[state]}><span className="sr-only">Execution status: </span>{state}</span>;
}

export type EvidenceState = "none" | "provider_reported_completed" | "settlement_evidence_verified";
const evidenceLabel: Record<EvidenceState, string> = {
  none: "no evidence yet",
  provider_reported_completed: "provider_reported_completed",
  settlement_evidence_verified: "settlement_evidence_verified",
};
export function EvidenceStatus({ state }: { state: EvidenceState }) {
  const mark = state === "settlement_evidence_verified" ? "◆" : state === "provider_reported_completed" ? "◇" : "○";
  return <span className={"st-evidence ev-" + state}><span aria-hidden="true">{mark}</span><span className="sr-only">Evidence status: </span>{evidenceLabel[state]}</span>;
}

export type ReconState = "unreconciled" | "matched" | "exception" | "reconciled";
const reconTone: Record<ReconState, string> = { unreconciled: "neutral", matched: "info", exception: "danger", reconciled: "success" };
export function ReconStatus({ state }: { state: ReconState }) {
  return <span className={"st-recon tone-" + reconTone[state]}><span className="sr-only">Reconciliation status: </span>{state}</span>;
}
