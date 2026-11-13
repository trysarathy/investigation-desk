/**
 * Reconciliation engine (matching-engine rules): exact identifiers only for automatic links;
 * anything ambiguous goes to a person. An amount-only match NEVER allocates or closes anything.
 */
import { openException } from "./exceptions";
import { obligationOutstanding } from "./funding";
import { formatMinor } from "./money";
import type { AmountDifference, ExecutionState, ReconciliationAllocation, ReconciliationCode, RepaymentObligation, Severity, StatementLine } from "./types";
import { addDays, daysBetween, referenceTokens, type Tx } from "./tx";

/** Value date must fall within [submission date − 1 day, submission date + N days]. */
export const RECONCILIATION_WINDOW_DAYS = 7;
/** Statement received more than this many days after its value date is "late" (still matchable). */
export const LATE_STATEMENT_DAYS = 3;

export const RECONCILIATION_CODE_TEXT: Readonly<Record<ReconciliationCode, string>> = {
  RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW: "Trusted reference, amount, currency and time window all agree.",
  RC_PARTIAL_AMOUNT: "Trusted reference agrees but the amount covers only part of what is expected; the remainder stays outstanding.",
  RC_OVERPAYMENT: "Trusted reference agrees but the amount exceeds what is outstanding; not allocated.",
  RC_CURRENCY_MISMATCH: "Trusted reference agrees but the currency differs; not allocated (currencies are never converted silently).",
  RC_OUTSIDE_TIME_WINDOW: "Trusted reference agrees but the value date is outside the matching window; not allocated.",
  RC_LATE_STATEMENT: "Statement line arrived well after its value date; matched on its own value date.",
  RC_NO_REFERENCE: "The statement line carries no payment reference.",
  RC_UNKNOWN_REFERENCE: "The statement reference does not identify any known payment or repayment.",
  RC_AMOUNT_ONLY_CANDIDATES: "Only the amount agrees with one or more items. Amount alone is never treated as attribution.",
  RC_AMBIGUOUS_REFERENCE: "The reference identifies more than one item; ambiguity is preserved for a person to decide.",
  RC_DUPLICATE_SUSPECTED: "Same reference, amount and value date as a line already allocated; not allocated twice.",
  RC_RETURN_CONFIRMS_PROVIDER_RETURN: "Return line agrees with the provider's returned-payout report.",
  RC_RETURN_CONTRADICTS_PROVIDER_STATUS: "Return line contradicts the provider's status for this payment.",
  RC_UNMATCHED_INCOMING: "Incoming funds with no matching expected item.",
  RC_UNMATCHED_OUTGOING: "Outgoing funds with no matching submitted payment.",
  RC_PROVIDER_REPORT_ONLY: "Matched against a provider settlement report, which is provider-reported rather than independent bank evidence.",
  RC_REPAYMENT_BY_REFERENCE: "Repayment allocated to the obligation by its reliable repayment reference.",
  RC_UNDER_AMOUNT_REPORT: "The provider settlement report shows less than the payout amount; the payout is not treated as settled in full.",
  RC_REPORT_ON_TERMINAL_PAYOUT: "The provider reports settlement for a payout that is failed, cancelled, expired or returned; the two claims contradict each other.",
};

