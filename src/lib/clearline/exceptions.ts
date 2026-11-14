import { obligationOutstanding } from "./funding";
import { computeLiquidity } from "./liquidity";
import { applyBpsFloor, formatMinor } from "./money";
import { isTerminalForSettlementReport } from "./state";
import type { AmountDifference, ExceptionCategory, InvestigationCase, Money, ReconciliationException, Severity, Workspace } from "./types";
import { addDays, inMatchingWindow, orgDate, referenceTokens, type Tx } from "./tx";

/** Required action shown for each category (deterministic text, no generated prose). */
export const EXCEPTION_REQUIRED_ACTION: Readonly<Record<ExceptionCategory, string>> = {
  provider_timeout: "Ask the provider for the payout status; do not resubmit until the provider confirms the original instruction's outcome.",
  failed_submission: "Review the provider error, correct the instruction and create a new intent if the payment is still due.",
  returned_payout: "Verify beneficiary details with the supplier, confirm the returned funds, then create a correction intent.",
  beneficiary_mismatch: "Confirm beneficiary details with the supplier through a known channel before any resubmission.",
  missing_statement: "Obtain the statement or settlement report covering this payout; provider-reported completion alone is not settlement evidence.",
  unmatched_reconciliation: "Identify the counterparty and the trusted reference; an amount-only match must not be allocated.",
  duplicate_event: "Confirm with the provider which event is authoritative; duplicates are not applied twice.",
  unsupported_token_or_network: "Do not count this transfer. Confirm the network and token contract with the counterparty.",
  pending_finality: "Wait until the finality threshold is reached; observation is not finality.",
  missing_payment_reference: "Ask the remitter for the payment reference; without it the receipt cannot be allocated.",
  compliance_hold: "The partner requested documents. Your compliance reviewer decides the response; the hold is never released automatically.",
  funding_shortfall: "Fresh usable liquidity does not cover this advance. Treasury decides; Clearline does not supply capital.",
  overdue_advance: "Contact the customer about the overdue repayment; record evidence of any receipt with its reference.",
  contradictory_evidence: "Two sources disagree. Attach evidence establishing which is correct before resolving.",
};

const DEFAULT_SEVERITY: Readonly<Record<ExceptionCategory, Severity>> = {
  provider_timeout: "medium",
  failed_submission: "high",
  returned_payout: "high",
  beneficiary_mismatch: "high",
  missing_statement: "medium",
  unmatched_reconciliation: "medium",
  duplicate_event: "low",
  unsupported_token_or_network: "high",
  pending_finality: "low",
  missing_payment_reference: "medium",
  compliance_hold: "high",
  funding_shortfall: "high",
  overdue_advance: "high",
  contradictory_evidence: "critical",
};

/**
 * Sandbox follow-up policy: days from creation until an exception is due, by severity.
 * Illustrative only (a provider would set its own). Overdue advances use the obligation's due date.
 */
export const EXCEPTION_DUE_DAYS: Readonly<Record<Severity, number>> = { critical: 1, high: 1, medium: 3, low: 5 };

/** Due date as an organisation calendar date (Organization.timezone). */
const dueFrom = (tx: Tx, severity: Severity) => addDays(tx.today, EXCEPTION_DUE_DAYS[severity]);

export interface OpenExceptionSpec {
  category: ExceptionCategory;
  explanationCode: string;
  explanation: string;
  intentId?: string;
  advanceId?: string;
  obligationId?: string;
  statementLineId?: string;
  candidates?: string[];
  supportingEventIds?: string[];
  supportingEvidenceIds?: string[];
  impact?: Money;
  /** CHANGE 5 (F2): structured amount difference; its requiredNextAction becomes the exception's required action. */
  amountDifference?: AmountDifference;
  dueDate?: string;
  severity?: Severity;
  ownerId?: string;
}

/** Find or create the investigation case for a payment (or an advance with no payment). */
export function ensureCase(tx: Tx, link: { intentId?: string; advanceId?: string }): InvestigationCase {
  const ws = tx.ws;
  const existing = ws.cases.find((c) => (link.intentId ? c.intentId === link.intentId : c.advanceId === link.advanceId && !c.intentId));
  if (existing) return existing;
  const intent = link.intentId ? ws.intents.find((i) => i.id === link.intentId) : undefined;
  const c: InvestigationCase = {
    id: tx.id("case"),
    intentId: link.intentId,
    advanceId: link.advanceId ?? intent?.advanceId,
    title: intent ? `Payment ${intent.internalReference} · ${intent.beneficiaryName}` : `Advance ${link.advanceId}`,
    status: "open",
    notes: [],
    requestedInfo: [],
    evidenceIds: [],
    exceptionIds: [],
    history: [{ at: tx.at, actorId: tx.actorId, action: "opened", detail: "Case opened" }],
    createdAt: tx.at,
    updatedAt: tx.at,
  };
  ws.cases.push(c);
  if (intent) intent.caseId = c.id;
  tx.log("case.opened", "case", c.id, c.title);
  return c;
}

