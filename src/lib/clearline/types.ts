/**
 * Clearline unified sandbox engine — canonical model.
 *
 * SANDBOX / TEST MODE ONLY. Every organisation, provider, beneficiary, amount, hash and
 * address in this engine is fictional. The engine never calls a real provider, never holds
 * keys, never moves money, never makes a credit, custody, lending or compliance decision.
 *
 * Rules encoded in these types:
 * - Amounts are integer minor units (`amountMinor`) paired with an ISO-style currency code.
 *   USDC uses 6 decimals. Amounts in different currencies are never added together.
 * - A payment has three independent status DIMENSIONS (execution, settlement evidence,
 *   reconciliation). There is no combined status.
 * - A provider-reported "completed" is a provider claim, never verified settlement.
 */

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

export type CurrencyCode = "SGD" | "USD" | "PHP" | "EUR" | "USDC";

/** An exact amount: integer minor units + currency. Never a float. */
export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

// ---------------------------------------------------------------------------------------------
// Errors and results
// ---------------------------------------------------------------------------------------------

export type EngineErrorCode =
  | "invalid_amount"
  | "invalid_currency"
  | "currency_mismatch"
  | "invalid_field"
  | "not_found"
  | "idempotency_conflict"
  | "invalid_transition"
  | "unauthorized_actor"
  | "maker_checker_violation"
  | "quote_expired"
  | "quote_ineligible"
  | "precondition_failed"
  | "resolution_not_permitted"
  | "duplicate_statement_line"
  | "webhook_signature_invalid"
  | "unsupported_token_or_network"
  | "hold_requires_human_decision";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  /** Optional field / entity the error refers to. */
  field?: string;
  entityId?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };

// ---------------------------------------------------------------------------------------------
// Actors and organisation
// ---------------------------------------------------------------------------------------------

/** operator = maker; approver = checker/treasury; compliance = hold reviewer; viewer = read only. */
export type ActorRole = "operator" | "approver" | "compliance" | "viewer";

export interface Actor {
  id: string;
  name: string;
  role: ActorRole;
}

export interface Organization {
  id: string;
  name: string;
  /** Always true in this engine: the organisation is fictional. */
  fictional: true;
  baseCurrency: CurrencyCode;
  timezone: string;
}

/** Every action receives who performs it and at what (simulated) instant. */
export interface ActionContext {
  actorId: string;
  /** ISO-8601 instant. The engine never reads the wall clock. */
  at: string;
}

// ---------------------------------------------------------------------------------------------
// Status dimensions (never combined)
// ---------------------------------------------------------------------------------------------

export type ExecutionState =
  | "created"
  | "quoted"
  | "approved"
  | "submitted"
  | "in_transit"
  | "provider_reported_completed"
  | "awaiting_information"
  | "on_hold"
  | "failed"
  | "returned"
  | "cancelled"
  | "expired";

export type SettlementEvidenceState = "none" | "observed" | "pending_finality" | "verified" | "contradicted";

/** What a settlement evidence state actually covers. A chain transfer never proves a bank credit. */
export type SettlementScope = "none" | "provider_report" | "bank_statement" | "onchain_transfer";

export type ReconciliationState = "not_started" | "pending" | "matched" | "partially_matched" | "exception";

export interface StatusDimensions {
  execution: ExecutionState;
  settlement: SettlementEvidenceState;
  settlementScope: SettlementScope;
  reconciliation: ReconciliationState;
}

// ---------------------------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------------------------

export type RailKind = "fiat_local" | "fiat_correspondent" | "stablecoin_testnet";

/** Sandbox control: lets a test choose the deterministic provider outcome (like test card numbers). */
export type SandboxOutcome = "success" | "return" | "hold" | "chain_delay" | "submission_failure";

export interface PaymentIntent {
  id: string;
  orgId: string;
  internalReference: string;
  amountMinor: number;
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  purpose: string;
  /** Opaque fictional beneficiary reference, never real bank details. */
  beneficiaryRef: string;
  beneficiaryName: string;
  /** ISO 3166-1 alpha-2 */
  destinationCountry: string;
  /** YYYY-MM-DD */
  requestedExecutionDate: string;
  railEligibility: RailKind[];
  idempotencyKey: string;
  metadata: Record<string, string>;
  sandboxOutcome: SandboxOutcome;
  status: StatusDimensions;
  quoteIds: string[];
  selectedQuoteId?: string;
  instructionId?: string;
  caseId?: string;
  advanceId?: string;
  /** If this intent corrects a returned payout. */
  correctsIntentId?: string;
  /**
   * Return tracking, separate from the reconciliation dimension: "provider_reported" when the
   * provider reports a returned payout (reconciliation becomes "exception"); "confirmed_by_statement"
   * once a return/reversal statement line with the trusted reference is allocated
   * (code RC_RETURN_CONFIRMS_PROVIDER_RETURN). The supplier is still unpaid in both cases.
   */
  returnStatus?: "provider_reported" | "confirmed_by_statement";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Fictional scenario label for seeded data. */
  scenario?: string;
}

