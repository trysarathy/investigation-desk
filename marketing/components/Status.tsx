/**
 * The engine's three status dimensions, rendered separately (never one combined badge).
 * Names match src/lib/clearline/types.ts on the engine branch:
 *   intent.status = { execution, settlement, settlementScope, reconciliation }
 * Each tag shows a HUMAN label first and the EXACT API value second (mono, secondary).
 *  - Execution (ExecutionState): rounded tag — what the provider / state machine says.
 *  - Settlement (SettlementEvidenceState + SettlementScope): pill with a shape marker;
 *    dashed = not (yet) verified, solid = verified or contradicted. Scope says what was evidenced.
 *  - Reconciliation (ReconciliationState): square tag with a left rule.
 * Tones (docs/design/DESIGN_SYSTEM.md §2, §8): green only for evidenced success; amber pending/uncertain;
 * red failed/returned/contradicted/exception; provider claims are NEUTRAL — never blue or green.
 */
import type { ReactNode } from "react";

export type ExecState =
  | "created" | "quoted" | "approved" | "submitted" | "in_transit" | "provider_reported_completed"
  | "awaiting_information" | "on_hold" | "failed" | "returned" | "cancelled" | "expired";
export type SettlementState = "none" | "observed" | "pending_finality" | "verified" | "contradicted";
export type SettlementScope = "none" | "provider_report" | "bank_statement" | "onchain_transfer";
export type ReconState = "not_started" | "pending" | "matched" | "partially_matched" | "exception";
type Tone = "neutral" | "warning" | "danger" | "success";

export const EXEC_LABEL: Record<ExecState, string> = {
  created: "Created", quoted: "Quoted", approved: "Approved", submitted: "Submitted to provider",
  in_transit: "Provider reports in transit", provider_reported_completed: "Provider reports completed",
  awaiting_information: "Provider needs information", on_hold: "On hold with partner",
  failed: "Failed", returned: "Returned", cancelled: "Cancelled", expired: "Expired",
};
const execTone: Record<ExecState, Tone> = {
  created: "neutral", quoted: "neutral", approved: "neutral", submitted: "neutral", in_transit: "neutral",
  provider_reported_completed: "neutral", awaiting_information: "warning", on_hold: "warning",
  failed: "danger", returned: "danger", cancelled: "neutral", expired: "neutral",
};

export const SETTLEMENT_LABEL: Record<SettlementState, string> = {
  none: "No settlement evidence", observed: "Observed, not verified", pending_finality: "Awaiting finality",
  verified: "Verified", contradicted: "Evidence contradicts",
};
export const SCOPE_LABEL: Record<SettlementScope, string> = {
  none: "", provider_report: "by provider report", bank_statement: "by bank statement", onchain_transfer: "by on-chain transfer",
};
const settlementTone: Record<SettlementState, Tone> = { none: "neutral", observed: "warning", pending_finality: "warning", verified: "success", contradicted: "danger" };
const settlementMark: Record<SettlementState, string> = { none: "○", observed: "◇", pending_finality: "◇", verified: "◆", contradicted: "✕" };

export const RECON_LABEL: Record<ReconState, string> = {
  not_started: "Not started", pending: "Awaiting match", matched: "Matched", partially_matched: "Partly matched", exception: "Exception",
};
const reconTone: Record<ReconState, Tone> = { not_started: "neutral", pending: "warning", matched: "success", partially_matched: "warning", exception: "danger" };

/** `api`: show the exact API value as secondary detail (default true). */
type Opts = { api?: boolean };

export function ExecStatus({ state, api = true }: { state: ExecState } & Opts) {
  return (
    <span className={"st st-exec tone-" + execTone[state]}>
      <span className="sr-only">Execution: </span>
      <span className="st-label">{EXEC_LABEL[state]}</span>
      {api && <code className="st-api"><span className="sr-only">, API value </span>{state}</code>}
    </span>
  );
}

export function SettlementStatus({ state, scope, api = true }: { state: SettlementState; scope?: SettlementScope } & Opts) {
  const sc = scope && scope !== "none" ? scope : undefined;
  return (
    <span className={"st st-settlement stl-" + state + " tone-" + settlementTone[state]}>
      <span className="stl-mark" aria-hidden="true">{settlementMark[state]}</span>
      <span className="sr-only">Settlement evidence: </span>
      <span className="st-label">{SETTLEMENT_LABEL[state]}{sc && <> {SCOPE_LABEL[sc]}</>}</span>
      {api && <code className="st-api"><span className="sr-only">, API value </span>{state}{sc && <span className="stl-scope"> · {sc}</span>}</code>}
    </span>
  );
}

export function ReconStatus({ state, api = true }: { state: ReconState } & Opts) {
  return (
    <span className={"st st-recon tone-" + reconTone[state]}>
      <span className="sr-only">Reconciliation: </span>
      <span className="st-label">{RECON_LABEL[state]}</span>
      {api && <code className="st-api"><span className="sr-only">, API value </span>{state}</code>}
    </span>
  );
}

/** A plain tone tag for non-status values (eligibility, severity, freshness). */
export function Tag({ tone, children }: { tone: Tone | "info"; children: ReactNode }) {
  return <span className={"tag tone-" + tone}>{children}</span>;
}