/**
 * Open an exception. An identical open exception (same category, code and links) is not
 * duplicated: it records a recurrence in its history instead. Linking to a resolved case
 * reopens the case (contradicting/new evidence).
 */
export function openException(tx: Tx, spec: OpenExceptionSpec): ReconciliationException {
  const ws = tx.ws;
  const same = ws.exceptions.find(
    (e) =>
      e.status !== "resolved" &&
      e.category === spec.category &&
      e.explanationCode === spec.explanationCode &&
      e.intentId === spec.intentId &&
      e.advanceId === spec.advanceId &&
      e.statementLineId === spec.statementLineId,
  );
  if (same) {
    same.history.push({ at: tx.at, actorId: tx.actorId, action: "recurred", detail: spec.explanation });
    same.supportingEventIds.push(...(spec.supportingEventIds ?? []).filter((x) => !same.supportingEventIds.includes(x)));
    same.lastUpdatedAt = tx.at;
    return same;
  }
  const severity = spec.severity ?? DEFAULT_SEVERITY[spec.category];
  const exc: ReconciliationException = {
    id: tx.id("exc"),
    category: spec.category,
    severity,
    status: "open",
    explanationCode: spec.explanationCode,
    explanation: spec.explanation,
    intentId: spec.intentId,
    advanceId: spec.advanceId,
    obligationId: spec.obligationId,
    statementLineId: spec.statementLineId,
    candidates: [...(spec.candidates ?? [])],
    supportingEventIds: [...(spec.supportingEventIds ?? [])],
    supportingEvidenceIds: [...(spec.supportingEvidenceIds ?? [])],
    ownerId: spec.ownerId,
    impact: spec.impact,
    ...(spec.amountDifference ? { amountDifference: { ...spec.amountDifference } } : {}),
    dueDate: spec.dueDate ?? dueFrom(tx, severity),
    requiredAction: spec.amountDifference?.requiredNextAction ?? EXCEPTION_REQUIRED_ACTION[spec.category],
    createdAt: tx.at,
    lastUpdatedAt: tx.at,
    history: [{ at: tx.at, actorId: tx.actorId, action: "opened", detail: `${spec.explanationCode}: ${spec.explanation}` }],
  };
  ws.exceptions.push(exc);
  tx.created.push(exc.id);
  if (spec.intentId || spec.advanceId) {
    const advIntent = spec.advanceId ? tx.ws.advances.find((a) => a.id === spec.advanceId)?.intentId : undefined;
    const c = ensureCase(tx, spec.intentId ? { intentId: spec.intentId } : advIntent ? { intentId: advIntent } : { advanceId: spec.advanceId });
    exc.caseId = c.id;
    c.exceptionIds.push(exc.id);
    c.updatedAt = tx.at;
    if (c.status === "resolved") {
      c.status = "reopened";
      c.history.push({ at: tx.at, actorId: tx.actorId, action: "reopened", detail: `New exception ${exc.id} (${exc.category}) linked` });
      tx.log("case.reopened", "case", c.id, `Reopened by new exception ${exc.id}`);
    }
  }
  if (spec.intentId) {
    const intent = ws.intents.find((i) => i.id === spec.intentId);
    if (intent && ["unmatched_reconciliation", "contradictory_evidence", "missing_payment_reference", "duplicate_event"].includes(spec.category) && spec.statementLineId)
      intent.status.reconciliation = "exception";
  }
  tx.log("exception.opened", "exception", exc.id, `${exc.category} · ${exc.explanationCode}`);
  return exc;
}

export interface ResolutionCheck {
  allowed: boolean;
  code: string;
  reason: string;
}

const deny = (code: string, reason: string): ResolutionCheck => ({ allowed: false, code, reason });

