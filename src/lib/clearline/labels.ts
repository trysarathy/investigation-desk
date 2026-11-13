/**
 * CHANGE 5 — human-readable labels for every status value, explanation code and error code the
 * engine can produce. Deterministic text only (no generated prose). The console should render these
 * instead of raw machine values; raw codes stay available for filters, exports and support.
 *
 * Wording rules (from the evidence model): provider statuses are provider CLAIMS; settlement is
 * EVIDENCE with a scope; reconciliation is about statement lines; nothing here says "paid" unless
 * independent evidence says so.
 */
import { RECONCILIATION_CODE_TEXT, type ReconciliationCodeGroup } from "./reconciliation";
import { EXECUTION_TRANSITIONS, isTerminalExecution } from "./state";
import type {
  AdvanceState,
  EngineError,
  EngineErrorCode,
  EvidenceKind,
  EvidenceTimelineKind,
  ExceptionCategory,
  ExceptionStatus,
  ExecutionState,
  HoldStatus,
  InstructionStatus,
  NormalizedEventType,
  ProcessingOutcome,
  ProviderErrorClass,
  ReconciliationState,
  SettlementEvidenceState,
  SettlementScope,
  Severity,
  StatementSource,
  StatusDimensions,
  Workspace,
} from "./types";

const EXECUTION: Record<ExecutionState, string> = {
  created: "Created",
  quoted: "Quoted",
  approved: "Approved — not yet sent",
  submitted: "Sent to provider",
  in_transit: "Provider reports in transit",
  provider_reported_completed: "Provider reports completed",
  awaiting_information: "Provider requests information",
  on_hold: "On hold with the partner",
  failed: "Provider reports failed",
  returned: "Provider reports returned",
  cancelled: "Cancelled",
  expired: "Expired",
};

const SETTLEMENT: Record<SettlementEvidenceState, string> = {
  none: "No settlement evidence",
  observed: "Settlement observed (not verified)",
  pending_finality: "Awaiting finality",
  verified: "Settlement verified",
  contradicted: "Settlement evidence contradicted",
};

const SCOPE: Record<SettlementScope, string> = {
  none: "No evidence",
  provider_report: "Provider report only",
  bank_statement: "Bank statement",
  onchain_transfer: "On-chain transfer (synthetic testnet)",
};

const RECONCILIATION: Record<ReconciliationState, string> = {
  not_started: "Not started",
  pending: "Awaiting statement",
  matched: "Matched",
  partially_matched: "Partially matched",
  exception: "Needs review",
};

const EXCEPTION_CATEGORY: Record<ExceptionCategory, string> = {
  provider_timeout: "Provider has not responded",
  failed_submission: "Submission failed",
  returned_payout: "Payout returned",
  beneficiary_mismatch: "Beneficiary details do not match",
  missing_statement: "Statement evidence missing",
  unmatched_reconciliation: "Statement line not reconciled",
  duplicate_event: "Duplicate provider event",
  unsupported_token_or_network: "Unsupported token or network",
  pending_finality: "Awaiting on-chain finality",
  missing_payment_reference: "Payment reference missing",
  compliance_hold: "Compliance hold",
  funding_shortfall: "Funding shortfall",
  overdue_advance: "Advance repayment overdue",
  contradictory_evidence: "Contradictory evidence",
};

/** One sentence saying why an open exception of this category blocks closing a payment. */
const CATEGORY_BLOCKER: Record<ExceptionCategory, string> = {
  provider_timeout: "The provider has not confirmed the payout's outcome.",
  failed_submission: "The provider rejected the submission.",
  returned_payout: "The returned payout has not been addressed.",
  beneficiary_mismatch: "The beneficiary details are not confirmed.",
  missing_statement: "Settlement evidence is still missing.",
  unmatched_reconciliation: "A statement line is not reconciled.",
  duplicate_event: "A duplicate provider event is unexplained.",
  unsupported_token_or_network: "A transfer on an unsupported token or network needs review.",
  pending_finality: "The on-chain transfer has not reached finality.",
  missing_payment_reference: "A receipt has no payment reference.",
  compliance_hold: "The compliance hold has no final decision.",
  funding_shortfall: "Usable liquidity does not cover the advance.",
  overdue_advance: "A customer repayment is overdue.",
  contradictory_evidence: "Two sources of evidence contradict each other.",
};

