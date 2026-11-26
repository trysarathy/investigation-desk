/**
 * rc6 merchant reconciliation — domain types. Pure data: no I/O, no clock, no keys, nothing moves money.
 * Amounts are BigInt (fiat in integer minor units; tokens in base units with their decimals).
 * Rates are exact decimal strings. Senders, hops and exchange wallets are facts, never judgements.
 */
export const TEST_MODE_LABEL = "Test mode · illustrative data" as const;
export type TestModeLabel = typeof TEST_MODE_LABEL;
export const IMPORTED_BANK_LINE_LABEL = "imported, not bank-authenticated" as const;

/**
 * v1 Phase 0.5 (founder decisions 12–16): bank evidence is shown apart from the match. A payment is MATCHED when chain,
 * provider record and invoice agree by reference (exact after typed items, final chain, verified contract); how well
 * the bank side is evidenced is this separate level:
 *  - `none`: no bank line ties to it (no batch, an untied batch, a proposed grouping, a seeded or unconfirmed line);
 *  - `imported_two_person_confirmed`: an imported statement line, confirmed by a second person, in a batch that ties;
 *  - `bank_authenticated`: RESERVED. Nothing in Clearline produces it yet (no bank connection exists); a test checks this.
 * A batch is "settled" only when its evidence is at least `imported_two_person_confirmed` AND it ties to the cent.
 */
export type BankEvidenceLevel = "none" | "imported_two_person_confirmed" | "bank_authenticated";
export const BANK_EVIDENCE_RANK: Readonly<Record<BankEvidenceLevel, number>> = { none: 0, imported_two_person_confirmed: 1, bank_authenticated: 2 };
export const BANK_EVIDENCE_LABEL: Readonly<Record<BankEvidenceLevel, string>> = {
  none: "Bank evidence: none",
  imported_two_person_confirmed: "Bank evidence: imported statement, confirmed by a second person (not bank-authenticated)",
  bank_authenticated: "Bank evidence: bank-authenticated",
};
/** Short form for chips and table cells (the long form is BANK_EVIDENCE_LABEL). */
export const BANK_EVIDENCE_SHORT: Readonly<Record<BankEvidenceLevel, string>> = {
  none: "Bank evidence: none",
  imported_two_person_confirmed: "Bank evidence: imported, second-person confirmed",
  bank_authenticated: "Bank evidence: bank-authenticated",
};
/** The lower of two levels (a payment in several batches is only as evidenced as its weakest). */
export const minEvidence = (a: BankEvidenceLevel, b: BankEvidenceLevel): BankEvidenceLevel => (BANK_EVIDENCE_RANK[a] <= BANK_EVIDENCE_RANK[b] ? a : b);

export type NetworkId = "tron" | "ethereum" | "polygon" | "solana" | "arbitrum_one" | "ton" | "base";
export type FiatCurrency = "SGD" | "USD" | "AED";

export interface NetworkConfig {
  network: NetworkId;
  name: string;
  chainId?: number;
  /** Finality rule: a transfer counts only with at least this many confirmations. */
  confirmationsRequired: number;
  enabled: boolean;
}

/** A token is identified by (network, contract) — never by symbol. */
export interface TokenConfig { network: NetworkId; contract: string; symbol: string; decimals: number }
export interface TokenRef { network: NetworkId; contract: string }

/** Fixed UTC offset [ASSUMPTION: SGT, GST and UTC have no daylight saving]. */
export interface TimeZoneRef { name: string; utcOffsetMinutes: number }

export interface MerchantEntity { id: string; name: string; functionalCurrency: FiatCurrency; ledger: string; timeZone: TimeZoneRef }

export interface MerchantPolicy {
  /** Tolerance as basis points of the invoice (50 = 0.5%). */
  tolerancePct: number;
  /** Fixed amount in the entity currency, combined with the percentage by `toleranceCombine`. */
  toleranceAbsMinor: bigint;
  /** "larger": band = max(pct × invoice, fixed) — the founder's decision for rc7. "smaller": band = min(…). */
  toleranceCombine: "smaller" | "larger";
  /** Largest difference the engine may propose to write off; above it the order goes to review. */
  writeoffThresholdMinor: bigint;
  approverRoles: readonly string[];
  /** A csv_import bank line can make settlement verified only when this is true. Default false. */
  allowImportedBankLinesAsVerified: boolean;
  /** Network-fee bound for a sender-side fee, in token base units (6 decimals) [ASSUMPTION]. */
  senderFeeBoundBaseUnits: bigint;
}