/** Whether a human may resolve this exception now. Nothing is ever resolved automatically. */
export function canResolveException(ws: Workspace, exceptionId: string): ResolutionCheck {
  const e = ws.exceptions.find((x) => x.id === exceptionId);
  if (!e) return deny("NOT_FOUND", "Exception not found.");
  if (e.status === "resolved") return deny("ALREADY_RESOLVED", "Exception is already resolved.");
  if (!e.ownerId) return deny("OWNER_REQUIRED", "Assign an owner before resolving.");
  const intent = e.intentId ? ws.intents.find((i) => i.id === e.intentId) : undefined;
  switch (e.category) {
    case "compliance_hold": {
      const hold = ws.holds.find((h) => h.intentId === e.intentId);
      if (!hold || (hold.status !== "released" && hold.status !== "rejected"))
        return deny("HOLD_NOT_DECIDED", "The compliance reviewer has not recorded a release or rejection with the partner's release.");
      break;
    }
    case "pending_finality":
      if (intent?.status.settlement !== "verified") return deny("FINALITY_NOT_REACHED", "The transfer has not reached the finality threshold.");
      break;
    case "overdue_advance":
    case "funding_shortfall": {
      const adv = ws.advances.find((a) => a.id === e.advanceId);
      if (e.category === "overdue_advance") {
        if (!adv?.obligationId || obligationOutstanding(ws, adv.obligationId).amountMinor > 0)
          return deny("OUTSTANDING_REMAINS", "An amount is still outstanding on this advance.");
      } else if (adv && adv.state !== "declined") {
        const usable = computeLiquidity(ws).currentUsableByCurrency[adv.currency] ?? 0;
        if (usable < adv.principalMinor) return deny("SHORTFALL_REMAINS", "Fresh usable liquidity still does not cover the advance.");
      }
      break;
    }
    case "returned_payout": {
      const confirmed = e.supportingEvidenceIds.some((id) => ws.evidence.find((ev) => ev.id === id)?.kind === "funds_returned_confirmation");
      const corrected = ws.intents.some((i) => i.correctsIntentId === e.intentId);
      if (!confirmed && !corrected) return deny("RETURN_NOT_ADDRESSED", "Attach a funds-returned confirmation or create a correction intent first.");
      break;
    }
    case "provider_timeout": {
      const responded = ws.providerEvents.some((p) => p.intentId === e.intentId && p.processingOutcome === "applied" && Date.parse(p.receivedAt) > Date.parse(e.createdAt));
      if (!responded) return deny("NO_PROVIDER_RESPONSE", "No provider status has been applied since the timeout.");
      break;
    }
    case "contradictory_evidence":
    case "unmatched_reconciliation":
    case "missing_payment_reference":
    case "beneficiary_mismatch":
    case "missing_statement": {
      // m3: a plain note is not evidence. A person must attach a document, confirmation or correction.
      const attached = e.supportingEvidenceIds.some((id) => {
        const ev = ws.evidence.find((x) => x.id === id);
        return ev !== undefined && ev.recordedBy !== "system" && ev.kind !== "note";
      });
      if (!attached) return deny("EVIDENCE_REQUIRED", "Attach evidence (a document, confirmation or correction — not just a note) that supports the resolution.");
      break;
    }
    default:
      break;
  }
  return { allowed: true, code: "RESOLVABLE", reason: "Conditions met; a note is required. Resolving never allocates funds or closes an obligation." };
}