/** Display group for each code (for filters). Rows should still show the raw codes. */
export type ReconciliationCodeGroup = "exact" | "partial" | "unmatched" | "duplicate" | "ambiguous" | "currency_mismatch" | "contradiction" | "return" | "informational";
export const RECONCILIATION_CODE_GROUP: Readonly<Record<ReconciliationCode, ReconciliationCodeGroup>> = {
  RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW: "exact",
  RC_REPAYMENT_BY_REFERENCE: "exact",
  RC_PARTIAL_AMOUNT: "partial",
  RC_OVERPAYMENT: "unmatched",
  RC_CURRENCY_MISMATCH: "currency_mismatch",
  RC_OUTSIDE_TIME_WINDOW: "unmatched",
  RC_LATE_STATEMENT: "informational",
  RC_NO_REFERENCE: "unmatched",
  RC_UNKNOWN_REFERENCE: "unmatched",
  RC_AMOUNT_ONLY_CANDIDATES: "unmatched",
  RC_AMBIGUOUS_REFERENCE: "ambiguous",
  RC_DUPLICATE_SUSPECTED: "duplicate",
  RC_RETURN_CONFIRMS_PROVIDER_RETURN: "return",
  RC_RETURN_CONTRADICTS_PROVIDER_STATUS: "contradiction",
  RC_UNMATCHED_INCOMING: "unmatched",
  RC_UNMATCHED_OUTGOING: "unmatched",
  RC_PROVIDER_REPORT_ONLY: "informational",
  RC_UNDER_AMOUNT_REPORT: "partial",
  RC_REPORT_ON_TERMINAL_PAYOUT: "contradiction",
};

/** CHANGE 5 (F1): executions on which a provider settlement report is a contradiction, not evidence. */
export const TERMINAL_FOR_SETTLEMENT_REPORT: readonly ExecutionState[] = ["failed", "cancelled", "expired", "returned"];

/** CHANGE 5 (F2): next action for an amount difference (deterministic text). */
export function amountDifferenceAction(code: AmountDifference["code"], differenceMinor: number, currency: AmountDifference["currency"]): string {
  const amt = formatMinor(differenceMinor, currency);
  return code === "RC_UNDER_AMOUNT_REPORT"
    ? `Ask the provider to explain the ${amt} shortfall (fees, partial settlement or a further report) and obtain the bank statement line for the payout. Do not treat the payout as settled until the full amount is evidenced.`
    : `Find the statement line for the remaining ${amt}. The remainder stays outstanding until a line with the trusted reference evidences it.`;
}

function difference(line: StatementLine, code: AmountDifference["code"], expectedMinor: number): AmountDifference {
  const differenceMinor = expectedMinor - line.amountMinor;
  return { code, expectedMinor, reportedMinor: line.amountMinor, differenceMinor, currency: line.currency, source: line.source, statementLineId: line.id, requiredNextAction: amountDifferenceAction(code, differenceMinor, line.currency) };
}

const SUBMITTED_STATES = ["submitted", "in_transit", "provider_reported_completed", "on_hold", "awaiting_information", "returned", "failed"];

/** Bank-statement allocations only, in the payout's source currency (chain allocations are a separate leg). */
function allocatedTo(tx: Tx, intentId: string, kind: "payment" | "return"): number {
  const intent = tx.ws.intents.find((i) => i.id === intentId);
  return tx.ws.allocations
    .filter((a) => a.target.kind === "payment" && a.target.intentId === intentId && a.evidenceKind === "statement_line" && a.currency === intent?.sourceCurrency)
    .filter((a) => (kind === "return") === a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))
    .reduce((s, a) => s + a.amountMinor, 0);
}

function allocate(tx: Tx, line: StatementLine, target: ReconciliationAllocation["target"], amountMinor: number, codes: ReconciliationCode[]): ReconciliationAllocation {
  const a: ReconciliationAllocation = { id: tx.id("alc"), statementLineId: line.id, evidenceKind: "statement_line", target, amountMinor, currency: line.currency, matchedBy: "trusted_reference", codes, createdAt: tx.at };
  tx.ws.allocations.push(a);
  line.allocationIds.push(a.id);
  line.status = "allocated";
  line.explanationCodes.push(...codes);
  tx.log("reconciliation.allocated", "statement_line", line.id, `${formatMinor(amountMinor, line.currency)} → ${target.kind === "payment" ? target.intentId : target.obligationId} (${codes.join(", ")})`);
  return a;
}

