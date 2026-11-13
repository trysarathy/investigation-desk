/**
 * Recompute an intent's settlement and reconciliation dimensions from recorded evidence.
 * Used only after a PERSON resolves an exception (M3 / m3): an open contradiction keeps settlement
 * "contradicted"; open reconciliation exceptions keep reconciliation "exception".
 */
import type { PaymentIntent, Workspace } from "./types";

const RECON_BLOCKING = ["contradictory_evidence", "unmatched_reconciliation", "missing_payment_reference", "duplicate_event", "returned_payout"];

export function recomputeDimensions(ws: Workspace, intent: PaymentIntent): void {
  const open = ws.exceptions.filter((e) => e.intentId === intent.id && e.status !== "resolved");
  const instr = ws.instructions.find((i) => i.id === intent.instructionId);
  const bank = ws.allocations
    .filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))
    .reduce((s, a) => s + a.amountMinor, 0);
  const chainAlloc = ws.allocations.some((a) => a.evidenceKind === "chain_observation" && a.target.kind === "payment" && a.target.intentId === intent.id);
  const obs = ws.chainObservations.find((o) => o.intentId === intent.id && o.status !== "rejected_unsupported");
  // CHANGE 5 (F1): a settlement report on a failed/cancelled/expired payout is a contradiction, never settlement evidence.
  const terminal = ["failed", "cancelled", "expired"].includes(intent.status.execution);
  const providerReport = !terminal && ws.evidence.some((e) => e.intentId === intent.id && e.kind === "provider_settlement_report");

  // Re-review N2: a returned payout never settled with the beneficiary. Settlement is "none"
  // (scope "none") — the debit and return evidence stay on record and in the investigation — and
  // reconciliation is "matched" only when the debit AND an equal statement-confirmed return are both
  // allocated (net zero, returnStatus "confirmed_by_statement"); otherwise it stays "exception".
  if (intent.status.execution === "returned") {
    const returned = ws.allocations
      .filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency && a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))
      .reduce((s, a) => s + a.amountMinor, 0);
    intent.status.settlement = open.some((e) => e.category === "contradictory_evidence") ? "contradicted" : "none";
    intent.status.settlementScope = "none";
    const netZero = returned > 0 && returned === bank && intent.returnStatus === "confirmed_by_statement";
    intent.status.reconciliation = !open.some((e) => RECON_BLOCKING.includes(e.category)) && netZero ? "matched" : "exception";
    return;
  }

  if (open.some((e) => e.category === "contradictory_evidence")) intent.status.settlement = "contradicted";
  else if (obs) {
    intent.status.settlementScope = "onchain_transfer";
    intent.status.settlement = obs.status === "final" ? "verified" : obs.status === "pending_finality" ? "pending_finality" : "observed";
  } else if (bank > 0) {
    intent.status.settlementScope = "bank_statement";
    intent.status.settlement = bank >= intent.amountMinor ? "verified" : "observed";
  } else if (providerReport) {
    intent.status.settlementScope = "provider_report";
    intent.status.settlement = "observed";
  } else {
    intent.status.settlementScope = "none";
    intent.status.settlement = "none";
  }

  if (open.some((e) => RECON_BLOCKING.includes(e.category))) intent.status.reconciliation = "exception";
  else if (chainAlloc || bank >= intent.amountMinor) intent.status.reconciliation = "matched";
  else if (bank > 0) intent.status.reconciliation = "partially_matched";
  else intent.status.reconciliation = instr?.providerPaymentId ? "pending" : "not_started";
}