const SEVERITY: Record<Severity, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const EXCEPTION_STATUS: Record<ExceptionStatus, string> = { open: "Open", in_review: "In review", resolved: "Resolved", reopened: "Reopened" };
const CASE_STATUS: Record<"open" | "resolved" | "reopened", string> = { open: "Open", resolved: "Closed", reopened: "Reopened" };
const HOLD_STATUS: Record<HoldStatus, string> = {
  open: "Documents requested",
  documents_submitted: "Documents submitted",
  partner_release_reported: "Partner reports release — reviewer decision needed",
  released: "Released by reviewer",
  rejected: "Rejected by reviewer",
};
const HOLD_DECISION: Record<"release" | "reject" | "request_more", string> = { release: "Release", reject: "Reject", request_more: "Request more documents" };
const ADVANCE_STATE: Record<AdvanceState, string> = {
  proposed: "Proposed",
  approved: "Approved",
  declined: "Declined",
  supplier_paid: "Supplier paid (provider-reported)",
  partly_repaid: "Partly repaid",
  repaid: "Repaid",
  overdue: "Overdue",
};
const INSTRUCTION_STATUS: Record<InstructionStatus, string> = { pending_approval: "Awaiting checker approval", approved: "Approved", rejected: "Rejected", submitted: "Submitted" };
const EVENT_TYPE: Record<NormalizedEventType, string> = {
  "payout.accepted": "Provider accepted the payout",
  "payout.in_transit": "Provider reports in transit",
  "payout.completed": "Provider reports completed",
  "payout.failed": "Provider reports failed",
  "payout.returned": "Provider reports returned",
  "payout.on_hold": "Partner placed a hold",
  "payout.information_requested": "Provider requests information",
  "payout.hold_released": "Partner reports hold released",
  "payout.timeout": "No provider response (timer)",
  "chain.transfer_observed": "Transfer observed on chain",
  "chain.confirmations_updated": "Chain confirmations updated",
};
const PROCESSING_OUTCOME: Record<ProcessingOutcome, string> = {
  applied: "Applied",
  recorded_no_state_change: "Recorded — no status change",
  duplicate_ignored: "Duplicate — ignored",
  stored_late_no_regression: "Arrived late — stored, status not moved back",
  contradictory_exception_raised: "Contradiction — sent for review",
  rejected_signature: "Rejected — invalid signature",
  rejected_unknown_payment: "Rejected — unknown payment",
};
const EVIDENCE_KIND: Record<EvidenceKind, string> = {
  provider_status_report: "Provider status report",
  bank_statement_line: "Bank statement line",
  provider_settlement_report: "Provider settlement report",
  chain_observation: "Chain observation (synthetic)",
  document_metadata: "Document (metadata only)",
  funds_returned_confirmation: "Funds-returned confirmation",
  beneficiary_correction: "Beneficiary correction",
  note: "Note",
};
const STATEMENT_SOURCE: Record<StatementSource, string> = { bank_statement: "Bank statement", provider_settlement_report: "Provider settlement report" };
const LINE_STATUS: Record<"unallocated" | "allocated" | "partially_allocated" | "exception", string> = {
  unallocated: "Not allocated",
  allocated: "Allocated",
  partially_allocated: "Partly allocated",
  exception: "Needs review",
};
const CHAIN_STATUS: Record<"observed" | "pending_finality" | "final" | "rejected_unsupported", string> = {
  observed: "Transfer observed",
  pending_finality: "Awaiting finality",
  final: "Final",
  rejected_unsupported: "Not counted — unsupported token or network",
};
const CODE_GROUP: Record<ReconciliationCodeGroup, string> = {
  exact: "Exact match",
  partial: "Partial amount",
  unmatched: "Unmatched",
  duplicate: "Possible duplicate",
  ambiguous: "Ambiguous",
  currency_mismatch: "Currency mismatch",
  contradiction: "Contradicts provider",
  return: "Return",
  informational: "Note",
};
const TIMELINE_KIND: Record<EvidenceTimelineKind, string> = {
  intent_created: "Payment created",
  quote: "Quote",
  instruction_made: "Instruction prepared",
  instruction_checked: "Instruction checked",
  provider_event: "Provider event",
  statement_line: "Statement line",
  allocation: "Matching decision",
  chain_observation: "Chain observation",
  evidence: "Evidence",
  hold_decision: "Hold decision",
  exception: "Exception",
  missing_evidence: "Missing evidence",
};
const PROVIDER_ERROR_CLASS: Record<ProviderErrorClass, string> = {
  none: "no error",
  beneficiary_rejected: "beneficiary rejected",
  compliance_review: "compliance review",
  insufficient_information: "insufficient information",
  provider_unavailable: "provider unavailable",
  timeout: "timeout",
  unknown: "unknown reason",
};
/** applyAction outcome strings. */
const ACTION_OUTCOME: Record<string, string> = {
  applied: "Done",
  idempotent_replay: "Already done — same request replayed",
  rejected_signature: "Rejected — invalid signature",
  rejected_unknown_payment: "Rejected — unknown payment",
  duplicate_ignored: "Duplicate — ignored",
  stored_late_no_regression: "Arrived late — stored, status not moved back",
  contradictory_exception_raised: "Contradiction — sent for review",
  timeout_exception_raised: "No provider response — exception raised",
  no_event_pending: "No provider event pending",
  allocated: "Matched to a statement line",
  exception_raised: "Needs review — exception raised",
  recorded_no_state_change: "Recorded — no status change",
  recorded_provider_report: "Provider report recorded (not independent evidence)",
  duplicate_report_linked: "Same short provider report again — linked to the open exception",
  no_eligible_route: "No eligible route",
};
const ERROR_CODE: Record<EngineErrorCode, string> = {
  invalid_amount: "The amount is not valid.",
  invalid_currency: "This currency is not supported.",
  currency_mismatch: "The currencies do not match.",
  invalid_field: "Some information is missing or not valid.",
  not_found: "That item could not be found.",
  idempotency_conflict: "This request key was already used for a different payment.",
  invalid_transition: "That step is not allowed in the current status.",
  unauthorized_actor: "Your role cannot do this.",
  maker_checker_violation: "The same person cannot prepare and approve.",
  quote_expired: "The quote has expired.",
  quote_ineligible: "This route is not eligible.",
  precondition_failed: "An earlier step is still needed.",
  resolution_not_permitted: "This cannot be resolved yet.",
  duplicate_statement_line: "This statement line was already imported.",
  webhook_signature_invalid: "The webhook signature is not valid.",
  unsupported_token_or_network: "This token or network is not supported.",
  hold_requires_human_decision: "A compliance reviewer must decide the hold first.",
};
/** Extra error codes that only the v1 HTTP API returns. */
const API_ERROR_CODE: Record<"unauthenticated" | "unknown_endpoint" | "invalid_json" | "invalid_request", string> = {
  unauthenticated: "The test API key is missing or wrong.",
  unknown_endpoint: "No such API endpoint.",
  invalid_json: "The request body is not valid JSON or is too large.",
  invalid_request: "The request could not be processed.",
};
/** canResolveException / canResolveCase codes (also the "CODE:" prefix of resolve refusals). */
const RESOLUTION_CODE: Record<string, string> = {
  NOT_FOUND: "Not found.",
  ALREADY_RESOLVED: "Already resolved.",
  OWNER_REQUIRED: "Assign an owner first.",
  OPEN_EXCEPTIONS: "Linked exceptions are still open.",
  OPEN_INFO_REQUESTS: "Requested information has not been provided.",
  HOLD_UNDECIDED: "The compliance hold has no final reviewer decision.",
  HOLD_NOT_DECIDED: "The compliance reviewer has not released or rejected the hold.",
  FINALITY_NOT_REACHED: "The on-chain transfer has not reached finality.",
  OUTSTANDING_REMAINS: "An amount is still outstanding on the advance.",
  SHORTFALL_REMAINS: "Usable liquidity still does not cover the advance.",
  RETURN_NOT_ADDRESSED: "Confirm the returned funds or create a correction first.",
  NO_PROVIDER_RESPONSE: "The provider has not responded since the timeout.",
  EVIDENCE_REQUIRED: "Attach supporting evidence first (a note alone is not enough).",
  RESOLVABLE: "Can be resolved (a note is required).",
};
/** Quote eligibility codes (ProviderAdapter.eligibility). */
const ELIGIBILITY_CODE: Record<string, string> = {
  ELIGIBLE: "Eligible route",
  ROUTE_RESTRICTED: "Route restricted",
  SOURCE_CURRENCY_UNSUPPORTED: "Source currency not supported on this route",
  DESTINATION_CURRENCY_UNSUPPORTED: "Destination currency not offered on this route",
  COUNTRY_UNSUPPORTED: "Destination country not offered on this route",
  PAIR_UNSUPPORTED: "No rate for this currency pair",
  BELOW_MINIMUM: "Below the route minimum",
  ABOVE_MAXIMUM: "Above the route maximum",
  FEE_UNDEFINED: "No fee schedule for this currency",
  AMOUNT_BELOW_FEES: "Amount does not cover fees",
  RATE_UNAVAILABLE: "No usable rate on this route",
};