function lineEvidence(tx: Tx, line: StatementLine, link: { intentId?: string; advanceId?: string }) {
  const ev = {
    id: tx.id("evd"),
    kind: line.source === "bank_statement" ? ("bank_statement_line" as const) : ("provider_settlement_report" as const),
    intentId: link.intentId,
    advanceId: link.advanceId,
    description: `${line.direction} ${formatMinor(line.amountMinor, line.currency)} · ${line.reference || "(no reference)"} · value ${line.valueDate}`,
    source: line.source === "bank_statement" ? `Bank statement ${line.accountRef} (fictional)` : `Provider settlement report ${line.accountRef} (fictional)`,
    independent: line.source === "bank_statement",
    reference: line.lineId,
    recordedBy: "system",
    recordedAt: tx.at,
  };
  tx.ws.evidence.push(ev);
  return ev.id;
}

function exceptionFor(tx: Tx, line: StatementLine, code: ReconciliationCode, extra: { intentId?: string; advanceId?: string; obligationId?: string; candidates?: string[]; category?: "unmatched_reconciliation" | "missing_payment_reference" | "contradictory_evidence" | "duplicate_event"; note?: string; amountDifference?: AmountDifference; severity?: Severity }) {
  line.status = line.allocationIds.length ? "partially_allocated" : "exception";
  if (!line.explanationCodes.includes(code)) line.explanationCodes.push(code);
  const evidenceId = lineEvidence(tx, line, { intentId: extra.intentId, advanceId: extra.advanceId });
  return openException(tx, {
    category: extra.category ?? (line.reference.trim() ? "unmatched_reconciliation" : "missing_payment_reference"),
    explanationCode: code,
    explanation: `${RECONCILIATION_CODE_TEXT[code]} Line ${line.lineId}: ${line.direction} ${formatMinor(line.amountMinor, line.currency)}, reference "${line.reference}".` +
      (extra.candidates?.length ? ` Candidates (not allocated): ${extra.candidates.join(", ")}.` : "") +
      (extra.note ? ` ${extra.note}` : ""),
    intentId: extra.intentId,
    advanceId: extra.advanceId,
    obligationId: extra.obligationId,
    statementLineId: line.id,
    candidates: extra.candidates,
    supportingEvidenceIds: [evidenceId],
    impact: { amountMinor: line.amountMinor, currency: line.currency },
    amountDifference: extra.amountDifference,
    severity: extra.severity,
  });
}

/** Window and lateness use organisation calendar dates (Organization.timezone). */
const inWindow = (tx: Tx, valueDate: string, submittedAt: string) => {
  const submitted = tx.orgDate(submittedAt);
  return valueDate >= addDays(submitted, -1) && valueDate <= addDays(submitted, RECONCILIATION_WINDOW_DAYS);
};

const isLate = (tx: Tx, line: StatementLine) => daysBetween(line.valueDate, tx.orgDate(line.receivedAt)) > LATE_STATEMENT_DAYS;

