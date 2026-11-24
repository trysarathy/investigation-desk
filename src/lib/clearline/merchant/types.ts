/**
 * rc6 merchant reconciliation — domain types. Pure data: no I/O, no clock, no keys, nothing moves money.
 * Amounts are BigInt (fiat in integer minor units; tokens in base units with their decimals).
 * Rates are exact decimal strings. Senders, hops and exchange wallets are facts, never judgements.
 */
export const TEST_MODE_LABEL = "Test mode · illustrative data" as const;
export type TestModeLabel = typeof TEST_MODE_LABEL;
export const IMPORTED_BANK_LINE_LABEL = "imported, not bank-authenticated" as const;

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

export interface Invoice { orderId: string; entityId: string; amountMinor: bigint; currency: FiatCurrency; status: "open" | "closed" | "void" }

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
}

export interface FxRate { pair: string; rate: string; source: string; timestamp: string }

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
  bankLines: readonly BankLine[];
  fxRates: readonly FxRate[];
  addressFacts: readonly AddressFact[];
  /** rc7: chain reads that failed for this run (optional; absent = every read succeeded or recorded data is used). */
  chainUnavailable?: readonly ChainUnavailable[];
}

// ---------- outputs ----------

export type Decision = "matched" | "matched_with_difference" | "suggested_for_review" | "exception";
export type Step = 1 | 2 | 3 | 4 | 5;

export type DifferenceType =
  | "sender_side_fee" | "underpayment" | "overpayment" | "requote_after_expiry" | "rate_difference" | "provider_fee"
  | "refund_netted" | "timing_prior_batch" | "timing_next_batch" | "held_by_provider" | "partial_payment_open" | "unexplained";

export interface Difference { id: string; type: DifferenceType; amountMinor: bigint; currency: FiatCurrency; reason: string; ruleId: string }

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
}

export interface LedgerPart {
  invoice: Invoice;
  creditedMinor: bigint;
  openBalanceMinor: bigint;
  customerOverpaymentMinor: bigint;
  balanceState: "nothing_received" | "part_paid" | "short_paid" | "fully_credited" | "over_credited";
  balanceLabel: string;
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