/** Every static explanation code the engine emits, with a short human label. */
export const CODE_LABELS: Readonly<Record<string, string>> = {
  // Reconciliation (line, allocation and exception codes)
  RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW: "Exact match: reference, amount, currency and dates agree",
  RC_PARTIAL_AMOUNT: "Partial amount — remainder outstanding",
  RC_OVERPAYMENT: "Amount is more than expected — not matched",
  RC_CURRENCY_MISMATCH: "Currency differs — not matched",
  RC_OUTSIDE_TIME_WINDOW: "Value date outside the matching window",
  RC_LATE_STATEMENT: "Statement arrived late",
  RC_NO_REFERENCE: "No payment reference",
  RC_UNKNOWN_REFERENCE: "Reference not recognised",
  RC_AMOUNT_ONLY_CANDIDATES: "Only the amount matches — not enough to match",
  RC_AMBIGUOUS_REFERENCE: "Reference matches more than one item",
  RC_DUPLICATE_SUSPECTED: "Possible duplicate line",
  RC_RETURN_CONFIRMS_PROVIDER_RETURN: "Return confirmed on the statement",
  RC_RETURN_CONTRADICTS_PROVIDER_STATUS: "Return line contradicts the provider's status",
  RC_UNMATCHED_INCOMING: "Incoming funds not matched",
  RC_UNMATCHED_OUTGOING: "Outgoing funds not matched",
  RC_PROVIDER_REPORT_ONLY: "Provider report only — not independent evidence",
  RC_REPAYMENT_BY_REFERENCE: "Repayment matched by its reference",
  RC_UNDER_AMOUNT_REPORT: "Provider reports less than the payout amount",
  RC_REPORT_ON_TERMINAL_PAYOUT: "Provider reports settlement on a failed, cancelled, expired or returned payout",
  RC_REPORT_ON_HELD_PAYOUT: "Provider reports settlement on a payout that is on hold — not counted",
  RC_DEBIT_FOR_FAILED_PAYOUT: "Bank debit for a payout the provider reported as failed",
  RC_DEBIT_FOR_TERMINAL_PAYOUT: "Bank debit for a payout that was cancelled or expired",
  RC_NO_STATEMENT_AFTER_COMPLETION: "No statement line after provider-reported completion",
  // Provider events
  EV_AMOUNT_DIFFERS_FROM_INSTRUCTION: "Provider amount differs from the approved instruction",
  EV_IMPOSSIBLE_TRANSITION: "Provider status is not possible from the current status",
  EV_PROVIDER_EVENT_WHILE_ON_HOLD: "Provider event arrived while the payout is on hold",
  EV_TERMINAL_EVENT_WHILE_ON_HOLD: "Provider reports a final outcome while the payout is on hold — a person must apply it",
  EV_SAME_ID_DIFFERENT_PAYLOAD: "Same provider event id with different content",
  // Chain
  CH_AMOUNT_DIFFERS_FROM_QUOTE: "On-chain amount differs from the quote",
  CH_BELOW_FINALITY_THRESHOLD: "Below the finality threshold",
  CH_CONFIRMATIONS_DECREASED: "Confirmations went down (possible reorg)",
  CH_SECOND_TX_FOR_PAYOUT: "A second transaction for the same payout",
  CH_TX_ALREADY_LINKED: "Transaction already linked to another payout",
  CH_TX_DIFFERS_FROM_PROVIDER: "Transaction differs from the one the provider reported",
  CH_UNSUPPORTED_TOKEN_OR_NETWORK: "Unsupported token or network — not counted",
  CH_WALLET_NOT_BENEFICIARY: "Sent to a wallet that is not the beneficiary's",
  // Provider-side exception codes
  PV_SUBMISSION_REJECTED: "Provider rejected the submission",
  PV_NO_RESPONSE_SIMULATED: "No provider response (simulated timeout)",
  PV_NO_STATUS_WITHIN_WINDOW: "No provider status within the expected window",
  PV_PARTNER_COMPLIANCE_HOLD: "Partner compliance hold",
  // Funding
  FD_FRESH_USABLE_BELOW_PRINCIPAL: "Fresh usable liquidity is below the advance amount",
  FD_OUTSTANDING_AFTER_DUE_DATE: "Repayment still outstanding after the due date",
  // Investigation findings
  PR_NOT_SUBMITTED: "Not sent to a provider yet",
  PR_COMPLETED_IS_PROVIDER_CLAIM: "Completion is the provider's claim, not settlement evidence",
  PR_LATE_EVENT_STORED: "Late provider event stored without changing status",
  PR_DUPLICATE_IGNORED: "Duplicate provider event ignored",
  PR_BAD_SIGNATURE_REJECTED: "Webhook with an invalid signature rejected",
  IE_BANK_STATEMENT_LINE: "Bank statement line",
  IE_CHAIN_OBSERVATION: "Chain observation (synthetic)",
  IE_CHAIN_FINAL: "On-chain transfer final",
  IE_CHAIN_NOT_FINAL: "On-chain transfer not yet final",
  IE_CHAIN_UNSUPPORTED_NOT_COUNTED: "Unsupported chain transfer — not counted",
  IE_NONE: "No independent evidence yet",
  UK_NO_INDEPENDENT_SETTLEMENT_EVIDENCE: "No independent settlement evidence yet",
  UK_BENEFICIARY_CREDIT_NOT_EVIDENCED: "Beneficiary's credit not evidenced",
  UK_ONLY_PROVIDER_SETTLEMENT_REPORT: "Only a provider settlement report — no bank evidence",
  UK_BANK_CREDIT_NOT_PROVEN_BY_CHAIN: "A chain transfer does not prove a bank credit",
  UK_WALLET_OWNERSHIP_NOT_VERIFIED: "Wallet ownership not verified",
  UK_IN_TRANSIT_NOT_REPORTED: "Provider never reported in transit",
  UK_PROVIDER_OUTCOME_UNKNOWN: "Provider outcome unknown",
  UK_HOLD_OUTCOME_PENDING: "Hold outcome pending",
  CT_SETTLEMENT_CONTRADICTED: "Settlement evidence contradicted",
  OS_NOT_RECONCILED: "Not yet reconciled to a statement",
  OS_PARTIALLY_RECONCILED: "Partly reconciled — remainder outstanding",
  OS_RETURN_NOT_YET_RECEIVED: "Return not yet seen on a statement — supplier unpaid",
  OS_RETURN_RECEIVED_SUPPLIER_UNPAID: "Returned funds received — supplier still unpaid",
  OS_ADVANCE_OUTSTANDING: "Advance repayment outstanding",
  OS_ADVANCE_OVERDUE: "Advance repayment overdue",
  OS_UNALLOCATED_RECEIPT: "Receipt not allocated",
  WA_CHECKER: "A checker (not the maker) acts next",
  WA_OPERATIONS: "Operations acts next",
  WA_PROVIDER: "Waiting for the provider",
  WA_NONE: "Nothing outstanding",
  WA_COMPLIANCE_REVIEWER: "The compliance reviewer acts next",
  WA_COMPLIANCE_UNASSIGNED: "Assign a compliance reviewer",
  WA_EXCEPTION_OWNER: "The exception owner acts next",
  WA_UNASSIGNED: "Unassigned — operations should assign an owner",
  NA_REQUEST_QUOTES: "Request quotes",
  NA_CHOOSE_ROUTE: "Choose a route",
  NA_CHECKER_APPROVAL: "Checker approval needed",
  NA_SUBMIT: "Submit to the provider",
  NA_AWAIT_PROVIDER: "Wait for the provider",
  NA_INGEST_STATEMENT: "Import the statement line",
  NA_AWAIT_FINALITY: "Wait for finality",
  NA_NONE: "No action needed",
  QT_ELIGIBLE: "Eligible indicative quote",
  QT_INELIGIBLE: "Ineligible quote",
  MC_MAKER: "Prepared by the maker",
  MC_CHECKER: "Checked by a different person",
  ...Object.fromEntries(Object.entries(ELIGIBILITY_CODE)),
};