export interface CreateIntentInput {
  internalReference: string;
  /** Integer minor units of sourceCurrency. */
  amountMinor: number;
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  purpose: string;
  beneficiaryRef: string;
  beneficiaryName: string;
  destinationCountry: string;
  requestedExecutionDate: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  sandboxOutcome?: SandboxOutcome;
  correctsIntentId?: string;
}

export interface ProviderRoute {
  id: string;
  providerId: string;
  providerName: string;
  rail: RailKind;
  sourceCurrencies: CurrencyCode[];
  destinationCurrencies: CurrencyCode[];
  destinationCountries: string[];
  /** Indicative only. Destination units per 1 source unit as a decimal string. */
  indicativeRates: Record<string, string>;
  /** Fixed provider fee per source currency, in that currency's minor units. */
  providerFees: Partial<Record<CurrencyCode, number>>;
  platformFeeBps: number;
  etaLabel: string;
  etaMinutes: number;
  minAmountMinor: number;
  maxAmountMinor: number;
  prerequisites: string[];
  /** When set, the route is never eligible and this explains why. */
  restriction?: string;
  network?: { name: "Base Sepolia"; chainId: 84532; testnet: true };
}

export const QUOTE_LABEL = "Indicative sandbox quote — not executable" as const;

export interface Quote {
  id: string;
  intentId: string;
  providerId: string;
  providerName: string;
  routeId: string;
  rail: RailKind;
  sourceCurrency: CurrencyCode;
  destinationCurrency: CurrencyCode;
  /** Decimal string, destination per source unit. "—" when ineligible. */
  indicativeRate: string;
  providerFeeMinor: number;
  platformFeeMinor: number;
  /** In destination currency minor units. 0 when ineligible. */
  estimatedRecipientMinor: number;
  expiresAt: string;
  etaLabel: string;
  prerequisites: string[];
  eligible: boolean;
  eligibilityReason: string;
  source: string;
  quotedAt: string;
  freshness: "fresh" | "expired";
  label: typeof QUOTE_LABEL;
}

export type InstructionStatus = "pending_approval" | "approved" | "rejected" | "submitted";

export interface PaymentInstruction {
  id: string;
  intentId: string;
  quoteId: string;
  routeId: string;
  providerId: string;
  amountMinor: number;
  currency: CurrencyCode;
  makerId: string;
  madeAt: string;
  checkerId?: string;
  checkedAt?: string;
  status: InstructionStatus;
  /** Assigned by the provider adapter on submit. Trusted reference for reconciliation. */
  providerPaymentId?: string;
  submittedAt?: string;
}

// ---------------------------------------------------------------------------------------------
// Provider events
// ---------------------------------------------------------------------------------------------

export type NormalizedEventType =
  | "payout.accepted"
  | "payout.in_transit"
  | "payout.completed"
  | "payout.failed"
  | "payout.returned"
  | "payout.on_hold"
  | "payout.information_requested"
  | "payout.hold_released"
  | "payout.timeout"
  | "chain.transfer_observed"
  | "chain.confirmations_updated";

export type EventProvenance =
  | "provider_webhook"
  | "provider_api_response"
  | "provider_poll"
  | "clearline_timer"
  | "chain_observer_synthetic";

export type ProcessingOutcome =
  | "applied"
  | "recorded_no_state_change"
  | "duplicate_ignored"
  | "stored_late_no_regression"
  | "contradictory_exception_raised"
  | "rejected_signature"
  | "rejected_unknown_payment";

export type SignatureResult = "valid" | "invalid" | "not_applicable";

export type ProviderErrorClass =
  | "none"
  | "beneficiary_rejected"
  | "compliance_review"
  | "insufficient_information"
  | "provider_unavailable"
  | "timeout"
  | "unknown";