/** Whether a person may resolve this case now (mirrors the resolve action's checks). */
export function canResolveCase(ws: Workspace, caseId: string): ResolutionCheck {
  const c = ws.cases.find((x) => x.id === caseId);
  if (!c) return deny("NOT_FOUND", "Case not found.");
  if (c.status === "resolved") return deny("ALREADY_RESOLVED", "Case is already resolved.");
  if (!c.ownerId) return deny("OWNER_REQUIRED", "Assign an owner before resolving.");
  const open = ws.exceptions.filter((e) => c.exceptionIds.includes(e.id) && e.status !== "resolved");
  if (open.length) return deny("OPEN_EXCEPTIONS", `${open.length} linked exception(s) must be resolved first: ${open.map((e) => e.id).join(", ")}.`);
  const req = c.requestedInfo.filter((q) => q.status === "open");
  if (req.length) return deny("OPEN_INFO_REQUESTS", `${req.length} requested item(s) not yet provided.`);
  const hold = c.intentId ? ws.holds.find((h) => h.intentId === c.intentId && h.status !== "released" && h.status !== "rejected") : undefined;
  if (hold) return deny("HOLD_UNDECIDED", "The compliance hold has no final reviewer decision.");
  // rc3 (X-1): nothing closes a case without matching evidence. A payout that was sent and has not ended
  // (not failed, cancelled, expired or returned) must be evidenced: settlement verified (bank statement
  // or final chain transfer) AND reconciliation matched. A provider's completion claim is not enough.
  // Review M-2 / R-M2 / R2-M2: OR a staff person explicitly accepted a disagreeing bank debit that names the
  // payout (acceptedBankLine), with a second person's approval when the policy requires one.
  const intent = c.intentId ? ws.intents.find((i) => i.id === c.intentId) : undefined;
  const sent = intent ? Boolean(ws.instructions.find((i) => i.id === intent.instructionId)?.providerPaymentId) : false;
  const evidenced = intent ? intent.status.settlement === "verified" && intent.status.reconciliation === "matched" : false;
  const accepted = intent && sent && !evidenced ? acceptedBankLine(ws, intent.id) : undefined;
  const live = intent && sent && !isTerminalForSettlementReport(intent.status.execution) && !evidenced;
  if (live && accepted?.pendingSecondApproval)
    return deny("SECOND_APPROVAL_REQUIRED", `The ${formatMinor(accepted.differenceMinor, accepted.currency)} over-amount on bank debit ${accepted.lineId} was accepted by ${accepted.actorId}, but it is above ${ACCEPTED_OVERAGE_BPS / 100}% of the payment, so it needs a second person's approval (approve_acceptance on ${accepted.exceptionId} by a staff member other than ${accepted.actorId}).`);
  if (live && !accepted) {
    const fx = currencyMismatchLine(ws, intent!.id);
    return deny("EVIDENCE_OUTSTANDING",
      `The payment is not yet evidenced (settlement ${intent!.status.settlement}, reconciliation ${intent!.status.reconciliation}). It closes on a matched bank statement line or a final on-chain transfer, or once a staff person explicitly accepts a bank debit that carries this payment's reference: an over-amount (acceptDifference; above ${ACCEPTED_OVERAGE_BPS / 100}% a second person approves) or a late value date (acceptLateDate).` +
      (fx ? ` Bank debit ${fx.lineId} carries this payment's reference but is in ${fx.currency}, not ${intent!.sourceCurrency}: it cannot be accepted, because the sandbox holds no FX evidence linking the two amounts (an FX confirmation with the rate and both amounts would be needed). Obtain the ${intent!.sourceCurrency} statement line instead.` : ""));
  }
  // rc3 (X-1): a case whose payment funded an advance stays open while the customer still owes money.
  const advanceId = c.advanceId ?? intent?.advanceId;
  const obligationId = advanceId ? ws.advances.find((a) => a.id === advanceId)?.obligationId : undefined;
  if (obligationId && obligationOutstanding(ws, obligationId).amountMinor > 0)
    return deny("OUTSTANDING_REMAINS", "The customer's repayment on the linked advance is still outstanding; it closes only by repayments allocated by reference.");
  if (accepted) {
    const what = accepted.late && accepted.differenceMinor > 0
      ? `the late value date (${accepted.valueDate}) and the ${formatMinor(accepted.differenceMinor, accepted.currency)} over-amount`
      : accepted.late ? `the late value date (${accepted.valueDate}); amount and currency match the payment exactly` : `the ${formatMinor(accepted.differenceMinor, accepted.currency)} over-amount`;
    return { allowed: true, code: "RESOLVABLE", reason: `Owner assigned, linked exceptions resolved, no open requests or undecided hold. The bank debit ${accepted.lineId} (${formatMinor(accepted.lineAmountMinor, accepted.currency)}) carries this payment's reference but was not matched; ${accepted.actorId} accepted ${what}${accepted.approvedBy ? `, and ${accepted.approvedBy} approved the acceptance` : ""} (${accepted.exceptionId}). A note is required.` };
  }
  return { allowed: true, code: "RESOLVABLE", reason: "Owner assigned, linked exceptions resolved, no open requests or undecided hold, and the payment is evidenced. A note is required." };
}

/** Re-review R-M2: the largest over-amount ONE staff person may accept on a bank debit, as basis points of the payout (1%). */
export const ACCEPTED_OVERAGE_BPS = 100;
/** Second re-review R2-M2: above ACCEPTED_OVERAGE_BPS and up to this (50%), a second, different staff person must approve. */
export const MAX_APPROVED_OVERAGE_BPS = 5_000;
/** Second re-review R2-M2: a late value date may be accepted up to this many days after submission (never before it). */
export const MAX_LATE_ACCEPTANCE_DAYS = 60;