/** All human labels, keyed by dimension. Every member of every engine union has an entry. */
export const HUMAN_LABELS = {
  execution: EXECUTION,
  settlement: SETTLEMENT,
  settlementScope: SCOPE,
  reconciliation: RECONCILIATION,
  exceptionCategory: EXCEPTION_CATEGORY,
  exceptionBlocker: CATEGORY_BLOCKER,
  severity: SEVERITY,
  exceptionStatus: EXCEPTION_STATUS,
  caseStatus: CASE_STATUS,
  holdStatus: HOLD_STATUS,
  holdDecision: HOLD_DECISION,
  advanceState: ADVANCE_STATE,
  instructionStatus: INSTRUCTION_STATUS,
  eventType: EVENT_TYPE,
  processingOutcome: PROCESSING_OUTCOME,
  evidenceKind: EVIDENCE_KIND,
  statementSource: STATEMENT_SOURCE,
  statementLineStatus: LINE_STATUS,
  chainObservationStatus: CHAIN_STATUS,
  reconciliationCodeGroup: CODE_GROUP,
  timelineKind: TIMELINE_KIND,
  providerErrorClass: PROVIDER_ERROR_CLASS,
  actionOutcome: ACTION_OUTCOME,
  errorCode: ERROR_CODE,
  apiErrorCode: API_ERROR_CODE,
  resolutionCode: RESOLUTION_CODE,
  eligibilityCode: ELIGIBILITY_CODE,
} as const;