export interface ProviderEvent {
  id: string;
  providerId: string;
  providerName: string;
  providerEventId: string;
  /** Clearline payment intent id, when resolved. */
  intentId?: string;
  providerPaymentId?: string;
  payloadRef: string;
  /** Deterministic hash of the raw payload. */
  payloadHash: string;
  providerTimestamp: string;
  receivedAt: string;
  /** Provider-side ordering hint. */
  sequence: number;
  signatureResult: SignatureResult;
  dedupeKey: string;
  normalizedType: NormalizedEventType;
  processingOutcome: ProcessingOutcome;
  provenance: EventProvenance;
  /** "provider_claim" = what the provider says; never independent evidence. */
  confidence: "provider_claim" | "observed" | "unverified";
  errorClass: ProviderErrorClass;
  detail: Record<string, string | number>;
  /** Sandbox only: the raw payload as received (fictional data), kept for replay/duplicate tests. */
  rawBody?: string;
}

/** The provider's raw sandbox webhook payload (JSON-serialised before signing). */
export interface SandboxWebhookPayload {
  id: string;
  type: NormalizedEventType;
  provider_payment_id: string;
  sequence: number;
  occurred_at: string;
  amount_minor?: number;
  currency?: CurrencyCode;
  reason?: string;
  requested_documents?: string[];
  /** Stablecoin routes: the on-chain transaction the provider says carries this payout. */
  tx_hash?: string;
}

export interface WebhookDelivery {
  providerId: string;
  rawBody: string;
  /** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>` */
  signatureHeader: string;
}

// ---------------------------------------------------------------------------------------------
// Evidence, statements, reconciliation
// ---------------------------------------------------------------------------------------------

export type EvidenceKind =
  | "provider_status_report"
  | "bank_statement_line"
  | "provider_settlement_report"
  | "chain_observation"
  | "document_metadata"
  | "funds_returned_confirmation"
  | "beneficiary_correction"
  | "note";

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  intentId?: string;
  caseId?: string;
  advanceId?: string;
  description: string;
  /** Who produced the underlying record (provider, bank, chain, user upload metadata). */
  source: string;
  independent: boolean;
  reference?: string;
  /** Metadata only; the engine never stores file contents. */
  documentName?: string;
  sha256?: string;
  recordedBy: string;
  recordedAt: string;
}

export type StatementSource = "bank_statement" | "provider_settlement_report";

export interface StatementLineInput {
  /** The statement's own line id; duplicates by (source, accountRef, lineId) are rejected. */
  lineId: string;
  source: StatementSource;
  accountRef: string;
  direction: "debit" | "credit";
  kind: "payment" | "return" | "reversal";
  amountMinor: number;
  currency: CurrencyCode;
  /** Remittance/reference text as printed; may be empty. */
  reference: string;
  counterparty: string;
  valueDate: string;
  /** Defaults to the action instant. */
  receivedAt?: string;
}

export interface StatementLine extends StatementLineInput {
  id: string;
  receivedAt: string;
  allocationIds: string[];
  status: "unallocated" | "allocated" | "partially_allocated" | "exception";
  explanationCodes: ReconciliationCode[];
  /** CHANGE 5 (F2): set when the line shows less than the payout needs. */
  amountDifference?: AmountDifference;
}

export type ReconciliationCode =
  | "RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW"
  | "RC_PARTIAL_AMOUNT"
  | "RC_OVERPAYMENT"
  | "RC_CURRENCY_MISMATCH"
  | "RC_OUTSIDE_TIME_WINDOW"
  | "RC_LATE_STATEMENT"
  | "RC_NO_REFERENCE"
  | "RC_UNKNOWN_REFERENCE"
  | "RC_AMOUNT_ONLY_CANDIDATES"
  | "RC_AMBIGUOUS_REFERENCE"
  | "RC_DUPLICATE_SUSPECTED"
  | "RC_RETURN_CONFIRMS_PROVIDER_RETURN"
  | "RC_RETURN_CONTRADICTS_PROVIDER_STATUS"
  | "RC_UNMATCHED_INCOMING"
  | "RC_UNMATCHED_OUTGOING"
  | "RC_PROVIDER_REPORT_ONLY"
  | "RC_REPAYMENT_BY_REFERENCE"
  /** CHANGE 5 (F2): a provider settlement report for less than the payout amount. */
  | "RC_UNDER_AMOUNT_REPORT"
  /** CHANGE 5 (F1): a provider settlement report on a failed, cancelled, expired or returned payout (in either order). */
  | "RC_REPORT_ON_TERMINAL_PAYOUT"
  /** Review v2 (m2): a provider settlement report on a payout that is on a partner compliance hold. */
  | "RC_REPORT_ON_HELD_PAYOUT";