export interface AcceptableDifference {
  ok: boolean;
  /** Why it cannot be accepted (ok false), or what is being accepted (ok true). */
  reason: string;
  statementLineId?: string;
  lineId?: string;
  lineAmountMinor?: number;
  /** line amount − payout amount (≥ 0 when ok). */
  differenceMinor?: number;
  currency?: Money["currency"];
  valueDate?: string;
  /** The value date is after the matching window (acceptLateDate needed). */
  late?: boolean;
  /** The over-amount is above ACCEPTED_OVERAGE_BPS (a second person must approve). */
  needsSecondApproval?: boolean;
}

/**
 * Second re-review R2-M2 (product decision): whether a person may accept this exception's bank debit so the
 * payout's case can close although the line was not allocated. Policy (all must hold):
 * - the exception is RC_OVERPAYMENT or RC_OUTSIDE_TIME_WINDOW on a payout that was sent;
 * - its line is a bank-statement DEBIT of kind payment carrying the payout's provider payment id, in the payout's
 *   source currency (a currency mismatch is never acceptable: the sandbox has no FX evidence);
 * - the value date is not before the submission (− 1 day) and at most MAX_LATE_ACCEPTANCE_DAYS after it; outside
 *   the matching window it is "late" and needs acceptLateDate;
 * - the line covers the payout: an exact amount, or an over-amount (acceptDifference) of at most
 *   ACCEPTED_OVERAGE_BPS (one staff person) or MAX_APPROVED_OVERAGE_BPS (a second staff person approves).
 * Fields are filled whenever they can be computed, so the close-time re-check depends on `ok`, not on them.
 */
export function acceptableDifference(ws: Workspace, exceptionId: string): AcceptableDifference {
  const e = ws.exceptions.find((x) => x.id === exceptionId);
  if (!e) return { ok: false, reason: "Exception not found." };
  const intent = ws.intents.find((i) => i.id === e.intentId);
  const instr = ws.instructions.find((i) => i.id === intent?.instructionId);
  const ppid = instr?.providerPaymentId?.toUpperCase();
  const line = ws.statementLines.find((l) => l.id === e.statementLineId);
  const facts: AcceptableDifference = { ok: false, reason: "" };
  if (line && intent) Object.assign(facts, { statementLineId: line.id, lineId: line.lineId, lineAmountMinor: line.amountMinor, differenceMinor: line.amountMinor - intent.amountMinor, currency: line.currency, valueDate: line.valueDate });
  const no = (reason: string): AcceptableDifference => ({ ...facts, ok: false, reason });
  if (e.explanationCode === "RC_CURRENCY_MISMATCH") return no(`A bank debit in another currency cannot be accepted: the sandbox holds no FX evidence linking it to the ${intent?.sourceCurrency ?? "payment's"} amount (an FX confirmation with the rate and both amounts would be needed).`);
  if (e.explanationCode !== "RC_OVERPAYMENT" && e.explanationCode !== "RC_OUTSIDE_TIME_WINDOW") return no("Only an over-amount (RC_OVERPAYMENT) or late-dated (RC_OUTSIDE_TIME_WINDOW) bank debit can be accepted; an amount-only, ambiguous or duplicate line cannot.");
  if (!intent || !instr?.submittedAt || !ppid) return no("The exception is not about a payout that was sent.");
  if (!line) return no("The exception has no statement line.");
  if (line.source !== "bank_statement" || line.direction !== "debit" || line.kind !== "payment") return no("Only an outgoing bank-statement debit can be accepted (not a provider report, credit, return or reversal).");
  if (!referenceTokens(line.reference).includes(ppid)) return no("The line does not carry this payout's provider payment id.");
  if (line.currency !== intent.sourceCurrency) return no(`The line is in ${line.currency}; the payout is in ${intent.sourceCurrency}. A currency mismatch is never acceptable: the sandbox holds no FX evidence.`);
  const submitted = orgDate(instr.submittedAt, ws.organization.timezone);
  if (line.valueDate < addDays(submitted, -1)) return no(`The line's value date ${line.valueDate} is before the payout was submitted (${submitted}).`);
  if (line.valueDate > addDays(submitted, MAX_LATE_ACCEPTANCE_DAYS)) return no(`The line's value date ${line.valueDate} is more than ${MAX_LATE_ACCEPTANCE_DAYS} days after the payout was submitted (${submitted}).`);
  const late = !inMatchingWindow(line.valueDate, instr.submittedAt, ws.organization.timezone);
  const differenceMinor = line.amountMinor - intent.amountMinor;
  if (differenceMinor < 0) return no("The line is for less than the payout; a short debit cannot be accepted as the payout.");
  const one = applyBpsFloor(intent.amountMinor, ACCEPTED_OVERAGE_BPS);
  const max = applyBpsFloor(intent.amountMinor, MAX_APPROVED_OVERAGE_BPS);
  if (differenceMinor > max) return no(`The line exceeds the payout by ${formatMinor(differenceMinor, line.currency)}, more than the ${MAX_APPROVED_OVERAGE_BPS / 100}% (${formatMinor(max, line.currency)}) that can be accepted even with a second person's approval.`);
  if (!late && differenceMinor === 0) return no("The line matches the payout exactly and is in the window; nothing needs accepting.");
  const needsSecondApproval = differenceMinor > one;
  const parts = [late ? `a late value date (${line.valueDate})` : "", differenceMinor > 0 ? `a ${formatMinor(differenceMinor, line.currency)} over-amount${needsSecondApproval ? ` (above ${ACCEPTED_OVERAGE_BPS / 100}%: a second person must approve)` : ""}` : ""].filter(Boolean);
  return { ...facts, ok: true, late, needsSecondApproval, reason: `The debit ${line.lineId} of ${formatMinor(line.amountMinor, line.currency)} carries this payout's reference; to accept: ${parts.join(" and ")}.` };
}