const own = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const lowerKey = (suffix: string) => suffix.toLowerCase();
const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Dynamic code families (built from enum values in investigation/events). */
function dynamic(code: string): string | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^PR_LAST_([A-Z_]+)$/.exec(code))) {
    const type = (Object.keys(EVENT_TYPE) as NormalizedEventType[]).find((t) => t.replace(".", "_").toUpperCase() === m![1]);
    return type ? `Last provider report: ${EVENT_TYPE[type].replace(/^Provider /, "provider ")}` : undefined;
  }
  if ((m = /^PV_(FAILED|RETURNED)_([A-Z_]+)$/.exec(code))) {
    const cls = own(PROVIDER_ERROR_CLASS, lowerKey(m[2]));
    return cls ? `Provider reports ${m[1] === "FAILED" ? "failed" : "returned"} (${cls})` : undefined;
  }
  if ((m = /^NA_([A-Z_]+)$/.exec(code))) {
    const cat = own(EXCEPTION_CATEGORY, lowerKey(m[1]));
    return cat ? `Resolve: ${cat.charAt(0).toLowerCase() + cat.slice(1)}` : undefined;
  }
  if ((m = /^PE_([A-Z_]+)$/.exec(code))) return own(PROCESSING_OUTCOME, lowerKey(m[1]));
  if ((m = /^CH_([A-Z_]+)$/.exec(code))) {
    const s = own(CHAIN_STATUS, lowerKey(m[1]));
    return s ? `Chain: ${s.charAt(0).toLowerCase() + s.slice(1)}` : undefined;
  }
  if ((m = /^EV_([A-Z_]+)$/.exec(code))) return own(EVIDENCE_KIND, lowerKey(m[1]));
  if ((m = /^HD_([A-Z_]+)$/.exec(code))) {
    const d = own(HOLD_DECISION, lowerKey(m[1]));
    return d ? `Compliance reviewer: ${d.charAt(0).toLowerCase() + d.slice(1)}` : undefined;
  }
  return undefined;
}