/**
 * CHANGE 5 (F2): structured amount difference between what a payout needs and what one statement
 * line or provider report shows. Carried on the line, on its exception, in investigate() and in the
 * evidence timeline. All amounts are integer minor units of `currency`.
 */
export interface AmountDifference {
  code: "RC_UNDER_AMOUNT_REPORT" | "RC_PARTIAL_AMOUNT";
  /** What this line was expected to cover: the payout amount (provider report) or the unreconciled remainder before this line (bank line). */
  expectedMinor: number;
  reportedMinor: number;
  /** expectedMinor − reportedMinor (> 0). */
  differenceMinor: number;
  currency: CurrencyCode;
  source: StatementSource;
  statementLineId: string;
  requiredNextAction: string;
}

/** Review v2 (M3): an amount difference as shown by investigate(), with whether it still applies. */
export interface InvestigationAmountDifference extends AmountDifference {
  outstanding: boolean;
}

export interface ReconciliationAllocation {
  id: string;
  /** The statement line id, or the chain observation id when evidenceKind is "chain_observation". */
  statementLineId: string;
  evidenceKind: "statement_line" | "chain_observation";
  target: { kind: "payment"; intentId: string } | { kind: "repayment"; obligationId: string };
  amountMinor: number;
  currency: CurrencyCode;
  matchedBy: "trusted_reference";
  codes: ReconciliationCode[];
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Exceptions, cases, holds
// ---------------------------------------------------------------------------------------------

export type ExceptionCategory =
  | "provider_timeout"
  | "failed_submission"
  | "returned_payout"
  | "beneficiary_mismatch"
  | "missing_statement"
  | "unmatched_reconciliation"
  | "duplicate_event"
  | "unsupported_token_or_network"
  | "pending_finality"
  | "missing_payment_reference"
  | "compliance_hold"
  | "funding_shortfall"
  | "overdue_advance"
  | "contradictory_evidence";

export type Severity = "low" | "medium" | "high" | "critical";
export type ExceptionStatus = "open" | "in_review" | "resolved" | "reopened";

export interface HistoryEntry {
  at: string;
  actorId: string;
  action: string;
  detail: string;
}

export interface ReconciliationException {
  id: string;
  category: ExceptionCategory;
  severity: Severity;
  status: ExceptionStatus;
  explanationCode: string;
  explanation: string;
  intentId?: string;
  advanceId?: string;
  obligationId?: string;
  statementLineId?: string;
  caseId?: string;
  /** Candidate targets preserved for ambiguous cases (never auto-picked). */
  candidates: string[];
  supportingEventIds: string[];
  supportingEvidenceIds: string[];
  ownerId?: string;
  impact?: Money;
  /** CHANGE 5 (F2): structured under-amount detail (RC_UNDER_AMOUNT_REPORT). */
  amountDifference?: AmountDifference;
  dueDate?: string;
  requiredAction: string;
  createdAt: string;
  lastUpdatedAt: string;
  history: HistoryEntry[];
  /**
   * Who resolved it, when and why. `acceptedDifference` (re-review R-M2): set only when the person resolved an
   * RC_OVERPAYMENT exception with `acceptDifference: true` on a bank debit that otherwise matches the payout
   * (see acceptedBankLine): the over-amount the person accepted.
   */
  resolution?: {
    at: string; actorId: string; note: string;
    /**
     * R-M2 / R2-M2: what the resolving staff person accepted about this exception's bank debit — an over-amount
     * (differenceMinor > 0, acceptDifference) and/or a late value date (lateValueDate, acceptLateDate). An
     * over-amount above ACCEPTED_OVERAGE_BPS carries secondApproval, approved by a DIFFERENT staff person
     * (approve_acceptance) before the case may close.
     */
    acceptedDifference?: {
      statementLineId: string; differenceMinor: number; currency: CurrencyCode;
      lateValueDate?: string;
      secondApproval?: { required: true; approvedBy?: string; approvedAt?: string; note?: string };
    };
  };
}

/** Alias: the brief calls every exception a ReconciliationException; categories go wider. */
export type ExceptionRecord = ReconciliationException;

export interface InvestigationCase {
  id: string;
  intentId?: string;
  advanceId?: string;
  title: string;
  status: "open" | "resolved" | "reopened";
  ownerId?: string;
  notes: { at: string; actorId: string; text: string }[];
  requestedInfo: { id: string; at: string; actorId: string; from: string; request: string; status: "open" | "provided" }[];
  evidenceIds: string[];
  exceptionIds: string[];
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type HoldStatus = "open" | "documents_submitted" | "partner_release_reported" | "released" | "rejected";

export interface ComplianceHold {
  id: string;
  intentId: string;
  providerId: string;
  /** Always the partner: Clearline never initiates or decides compliance. */
  reportedBy: "partner";
  reason: string;
  requestedDocuments: string[];
  submittedDocuments: { name: string; evidenceId: string; at: string; by: string }[];
  reviewerId?: string;
  partnerReleaseReportedAt?: string;
  decisions: { at: string; reviewerId: string; decision: "release" | "reject" | "request_more"; reason: string }[];
  status: HoldStatus;
  /** Constant: holds are never released by a timer or a provider event alone. */
  autoRelease: false;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------------------------

export interface LiquidityPolicy {
  id: string;
  /** Explicit label: an illustrative provider-defined policy, not a regulatory classification. */
  label: string;
  definedBy: string;
  bufferBps: number;
  minBufferMinor: Record<string, number>;
  maxAgeMinutes: number;
}

export interface LiquiditySnapshot {
  id: string;
  providerId: string;
  accountRef: string;
  currency: CurrencyCode;
  /** Balance eligible to fund payouts per the provider statement. */
  eligibleMinor: number;
  restrictedMinor: number;
  safeguardedMinor: number;
  source: string;
  asOf: string;
}

export interface LiquidityRow extends LiquiditySnapshot {
  committedPayoutsMinor: number;
  providerName: string;
  bufferMinor: number;
  usableMinor: number;
  ageMinutes: number;
  stale: boolean;
  freshness: "fresh" | "stale";
  policyId: string;
  policyLabel: string;
  formula: string;
}

export interface LiquidityView {
  asOf: string;
  policy: LiquidityPolicy;
  rows: LiquidityRow[];
  /** Per currency, FRESH rows only. Never summed across currencies. */
  currentUsableByCurrency: Partial<Record<CurrencyCode, number>>;
  staleExcluded: string[];
}

// ---------------------------------------------------------------------------------------------
// Chain evidence (synthetic Base Sepolia)
// ---------------------------------------------------------------------------------------------

export interface AllowlistedToken {
  chainId: number;
  network: string;
  symbol: string;
  decimals: number;
  /** Synthetic contract identity for the sandbox. NOT an official issuer address. */
  contract: string;
  label: string;
}

export interface ChainObservationInput {
  intentId: string;
  chainId: number;
  network: string;
  tokenContract: string;
  tokenSymbol: string;
  txHash: string;
  toAddress: string;
  amountMinor: number;
  blockNumber: number;
  confirmations: number;
}

export interface ChainObservation extends ChainObservationInput {
  id: string;
  observedAt: string;
  updatedAt: string;
  finalityThreshold: number;
  status: "observed" | "pending_finality" | "final" | "rejected_unsupported";
  /** Review m-3: set on a REJECTED observation when a person resolves the hash-conflict exception it caused (that exception's id). It stays on record but no longer blocks the same hash. */
  supersededBy?: string;
  label: "Synthetic Base Sepolia testnet observation";
}

// ---------------------------------------------------------------------------------------------
// Funding Desk projection
// ---------------------------------------------------------------------------------------------

export type AdvanceState = "proposed" | "approved" | "declined" | "supplier_paid" | "partly_repaid" | "repaid" | "overdue";

export interface FundingAdvance {
  id: string;
  orgId: string;
  /** Supplier payout funded by this advance (the shared payment identity). */
  intentId: string;
  customerRef: string;
  customerName: string;
  supplierName: string;
  invoiceRef: string;
  principalMinor: number;
  currency: CurrencyCode;
  preparedBy: string;
  preparedAt: string;
  dueDate: string;
  repaymentReference: string;
  state: AdvanceState;
  decisionId?: string;
  obligationId?: string;
}

export interface FundingDecision {
  id: string;
  advanceId: string;
  makerId: string;
  checkerId: string;
  outcome: "approve" | "decline";
  reason: string;
  at: string;
}

export interface RepaymentObligation {
  id: string;
  advanceId: string;
  principalMinor: number;
  currency: CurrencyCode;
  dueDate: string;
  /** The reliable repayment reference the customer was told to quote. */
  reference: string;
  createdAt: string;
}

export interface RepaymentAllocation {
  id: string;
  obligationId: string;
  statementLineId: string;
  amountMinor: number;
  currency: CurrencyCode;
  matchedBy: "trusted_reference";
  evidenceId: string;
  at: string;
}

export interface FundingProjectionRow {
  advanceId: string;
  intentId: string;
  supplierPayout: {
    execution: ExecutionState;
    settlement: SettlementEvidenceState;
    providerPaymentId?: string;
    /** Final check C1: true while the payout is on a partner hold (supplierPaidBasis is then "none"). */
    onHold: boolean;
    /** Final check C1: the undecided partner hold on this payout, if any. */
    hold?: { id: string; status: HoldStatus };
  };
  customerName: string;
  supplierName: string;
  invoiceRef: string;
  principal: Money;
  treasuryApproval?: { makerId: string; checkerId: string; outcome: string; at: string };
  obligation?: { id: string; reference: string; dueDate: string };
  allocations: RepaymentAllocation[];
  repaid: Money;
  outstanding: Money;
  overdue: boolean;
  state: AdvanceState;
  /**
   * CHANGE 5 (m5): what "supplier paid" rests on. `provider_reported` = only the provider's completion
   * claim; `verified_settlement` = settlement evidence is verified (bank statement or final chain
   * transfer) AND the payout is not failed, cancelled, expired or returned; `none` = neither (always
   * `none` for a failed, cancelled, expired or returned payout, whatever the settlement field says —
   * review v2 M2 — and for an on_hold payout, final check C1). The state name `supplier_paid` is kept for compatibility.
   */
  supplierPaidBasis: "none" | "provider_reported" | "verified_settlement";
  /** Corresponding stage name in the existing Funding Desk (src/lib/mentor-demo). */
  fundingDeskStage: string;
  exceptionIds: string[];
  evidenceIds: string[];
}

export interface FundingProjection {
  label: string;
  asOf: string;
  rows: FundingProjectionRow[];
  /** Totals per currency; never across currencies. */
  outstandingByCurrency: Partial<Record<CurrencyCode, number>>;
}

// ---------------------------------------------------------------------------------------------
// Audit and workspace
// ---------------------------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

export interface Workspace {
  schemaVersion: 1;
  mode: "sandbox";
  label: string;
  /** Simulated clock: the latest action instant applied. */
  asOf: string;
  seq: number;
  organization: Organization;
  actors: Actor[];
  routes: ProviderRoute[];
  intents: PaymentIntent[];
  quotes: Quote[];
  instructions: PaymentInstruction[];
  providerEvents: ProviderEvent[];
  evidence: EvidenceRecord[];
  statementLines: StatementLine[];
  allocations: ReconciliationAllocation[];
  exceptions: ReconciliationException[];
  cases: InvestigationCase[];
  holds: ComplianceHold[];
  liquidityPolicy: LiquidityPolicy;
  liquidity: LiquiditySnapshot[];
  chainObservations: ChainObservation[];
  advances: FundingAdvance[];
  fundingDecisions: FundingDecision[];
  obligations: RepaymentObligation[];
  repaymentAllocations: RepaymentAllocation[];
  idempotency: Record<string, { intentId: string; fingerprint: string }>;
  audit: AuditEvent[];
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

export type FailureInjection = "none" | "timeout" | "duplicate" | "out_of_order" | "contradictory" | "bad_signature";

export type WorkspaceAction =
  | { type: "create_intent"; input: CreateIntentInput }
  | { type: "request_quotes"; intentId: string }
  | { type: "choose_route"; intentId: string; quoteId: string }
  | { type: "approve_instruction"; instructionId: string }
  | { type: "reject_instruction"; instructionId: string; reason: string }
  | { type: "submit_instruction"; instructionId: string }
  | { type: "cancel_intent"; intentId: string; reason: string }
  | { type: "simulate_provider_event"; intentId: string; injection?: FailureInjection }
  | { type: "ingest_webhook"; delivery: WebhookDelivery }
  | { type: "ingest_statement_line"; line: StatementLineInput }
  | { type: "ingest_chain_observation"; observation: ChainObservationInput }
  | { type: "advance_clock"; to: string }
  | { type: "assign_owner"; target: TargetRef; ownerId: string }
  | { type: "add_note"; target: TargetRef; text: string }
  | { type: "request_info"; caseId: string; from: string; request: string }
  | { type: "attach_evidence"; target: TargetRef; evidence: AttachEvidenceInput }
  /** acceptDifference (re-review R-M2): only for an RC_OVERPAYMENT exception whose bank debit names the payout, in its currency and window, at most ACCEPTED_OVERAGE_BPS over; records the accepted difference so the payout's case may close. */
  | { type: "resolve"; target: TargetRef; note: string; acceptDifference?: boolean; acceptLateDate?: boolean }
  /** R2-M2: a second, different staff person approves an accepted over-amount above ACCEPTED_OVERAGE_BPS. */
  | { type: "approve_acceptance"; exceptionId: string; note: string }
  | { type: "reopen"; target: TargetRef; reason: string }
  | { type: "submit_hold_documents"; holdId: string; documents: string[] }
  | { type: "assign_hold_reviewer"; holdId: string; reviewerId: string }
  | { type: "record_hold_decision"; holdId: string; decision: "release" | "reject" | "request_more"; reason: string }
  | { type: "create_advance"; input: CreateAdvanceInput }
  | { type: "decide_advance"; advanceId: string; outcome: "approve" | "decline"; reason: string };

export type TargetRef = { kind: "case"; id: string } | { kind: "exception"; id: string };

export interface AttachEvidenceInput {
  kind: EvidenceKind;
  description: string;
  documentName?: string;
  reference?: string;
  sha256?: string;
}

export interface CreateAdvanceInput {
  intentId: string;
  customerRef: string;
  customerName: string;
  supplierName: string;
  invoiceRef: string;
  dueDate: string;
  repaymentReference: string;
}

export interface ActionOutput {
  workspace: Workspace;
  /** Audit events appended by this action (also present in workspace.audit). */
  audit: AuditEvent[];
  /** Short machine-readable outcome, e.g. "applied", "idempotent_replay", "rejected_signature". */
  outcome: string;
  /** Ids of primary entities created by the action. */
  createdIds: string[];
}

export type ActionResult = Result<ActionOutput>;

// ---------------------------------------------------------------------------------------------
// Investigation view model
// ---------------------------------------------------------------------------------------------

export interface Finding {
  code: string;
  text: string;
  refs: string[];
}

export interface InvestigationView {
  intentId: string;
  /** Latest provider-side event (any outcome, excluding Clearline timers). */
  lastEventAt?: string;
  lastEventType?: NormalizedEventType;
  /** Latest independent evidence (bank statement line or synthetic chain observation). */
  lastIndependentVerificationAt?: string;
  /** Alias of lastIndependentVerificationAt. */
  lastVerifiedAt?: string;
  status: StatusDimensions;
  requested: {
    internalReference: string;
    amount: Money;
    destinationCurrency: CurrencyCode;
    beneficiaryName: string;
    destinationCountry: string;
    requestedExecutionDate: string;
    purpose: string;
  };
  provider?: { providerId: string; providerName: string; routeId: string; rail: RailKind; providerPaymentId?: string };
  approval?: { makerId: string; checkerId?: string; status: InstructionStatus };
  providerReported: { events: ProviderEvent[]; lastReported?: NormalizedEventType; findings: Finding[] };
  independentEvidence: Finding[];
  unknowns: Finding[];
  contradictions: Finding[];
  outstanding: { code: string; text: string; amount?: Money }[];
  whoActs: { ownerId?: string; ownerName?: string; role: string; code: string };
  nextActions: Finding[];
  exceptions: ReconciliationException[];
  hold?: ComplianceHold;
  chain?: ChainObservation;
  funding?: FundingProjectionRow;
  caseId?: string;
  explanationCodes: string[];
  /**
   * CHANGE 5 (F2) + review v2 (M3): amount differences that are still OUTSTANDING for this payout.
   * A bank partial (RC_PARTIAL_AMOUNT) is outstanding while the payout's bank-statement allocations are
   * below the payout amount and the payout is not failed/cancelled/expired/returned. A provider
   * under-amount report (RC_UNDER_AMOUNT_REPORT) is outstanding while its exception is not resolved.
   * Every entry has `outstanding: true`. Only these belong under "Financially outstanding".
   */
  amountDifferences: InvestigationAmountDifference[];
  /** Review v2 (M3): history — differences recorded for this payout that no longer apply (gap closed or exception resolved). Every entry has `outstanding: false`. */
  resolvedAmountDifferences: InvestigationAmountDifference[];
  /** rc3 (R-1): present for a returned payout (or one with a provider-reported return): net movement vs beneficiary unpaid. */
  returnPosition?: ReturnPosition;
  disclaimer: string;
}

/**
 * rc3 (R-1): the two separate facts about a returned payout. "Net financial movement is zero" (the
 * outgoing debit and the return credit are both on the statement and equal) is NOT "the beneficiary
 * was paid": a returned payout's beneficiary is always unpaid (`beneficiaryPaid: false`).
 */
export interface ReturnPosition {
  returnStatus: "provider_reported" | "confirmed_by_statement";
  /** Outgoing debit(s) on the bank statement allocated to this payout. */
  debited: Money;
  /** Return / reversal credit(s) on the statement allocated to this payout (RC_RETURN_CONFIRMS_PROVIDER_RETURN). */
  returnCredited: Money;
  /** debited − returnCredited, present only when both legs are on the statement. */
  netMovement?: Money;
  /** True only when both legs are on the statement and equal. */
  netMovementZero: boolean;
  /** Always false: money that came back did not pay the beneficiary. */
  beneficiaryPaid: false;
  code: "RT_NET_ZERO" | "RT_NET_NOT_ZERO" | "RT_RETURN_NOT_ON_STATEMENT" | "RT_DEBIT_NOT_ON_STATEMENT";
  text: string;
}

/**
 * Re-review R-m1: one change the load-time migration made to a workspace saved by an earlier engine version
 * (see loadWorkspace). `text` is plain English the console can show ("Your saved workspace was updated: …").
 */
export interface WorkspaceMigration {
  /**
   * terminal_payout_verified / terminal_payout_evidence: a failed, cancelled, expired or returned payout still showing evidence
   * (verified, resp. observed / pending finality); chain_observation_not_allowlisted: a counted transfer not on the allowlist;
   * chain_hash_conflict: a counted transfer whose hash was recorded earlier with another identity; reorg_reconciliation:
   * matched on a chain transfer that is no longer final; status_exceeds_evidence: a stored settlement or reconciliation
   * above what the recorded evidence supports, capped (QA rc3 L1). See migrate.ts.
   */
  kind: "terminal_payout_verified" | "terminal_payout_evidence" | "chain_observation_not_allowlisted" | "chain_hash_conflict" | "reorg_reconciliation" | "status_exceeds_evidence";
  intentId: string;
  internalReference: string;
  from: StatusDimensions;
  to: StatusDimensions;
  /** contradiction_raised: the rc3 rule's exception was created; contradicted_open: an open exception already covers it; resolved_by_person: a person had resolved the rule's exception. */
  outcome: "contradiction_raised" | "contradicted_open" | "resolved_by_person" | "observation_not_counted" | "reconciliation_reopened" | "status_capped";
  /** The chain observation concerned (chain kinds). */
  observationId?: string;
  /** The exception created (contradiction_raised), still open (contradicted_open) or already resolved (resolved_by_person). */
  exceptionId?: string;
  exceptionCode?: string;
  ownerId?: string;
  caseId?: string;
  /** The `workspace.migrated` audit event recording this change. */
  auditId: string;
  text: string;
}

/** Re-review R-m1: result of loadWorkspace / loadWorkspaceValue. */
export interface WorkspaceLoad {
  workspace: Workspace;
  /** Empty for a workspace written by this engine version. */
  migrations: WorkspaceMigration[];
}

export interface CaseReport {
  json: Record<string, unknown>;
  text: string;
}

// ---------------------------------------------------------------------------------------------
// Unified evidence timeline (read model)
// ---------------------------------------------------------------------------------------------

export type EvidenceTimelineKind =
  | "intent_created"
  | "quote"
  | "instruction_made"
  | "instruction_checked"
  | "provider_event"
  | "statement_line"
  | "allocation"
  | "chain_observation"
  | "evidence"
  | "hold_decision"
  | "exception"
  | "missing_evidence";

export interface EvidenceTimelineEntry {
  id: string;
  /** ISO instant; missing-evidence items use the workspace clock. */
  at: string;
  kind: EvidenceTimelineKind;
  title: string;
  source: string;
  provenance: string;
  /** True only for bank statement lines and (synthetic) chain observations. */
  independent: boolean;
  codes: string[];
  refs: string[];
  /** CHANGE 5 (F2): present on statement-line and exception entries that carry an amount difference. */
  amountDifference?: AmountDifference;
}
