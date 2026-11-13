import { obligationOutstanding } from "./funding";
import { computeLiquidity } from "./liquidity";
import type { AmountDifference, ExceptionCategory, InvestigationCase, Money, ReconciliationException, Severity, Workspace } from "./types";
import { addDays, type Tx } from "./tx";

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
  return { allowed: true, code: "RESOLVABLE", reason: "Owner assigned, linked exceptions resolved, no open requests or undecided hold. A note is required." };
}