/** Reconcile one freshly ingested statement line. Returns the processing outcome. */
export function reconcileLine(tx: Tx, line: StatementLine): string {
  const ws = tx.ws;
  const tokens = referenceTokens(line.reference);
  if (line.direction === "credit" && line.kind === "payment") return reconcileIncoming(tx, line, tokens);

  // Outgoing payments and returns/reversals: trusted reference = provider payment id.
  const byRef = ws.intents.filter((i) => {
    const instr = ws.instructions.find((x) => x.id === i.instructionId);
    return instr?.providerPaymentId && tokens.includes(instr.providerPaymentId.toUpperCase());
  });
  if (byRef.length > 1) {
    exceptionFor(tx, line, "RC_AMBIGUOUS_REFERENCE", { candidates: byRef.map((i) => i.id) });
    return "exception_raised";
  }
  if (byRef.length === 0) {
    const candidates = ws.intents
      .filter((i) => SUBMITTED_STATES.includes(i.status.execution) && i.amountMinor === line.amountMinor && i.sourceCurrency === line.currency)
      .map((i) => i.id);
    if (candidates.length)
      exceptionFor(tx, line, "RC_AMOUNT_ONLY_CANDIDATES", { candidates });
    else exceptionFor(tx, line, line.direction === "debit" ? "RC_UNMATCHED_OUTGOING" : "RC_UNMATCHED_INCOMING", {});
    return "exception_raised";
  }
  const intent = byRef[0];
  const instr = ws.instructions.find((x) => x.id === intent.instructionId)!;

  if (line.kind === "return" || line.kind === "reversal") {
    if (line.currency !== intent.sourceCurrency) {
      exceptionFor(tx, line, "RC_CURRENCY_MISMATCH", { intentId: intent.id });
      return "exception_raised";
    }
    if (intent.status.execution === "returned") {
      // M2: the same amount, duplicate and over-amount checks as outgoing lines.
      const returned = allocatedTo(tx, intent.id, "return");
      const ppid = instr.providerPaymentId!.toUpperCase();
      const dupeReturn = ws.statementLines.some(
        (l) => l.id !== line.id && l.allocationIds.length > 0 && (l.kind === "return" || l.kind === "reversal") && l.amountMinor === line.amountMinor && l.valueDate === line.valueDate && referenceTokens(l.reference).includes(ppid),
      );
      if (dupeReturn || returned >= intent.amountMinor) {
        exceptionFor(tx, line, "RC_DUPLICATE_SUSPECTED", { intentId: intent.id });
        return "exception_raised";
      }
      if (line.amountMinor > intent.amountMinor - returned) {
        exceptionFor(tx, line, "RC_OVERPAYMENT", { intentId: intent.id });
        return "exception_raised";
      }
      const evidenceId = lineEvidence(tx, line, { intentId: intent.id });
      intent.returnStatus = "confirmed_by_statement";
      allocate(tx, line, { kind: "payment", intentId: intent.id }, line.amountMinor, ["RC_RETURN_CONFIRMS_PROVIDER_RETURN"]);
      const exc = ws.exceptions.find((e) => e.intentId === intent.id && e.category === "returned_payout");
      if (exc) {
        exc.supportingEvidenceIds.push(evidenceId);
        exc.history.push({ at: tx.at, actorId: tx.actorId, action: "evidence_added", detail: "Return statement line agrees with provider return (exception stays open until a person resolves it)" });
        exc.lastUpdatedAt = tx.at;
      }
      return "allocated";
    }
    exceptionFor(tx, line, "RC_RETURN_CONTRADICTS_PROVIDER_STATUS", { intentId: intent.id, category: "contradictory_evidence" });
    intent.status.settlement = "contradicted";
    intent.status.reconciliation = "exception";
    return "contradictory_exception_raised";
  }

  // CHANGE 5 (F1): a settlement report on a payout whose execution is terminal (failed, cancelled,
  // expired, returned) contradicts the provider's own status. It is never recorded as ordinary
  // evidence: it raises contradictory_evidence and leaves settlement unchanged.
  if (line.source === "provider_settlement_report" && TERMINAL_FOR_SETTLEMENT_REPORT.includes(intent.status.execution)) {
    exceptionFor(tx, line, "RC_REPORT_ON_TERMINAL_PAYOUT", {
      intentId: intent.id,
      category: "contradictory_evidence",
      note: `The payout's execution status is "${intent.status.execution}"; settlement was left unchanged (${intent.status.settlement}).`,
    });
    return "contradictory_exception_raised";
  }

  // Outgoing payment line
  if (line.direction !== "debit") {
    exceptionFor(tx, line, "RC_UNMATCHED_INCOMING", { intentId: intent.id });
    return "exception_raised";
  }
  if (line.currency !== intent.sourceCurrency) {
    exceptionFor(tx, line, "RC_CURRENCY_MISMATCH", { intentId: intent.id });
    return "exception_raised";
  }
  if (!instr.submittedAt || !inWindow(tx, line.valueDate, instr.submittedAt)) {
    exceptionFor(tx, line, "RC_OUTSIDE_TIME_WINDOW", { intentId: intent.id });
    return "exception_raised";
  }
  if (line.source === "provider_settlement_report") {
    // M1 + re-review N1: a provider settlement report is provider-reported evidence only, in either
    // order relative to the bank line. It is recorded, never allocated, never a duplicate of a bank
    // line, and never changes a reconciled status. Only a report that disagrees (currency — checked
    // above — or an amount above the payout) raises an exception.
    if (line.amountMinor > intent.amountMinor) {
      exceptionFor(tx, line, "RC_OVERPAYMENT", { intentId: intent.id });
      return "exception_raised";
    }
    if (line.amountMinor < intent.amountMinor) {
      // CHANGE 5 (F2): a report for less than the payout is a disagreement, never silent evidence.
      // Settlement is not upgraded; the structured difference is on the line and the exception.
      const d = difference(line, "RC_UNDER_AMOUNT_REPORT", intent.amountMinor);
      line.amountDifference = d;
      line.explanationCodes.push("RC_PROVIDER_REPORT_ONLY");
      if (isLate(tx, line)) line.explanationCodes.push("RC_LATE_STATEMENT");
      exceptionFor(tx, line, "RC_UNDER_AMOUNT_REPORT", {
        intentId: intent.id,
        category: "unmatched_reconciliation",
        amountDifference: d,
        note: `Expected ${formatMinor(d.expectedMinor, d.currency)}, reported ${formatMinor(d.reportedMinor, d.currency)}, difference ${formatMinor(d.differenceMinor, d.currency)}.`,
      });
      return "exception_raised";
    }
    lineEvidence(tx, line, { intentId: intent.id, advanceId: intent.advanceId });
    line.explanationCodes.push("RC_PROVIDER_REPORT_ONLY");
    if (isLate(tx, line)) line.explanationCodes.push("RC_LATE_STATEMENT");
    if (intent.status.settlement === "none") {
      intent.status.settlement = "observed";
      intent.status.settlementScope = "provider_report";
    }
    tx.log("reconciliation.provider_report_recorded", "statement_line", line.id, `Provider settlement report for ${intent.id} recorded as provider-reported evidence; not allocated`);
    return "recorded_provider_report";
  }
  const already = allocatedTo(tx, intent.id, "payment");
  const remaining = intent.amountMinor - already;
  const dupe = ws.statementLines.some(
    (l) => l.id !== line.id && l.allocationIds.length > 0 && l.direction === line.direction && l.kind === line.kind && l.amountMinor === line.amountMinor && l.valueDate === line.valueDate && referenceTokens(l.reference).includes(instr.providerPaymentId!.toUpperCase()),
  );
  if (dupe || remaining <= 0) {
    exceptionFor(tx, line, "RC_DUPLICATE_SUSPECTED", { intentId: intent.id });
    return "exception_raised";
  }
  if (line.amountMinor > remaining) {
    exceptionFor(tx, line, "RC_OVERPAYMENT", { intentId: intent.id });
    return "exception_raised";
  }
  const codes: ReconciliationCode[] = [line.amountMinor === remaining ? "RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW" : "RC_PARTIAL_AMOUNT"];
  if (isLate(tx, line)) codes.push("RC_LATE_STATEMENT");
  const evidenceId = lineEvidence(tx, line, { intentId: intent.id, advanceId: intent.advanceId });
  allocate(tx, line, { kind: "payment", intentId: intent.id }, line.amountMinor, codes);
  const full = line.amountMinor === remaining;
  // CHANGE 5 (F2): a bank line below the remainder stays partial, with the structured difference.
  if (!full) line.amountDifference = difference(line, "RC_PARTIAL_AMOUNT", remaining);
  if (intent.status.reconciliation !== "exception") intent.status.reconciliation = full ? "matched" : "partially_matched";
  if (intent.status.settlement !== "contradicted") {
    if (line.source === "bank_statement") {
      intent.status.settlement = full ? "verified" : "observed";
      intent.status.settlementScope = "bank_statement";
    } else if (intent.status.settlement === "none") {
      intent.status.settlement = "observed";
      intent.status.settlementScope = "provider_report";
    }
  }
  // Payout that the provider still reports as failed/returned contradicts a debit match.
  if (intent.status.execution === "failed") {
    openException(tx, {
      category: "contradictory_evidence",
      explanationCode: "RC_DEBIT_FOR_FAILED_PAYOUT",
      explanation: "A statement debit matches a payout the provider reported as failed.",
      intentId: intent.id,
      statementLineId: line.id,
      supportingEvidenceIds: [evidenceId],
    });
    intent.status.settlement = "contradicted";
  }
  return "allocated";
}