/** True when describeCode has a specific label for this code. */
export function isKnownCode(code: string): boolean {
  return typeof code === "string" && (own(CODE_LABELS, code) !== undefined || own(RESOLUTION_CODE, code) !== undefined || dynamic(code) !== undefined);
}

/** Human label for any explanation, finding, outcome or resolution code. Never throws, never empty. */
export function describeCode(code: string): string {
  if (typeof code !== "string" || !code) return "Unrecognised code";
  return own(CODE_LABELS, code) ?? own(RESOLUTION_CODE, code) ?? dynamic(code) ?? `Unrecognised code (${code})`;
}

/** Longer explanation for a reconciliation code (falls back to the short label). */
export function explainCode(code: string): string {
  return own(RECONCILIATION_CODE_TEXT as Readonly<Record<string, string>>, code) ?? describeCode(code);
}

export interface StatusDescription {
  execution: string;
  settlement: string;
  settlementScope: string;
  reconciliation: string;
  /** One line, the four dimensions kept separate, e.g. "Provider reports completed · Settlement verified (Bank statement) · Matched". */
  summary: string;
  /** From the execution state machine: no further execution transition is possible. */
  executionFinal: boolean;
}

/** Labels for the four status dimensions (never collapsed into one "paid" badge). */
export function describeStatus(s: StatusDimensions): StatusDescription {
  const execution = own(EXECUTION, s.execution) ?? `Unrecognised status (${s.execution})`;
  const settlement = own(SETTLEMENT, s.settlement) ?? `Unrecognised settlement (${s.settlement})`;
  const settlementScope = own(SCOPE, s.settlementScope) ?? `Unrecognised scope (${s.settlementScope})`;
  let reconciliation = own(RECONCILIATION, s.reconciliation) ?? `Unrecognised reconciliation (${s.reconciliation})`;
  // CHANGE 4 N2: a returned payout whose return is confirmed reconciles to net zero; the supplier is still unpaid.
  if (s.execution === "returned" && s.reconciliation === "matched") reconciliation = "Returned — net zero (supplier still unpaid)";
  const executionFinal = Object.prototype.hasOwnProperty.call(EXECUTION_TRANSITIONS, s.execution) && isTerminalExecution(s.execution);
  const scopePart = s.settlement !== "none" && s.settlementScope !== "none" ? ` (${settlementScope})` : "";
  return { execution, settlement, settlementScope, reconciliation, executionFinal, summary: `${execution} · ${settlement}${scopePart} · ${reconciliation}` };
}