export interface Invoice {
  orderId: string; entityId: string; amountMinor: bigint; currency: FiatCurrency; status: "open" | "closed" | "void";
  /**
   * v1 (Phase 0, approval-only): an invoice priced directly in a token, e.g. 1,250.00 USDT = 1250000000 base units on a
   * configured (network, contract). Then `amountMinor` is not a price: it is 0n and never decides anything, and
   * `currency` is the currency the invoice is accounted in (the entity's). The fiat value comes only from a recorded
   * rate (ReconcileInput.fxRates); without one the record says the value needs a rate. Nothing is derived or assumed.
   */
  price?: InvoiceTokenPrice;
}
export interface InvoiceTokenPrice { token: TokenRef; baseUnits: bigint }

export interface Quote {
  quoteId: string;
  orderId: string;
  token: TokenRef;
  network: NetworkId;
  quotedBaseUnits: bigint;
  rate: string;
  rateSource: string;
  rateAt: string;
  createdAt: string;
  expiresAt: string;
  depositAddress: string;
  /**
   * rc7: quote terms the source file did not carry (a provider export often lists payments, not quotes). Their fields
   * then hold placeholders that are never used: an order whose quote has unknown terms is never closed (abstains,
   * M3.quote.terms_unknown). Nothing is derived to fill them: no rate is ever invented.
   */
  unknown?: readonly QuoteTerm[];
}
export type QuoteTerm = "rate" | "quoted_amount" | "window";

export interface PaymentLink {
  linkId: string;
  orderId: string;
  quoteId: string;
  kind: "full" | "balance";
  token: TokenRef;
  depositAddress: string;
  requestedBaseUnits: bigint;
  /** The link's own validity window (a balance link is issued later than the quote). */
  createdAt: string;
  expiresAt: string;
  /** rc7: the source gave no window for this link (placeholder values; never used to decide). */
  windowUnknown?: true;
  /** rc8: the source gave no requested amount for this link (placeholder 0; never used to decide). */
  requestedUnknown?: true;
}

export interface TransferRef { network: NetworkId; txHash: string; logIndex: number }

export interface ChainTransfer extends TransferRef {
  tokenContract: string;
  /** Symbol shown by an explorer: informative only, never used to identify the token. */
  claimedSymbol?: string;
  from: string;
  to: string;
  amountBaseUnits: bigint;
  decimals: number;
  block: number;
  timestamp: string;
  confirmations: number;
  /** Earlier hops traced before this transfer: recorded as facts only. */
  priorHops?: readonly { from: string; to: string; txHash: string }[];
  /**
   * rc8: where the fact came from. 'chain_client' = read from the chain by Clearline's own client (rc7 verify).
   * Absent for fixtures built in memory. Only a chain_client fact can close an order whose quote terms are unknown.
   */
  source?: "chain_client" | "recorded_fixture" | "seed_fictional";
}

export type ProviderStatusClaim = "paid" | "underpaid" | "overpaid" | "held_for_review" | "re_quoted" | "partially_paid" | "pending";

export interface ProviderPaymentRecord {
  providerPaymentId: string;
  ref: { quoteId?: string; linkId?: string };
  transferRef?: TransferRef;
  /** A claim, not proof. */
  statusClaim: ProviderStatusClaim;
  /** What the provider's dashboard shows (e.g. "completed"): also only a claim. */
  displayedStatus?: string;
  receivedBaseUnits: bigint;
  creditedMinor: bigint;
  /** rc8: the currency the provider says it credited in, when its file gives it. Never assumed. */
  creditedCurrency?: FiatCurrency;
  executedRate: string;
  feeMinor?: bigint;
  batchId?: string;
  /**
   * rc7: the provider file named the transaction but not the transfer's log index. The engine resolves it from chain
   * facts (same network and hash, the record's token, to the address issued for the record's quote or link): exactly
   * one transfer → that one; several → the order abstains (M3.provider.transfer_ambiguous). Never assumed to be 0.
   */
  logIndexUnknown?: true;
}

export interface SettlementBatch {
  batchId: string;
  providerDay: string;
  providerTimeZone: TimeZoneRef;
  currency: FiatCurrency;
  targetBankAccount: string;
  grossMinor: bigint;
  feesMinor: bigint;
  refundsMinor: bigint;
  netMinor: bigint;
}