function reconcileIncoming(tx: Tx, line: StatementLine, tokens: string[]): string {
  const ws = tx.ws;
  const byRef = ws.obligations.filter((o) => tokens.includes(o.reference.toUpperCase()));
  if (byRef.length > 1) {
    exceptionFor(tx, line, "RC_AMBIGUOUS_REFERENCE", { candidates: byRef.map((o) => o.id) });
    return "exception_raised";
  }
  if (byRef.length === 0) {
    // Preserve candidates that only agree on amount; never allocate them.
    const candidates = ws.obligations
      .filter((o) => o.currency === line.currency && obligationOutstanding(ws, o.id).amountMinor > 0)
      .filter((o) => obligationOutstanding(ws, o.id).amountMinor === line.amountMinor || o.principalMinor === line.amountMinor)
      .map((o) => o.id);
    const single = candidates.length === 1 ? ws.obligations.find((o) => o.id === candidates[0]) : undefined;
    exceptionFor(tx, line, candidates.length ? "RC_AMOUNT_ONLY_CANDIDATES" : line.reference.trim() ? "RC_UNKNOWN_REFERENCE" : "RC_UNMATCHED_INCOMING", {
      candidates,
      advanceId: single?.advanceId,
      obligationId: single?.id,
      category: line.reference.trim() ? "unmatched_reconciliation" : "missing_payment_reference",
    });
    return "exception_raised";
  }
  const ob: RepaymentObligation = byRef[0];
  const adv = ws.advances.find((a) => a.id === ob.advanceId);
  if (line.currency !== ob.currency) {
    exceptionFor(tx, line, "RC_CURRENCY_MISMATCH", { advanceId: ob.advanceId, obligationId: ob.id });
    return "exception_raised";
  }
  const dupe = ws.repaymentAllocations.some((a) => {
    const other = ws.statementLines.find((l) => l.id === a.statementLineId);
    return a.obligationId === ob.id && other && other.id !== line.id && other.amountMinor === line.amountMinor && other.valueDate === line.valueDate && other.counterparty === line.counterparty;
  });
  if (dupe) {
    exceptionFor(tx, line, "RC_DUPLICATE_SUSPECTED", { advanceId: ob.advanceId, obligationId: ob.id });
    return "exception_raised";
  }
  const outstanding = obligationOutstanding(ws, ob.id).amountMinor;
  if (line.amountMinor > outstanding) {
    exceptionFor(tx, line, "RC_OVERPAYMENT", { advanceId: ob.advanceId, obligationId: ob.id });
    return "exception_raised";
  }
  const codes: ReconciliationCode[] = ["RC_REPAYMENT_BY_REFERENCE", line.amountMinor === outstanding ? "RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW" : "RC_PARTIAL_AMOUNT"];
  if (isLate(tx, line)) codes.push("RC_LATE_STATEMENT");
  const evidenceId = lineEvidence(tx, line, { advanceId: ob.advanceId, intentId: adv?.intentId });
  allocate(tx, line, { kind: "repayment", obligationId: ob.id }, line.amountMinor, codes);
  ws.repaymentAllocations.push({ id: tx.id("rpa"), obligationId: ob.id, statementLineId: line.id, amountMinor: line.amountMinor, currency: line.currency, matchedBy: "trusted_reference", evidenceId, at: tx.at });
  tx.log("funding.repayment_allocated", "obligation", ob.id, `${formatMinor(line.amountMinor, line.currency)} by reference ${ob.reference}; outstanding ${formatMinor(outstanding - line.amountMinor, ob.currency)}`);
  return "allocated";
}

