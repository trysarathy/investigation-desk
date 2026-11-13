/**
 * Recompute an intent's settlement and reconciliation dimensions from recorded evidence.
 * Used only after a PERSON resolves an exception (M3 / m3): an open contradiction keeps settlement
 * "contradicted"; open reconciliation exceptions keep reconciliation "exception".
 */
import { isAgreeingProviderReport, providerReportLinesFor } from "./reconciliation";
import { isTerminalForSettlementReport } from "./state";
import type { PaymentIntent, Workspace } from "./types";

const RECON_BLOCKING = ["contradictory_evidence", "unmatched_reconciliation", "missing_payment_reference", "duplicate_event", "returned_payout"];

export function recomputeDimensions(ws: Workspace, intent: PaymentIntent): void {
  const open = ws.exceptions.filter((e) => e.intentId === intent.id && e.status !== "resolved");
  const instr = ws.instructions.find((i) => i.id === intent.instructionId);
  const bank = ws.allocations
    .filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))
    .reduce((s, a) => s + a.amountMinor, 0);
  const obs = ws.chainObservations.find((o) => o.intentId === intent.id && o.status !== "rejected_unsupported");
  // rc3 (C-3): a chain allocation counts as a match only while its observation is final (after a reorg
  // the observation drops below finality and the allocation no longer evidences the payout).
  const chainAlloc = obs?.status === "final" && ws.allocations.some((a) => a.evidenceKind === "chain_observation" && a.target.kind === "payment" && a.target.intentId === intent.id && a.statementLineId === obs.id);
  // CHANGE 5 (F1): a settlement report on a terminal payout (TERMINAL_FOR_SETTLEMENT_REPORT; "returned"
  // is handled by its own branch below) is a contradiction, never settlement evidence.
  // Review v2 (m1): only a report recorded as AGREEING with the payout counts; one that raised an
  // exception (under-amount, terminal, hold, currency, window, ...) never does, even once resolved.
  const terminal = isTerminalForSettlementReport(intent.status.execution);
  const providerReport = !terminal && providerReportLinesFor(ws, intent).some(isAgreeingProviderReport);

  // Re-review N2: a returned payout never settled with the beneficiary. Settlement is "none"
  // (scope "none") — the debit and return evidence stay on record and in the investigation — and
  // reconciliation is "matched" only when the debit AND an equal statement-confirmed return are both
  // allocated (net zero, returnStatus "confirmed_by_statement"); otherwise it stays "exception".
  if (intent.status.execution === "returned") {
    const returned = ws.allocations
      .filter((a) => a.target.kind === "payment" && a.target.intentId === intent.id && a.evidenceKind === "statement_line" && a.currency === intent.sourceCurrency && a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))
      .reduce((s, a) => s + a.amountMinor, 0);
    // Review v2 (M2): while the return is still open and settlement evidence (bank debit or chain
    // transfer) exists, that evidence is contradicted by the return (never shown as success).
    const evidenced = bank > 0 || Boolean(obs);
    intent.status.settlement =
      open.some((e) => e.category === "contradictory_evidence") || (evidenced && open.some((e) => e.category === "returned_payout")) ? "contradicted" : "none";
    intent.status.settlementScope = "none";
    const netZero = returned > 0 && returned === bank && intent.returnStatus === "confirmed_by_statement";
    intent.status.reconciliation = !open.some((e) => RECON_BLOCKING.includes(e.category)) && netZero ? "matched" : "exception";
    return;
  }

  // rc3 (T-2): a failed, cancelled or expired payout never shows settlement evidence as success once a
  // person resolves the contradiction: the evidence stays on record and in the investigation, but the
  // settlement dimension is "none" (as for a returned payout, N2). Before: the recompute set "verified".
  if (terminal) {
    intent.status.settlement = open.some((e) => e.category === "contradictory_evidence") ? "contradicted" : "none";
    if (intent.status.settlement === "none") intent.status.settlementScope = "none";
  } else if (open.some((e) => e.category === "contradictory_evidence")) intent.status.settlement = "contradicted";
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