/**
 * v1 (Phase 0, approval-only): one row of a per-payment settlement file: the provider says this payment was settled in
 * this batch, with its own gross, fee and net. Linked to the payment by the provider's payment ID (a reference), never by
 * amount. A batch ties from these lines only when they sum exactly to the batch's totals and the batch's net to its bank
 * credit (bridge.ts); a line naming a batch that is not in the settlement report links nothing.
 */
export interface SettlementPaymentLine {
  batchId: string;
  /** A payment row: the payment settled in this batch. A refund row: the ORIGINAL payment the refund returns money for. */
  providerPaymentId: string;
  /**
   * v1 #174: "payment" (absent = payment, as before) or "refund". A refund row is linked to its original payment by
   * the provider's payment ID only; it never links that payment to a batch and never closes a payment by its amount.
   * Sign convention: a refund row's grossMinor and netMinor are NEGATIVE (the money returned), its feeMinor 0, so
   * gross − fee = net holds for every row and a batch's rows sum to its net.
   */
  kind?: "payment" | "refund";
  /** A refund row's own ID (required for a refund row; unique). */
  refundId?: string;
  orderId?: string;
  currency: FiatCurrency;
  grossMinor: bigint;
  feeMinor: bigint;
  netMinor: bigint;
  settlementDate?: string;
}

export interface SettlementBatchLine {
  batchId: string;
  kind: "payment" | "refund";
  providerPaymentId?: string;
  refundId?: string;
  orderId: string;
  amountMinor: bigint;
}

export interface BankLine {
  bankLineId: string;
  account: string;
  currency: FiatCurrency;
  valueDate: string;
  amountMinor: bigint;
  description: string;
  source: "bank_feed" | "csv_import";
  provenance: string;
  /**
   * v1 Phase 0.5: the imported statement this line came from was confirmed by a second person (an Approver who did not
   * upload it; the upload pipeline enforces this for bank statements). Set by the loader from the stored confirmation,
   * never from a file column. Absent = not known to be confirmed. It never makes a line bank-authenticated.
   */
  secondPersonConfirmed?: true;
}

export interface FxRate { pair: string; rate: string; source: string; timestamp: string }

/**
 * v1 (founder decision 9): a recorded rate between two fiat currencies, "USD/SGD" = SGD per 1 USD, as of an instant,
 * from a named source (table fiat_rates, append-only). Used only to SHOW an other-currency amount in the entity's
 * currency and to propose period-end revaluations; never to make amounts tie.
 */
export interface FiatRate { pair: string; rate: string; asOf: string; source: string }

/** An amount's value in another currency from a recorded rate, or "needs a rate" (never 0, never derived). */
export type FxValue =
  | { status: "rated"; amountMinor: bigint; currency: FiatCurrency; pair: string; rate: string; asOf: string; source: string }
  | { status: "needs_rate"; currency: FiatCurrency; pair: string; reason: string };

/** A fact about an address. Recorded, never judged. */
export interface AddressFact { network: NetworkId; address: string; fact: "registered_wallet" | "intermediate_wallet" | "exchange_hot_wallet" | "unknown" }

/**
 * rc7: a chain read that could not be done (API down, rate-limited, keys missing, re-check incomplete). Scoped to a
 * deposit address or a transaction. Never zero, never "not received": the order waits and is never matched.
 */
export interface ChainUnavailable { network: NetworkId; address?: string; txHash?: string; source: string; reason: string; at: string }

export interface ReconcileInput {
  label: TestModeLabel;
  entity: MerchantEntity;
  policy: MerchantPolicy;
  networks: readonly NetworkConfig[];
  tokens: readonly TokenConfig[];
  invoices: readonly Invoice[];
  quotes: readonly Quote[];
  paymentLinks: readonly PaymentLink[];
  transfers: readonly ChainTransfer[];
  providerRecords: readonly ProviderPaymentRecord[];
  batches: readonly SettlementBatch[];
  batchLines: readonly SettlementBatchLine[];
  /** v1: per-payment settlement lines (optional; absent = none uploaded, the engine behaves exactly as before). */
  settlementPaymentLines?: readonly SettlementPaymentLine[];
  bankLines: readonly BankLine[];
  fxRates: readonly FxRate[];
  /** v1: recorded fiat rates into the entity's currency (optional; absent = none recorded, nothing is converted). */
  fiatRates?: readonly FiatRate[];
  addressFacts: readonly AddressFact[];
  /** rc7: chain reads that failed for this run (optional; absent = every read succeeded or recorded data is used). */
  chainUnavailable?: readonly ChainUnavailable[];
}