const STAFF_ROLES = ["operator", "approver", "compliance"];
const isStaff = (ws: Workspace, id: string | undefined) => !!id && STAFF_ROLES.includes(ws.actors.find((a) => a.id === id)?.role ?? "");

/**
 * Review M-2 + R-M2 + R2-M2: the bank debit a STAFF person explicitly accepted (resolve with acceptDifference /
 * acceptLateDate), re-checked against the line as it stands. `pendingSecondApproval` while an above-1% over-amount
 * still lacks a different staff person's approval.
 */
export function acceptedBankLine(ws: Workspace, intentId: string): { exceptionId: string; lineId: string; differenceMinor: number; currency: Money["currency"]; actorId: string; lineAmountMinor: number; late: boolean; valueDate: string; pendingSecondApproval: boolean; approvedBy?: string } | undefined {
  for (const e of ws.exceptions) {
    if (e.intentId !== intentId || e.status !== "resolved" || !e.resolution?.acceptedDifference) continue;
    const resolver = e.resolution.actorId;
    if (!isStaff(ws, resolver)) continue;
    const d = acceptableDifference(ws, e.id);
    const acc = e.resolution.acceptedDifference;
    if (!d.ok) continue;
    if (acc.statementLineId !== d.statementLineId || acc.differenceMinor !== d.differenceMinor || acc.currency !== d.currency) continue;
    if (d.late && acc.lateValueDate !== d.valueDate) continue;
    if (d.needsSecondApproval && !acc.secondApproval) continue;
    const approvedBy = acc.secondApproval?.approvedBy;
    if (approvedBy && (approvedBy === resolver || !isStaff(ws, approvedBy))) continue;
    return { exceptionId: e.id, lineId: d.lineId!, differenceMinor: d.differenceMinor!, currency: d.currency!, actorId: resolver, lineAmountMinor: d.lineAmountMinor!, late: !!d.late, valueDate: d.valueDate!, pendingSecondApproval: !!d.needsSecondApproval && !approvedBy, ...(approvedBy ? { approvedBy } : {}) };
  }
  return undefined;
}

/** R2-M2 (d): a bank debit naming the payout but in another currency, for the blocking message. */
function currencyMismatchLine(ws: Workspace, intentId: string): { lineId: string; currency: Money["currency"] } | undefined {
  const intent = ws.intents.find((i) => i.id === intentId);
  const ppid = ws.instructions.find((i) => i.id === intent?.instructionId)?.providerPaymentId?.toUpperCase();
  if (!intent || !ppid) return undefined;
  const e = ws.exceptions.find((x) => x.intentId === intentId && x.explanationCode === "RC_CURRENCY_MISMATCH" && x.statementLineId);
  const l = e ? ws.statementLines.find((x) => x.id === e.statementLineId) : undefined;
  return l && l.source === "bank_statement" && l.direction === "debit" && referenceTokens(l.reference).includes(ppid) ? { lineId: l.lineId, currency: l.currency } : undefined;
}