export interface HumanError {
  code: string;
  /** The "CODE:" prefix of a resolve refusal (OPEN_EXCEPTIONS, EVIDENCE_REQUIRED, …), when present. */
  reasonCode?: string;
  headline: string;
  detail: string;
  /** headline + " " + detail. */
  text: string;
}

/**
 * Human text for an engine (or v1 API) error. Pass the workspace to get the specific reason a
 * payment cannot be closed (e.g. "Payment cannot be closed. Settlement evidence is still missing.").
 */
export function describeError(err: Pick<EngineError, "message"> & { code: string; field?: string; entityId?: string }, ws?: Workspace): HumanError {
  const code = typeof err?.code === "string" ? err.code : "invalid_request";
  const message = typeof err?.message === "string" ? err.message : "";
  const prefix = /^([A-Z][A-Z_]+): (.*)$/s.exec(message);
  const reasonCode = prefix && own(RESOLUTION_CODE, prefix[1]) !== undefined ? prefix[1] : undefined;
  const reasonText = prefix && reasonCode ? prefix[2] : message;
  const base = own(ERROR_CODE as Record<string, string>, code) ?? own(API_ERROR_CODE as Record<string, string>, code) ?? "Something went wrong.";

  const done = (headline: string, detail: string): HumanError => ({ code, reasonCode, headline, detail, text: detail ? `${headline} ${detail}` : headline });

  if (reasonCode) {
    const id = err.entityId;
    const kase = id ? ws?.cases.find((c) => c.id === id) : undefined;
    const exc = id ? ws?.exceptions.find((e) => e.id === id) : undefined;
    const isException = Boolean(exc) || (id?.startsWith("exc") ?? false);
    const headline = isException ? "Exception cannot be resolved." : kase && !kase.intentId ? "Case cannot be closed." : "Payment cannot be closed.";
    if (reasonCode === "ALREADY_RESOLVED") return done(isException ? "Exception is already resolved." : "Already closed.", "");
    if (reasonCode === "OPEN_EXCEPTIONS" && ws && kase) {
      const open = ws.exceptions.filter((e) => kase.exceptionIds.includes(e.id) && e.status !== "resolved");
      if (open.length) {
        const first = open.find((e) => e.category === "missing_statement") ?? open.find((e) => e.category === "contradictory_evidence") ?? open[0];
        const why = first.explanationCode === "RC_UNDER_AMOUNT_REPORT" ? "The provider reported less than the payout amount." : CATEGORY_BLOCKER[first.category] ?? RESOLUTION_CODE.OPEN_EXCEPTIONS;
        return done(headline, open.length > 1 ? `${why} ${open.length - 1} other open exception${open.length > 2 ? "s" : ""} must also be resolved.` : why);
      }
    }
    if (reasonCode === "EVIDENCE_REQUIRED" && exc?.category === "missing_statement") return done(headline, "Settlement evidence is still missing.");
    return done(headline, RESOLUTION_CODE[reasonCode]);
  }
  if (code === "invalid_field" && err.field) return done(base, `Check "${err.field}": ${reasonText}`);
  return done(base, sentence(reasonText));
}