// ---------- outputs ----------

export type Decision = "matched" | "matched_with_difference" | "suggested_for_review" | "exception";
export type Step = 1 | 2 | 3 | 4 | 5;

export type DifferenceType =
  | "sender_side_fee" | "underpayment" | "overpayment" | "requote_after_expiry" | "rate_difference" | "provider_fee"
  | "refund_netted" | "timing_prior_batch" | "timing_next_batch" | "held_by_provider" | "partial_payment_open" | "unexplained"
  // v1: a token-priced invoice paid in another token (or on another network), or with a different token amount
  | "price_token_mismatch" | "price_token_amount";

export interface Difference {
  id: string; type: DifferenceType; amountMinor: bigint; currency: FiatCurrency; reason: string; ruleId: string;
  /**
   * v1, token-priced invoices: the difference in the token itself (signed base units: received − price, or the amount
   * received in the wrong token). `amountMinor` is then its fiat value at a recorded rate, or 0n when no rate is recorded (not a value: every surface
   * shows "needs a rate" for it, see fiat-value.ts).
   */
  token?: { network: NetworkId; contract: string; symbol: string; decimals: number; baseUnits: bigint };
}

export interface HistoryEntry { step: Step; ruleId: string; outcome: "pass" | "fail" | "note"; detail: string }

export interface Explanation { decision: Decision; decidingStep: Step; ruleId: string; differences: Difference[]; history: HistoryEntry[] }

export type Owner = "Payment Operations" | "Treasury" | "Finance Controller";
export interface Attention { owner: Owner; reason: string; nextStep: string }

export interface ExceptionItem extends Attention { id: string; step: Step; ruleId: string; orderId?: string; transfer?: TransferRef }

export interface WriteOffProposal {
  id: string;
  orderId: string;
  amountMinor: bigint;
  direction: "shortfall" | "excess";
  currency: FiatCurrency;
  differenceIds: string[];
  status: "proposed";
  preparedBy: "engine";
  /** Approval happens outside the engine (rc5 two-person flow). The preparer never approves. */
  approverRoles: readonly string[];
}

/** A transfer as shown on a match record. Sender and path facts are recorded, never judged, and never decide a match. */
export interface ChainTransferView extends ChainTransfer {
  symbol: string;
  senderFacts: AddressFact["fact"][];
  pathFacts: { address: string; facts: AddressFact["fact"][] }[];
  linkId?: string;
  quoteId?: string;
}

export interface BankPart {
  status: "not_in_batch" | "in_batch" | "held_by_provider" | "proposed_grouping";
  batchIds: string[];
  bankLineIds: string[];
  batchTied: boolean;
  settlementVerified: boolean;
  bankLineLabels: string[];
  /** v1 Phase 0.5: the bank evidence level (shown separately from the decision; never decides a match). */
  evidence: BankEvidenceLevel;
  /** Every batch of the payment is settled: it ties to the cent and its evidence is at least imported_two_person_confirmed. */
  settled: boolean;
}

export interface LedgerPart {
  invoice: Invoice;
  creditedMinor: bigint;
  openBalanceMinor: bigint;
  customerOverpaymentMinor: bigint;
  balanceState: "nothing_received" | "part_paid" | "short_paid" | "fully_credited" | "over_credited";
  balanceLabel: string;
  /**
   * v1, token-priced invoices only: the fiat accounting value. "rated" = price × a recorded rate (pair, source and time
   * given); "needs_rate" = no usable recorded rate, so the fiat value is unknown (never invented) and must be recorded.
   */
  fiatValue?: { status: "rated"; amountMinor: bigint; pair: string; rate: string; source: string; at: string } | { status: "needs_rate"; pair: string; reason: string };
}

export interface MatchRecord {
  label: TestModeLabel;
  orderId: string;
  chain: { transfers: ChainTransferView[]; pending: TransferRef[] };
  provider: { records: ProviderPaymentRecord[]; note: "provider statuses are claims, not proof" };
  bank: BankPart;
  ledger: LedgerPart;
  explanation: Explanation;
  attention?: Attention;
}

export interface TransferFinding { transfer: TransferRef; step: Step; ruleId: string; kind: "pending" | "exception"; detail: string; orderId?: string }
