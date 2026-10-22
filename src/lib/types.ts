// Shared types for the investigation engine. Codes match the spec catalogue (section 2).

export type DepositChain = "tron" | "ethereum" | "bsc";
export type CrossCheckChain = "polygon" | "base" | "arbitrum" | "optimism";
export type Chain = DepositChain | CrossCheckChain;
export type EvmChain = Exclude<Chain, "tron">;
export type Token = "USDT" | "USDC";

export const DEPOSIT_CHAINS: DepositChain[] = ["tron", "ethereum", "bsc"];
export const CROSS_CHECK_CHAINS: CrossCheckChain[] = ["polygon", "base", "arbitrum", "optimism"];
export const ALL_CHAINS: Chain[] = [...DEPOSIT_CHAINS, ...CROSS_CHECK_CHAINS];

export const EVM_CHAIN_IDS: Record<EvmChain, number> = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
};

export const CHAIN_NAMES: Record<Chain, string> = {
  tron: "Tron",
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  polygon: "Polygon",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
};

export type Code =
  | "D01" | "D02" | "D03" | "D04" | "D05" | "D06" | "D07" | "D07b"
  | "D08" | "D09" | "D10" | "D11" | "D12" | "D13" | "D14" | "D16" | "D17" | "D18" | "D99";

export type Confidence = "High" | "Medium";

// ---- Inputs ----

export type InputKind = "hash" | "tron_address" | "evm_address" | "customer_ref" | "unrecognised";

export interface NormalisedInput {
  raw: string;
  kind: InputKind;
  /** Canonical form: hashes lower-case without 0x, EVM addresses lower-case. */
  value: string;
}

// ---- Facts fetched from chains (raw bodies kept for the audit record) ----

export interface ChainLookup {
  chain: Chain;
  /** "pending": the node knows the tx but it is not mined. Treated as unconfirmed (D01) while D10 is disabled. */
  result: "found" | "not_found" | "pending" | "error";
  fetchedAt: string;
  sourceUrl: string;
  rawBody: string;
  error?: string;
}

export interface TokenTransfer {
  logIndex: number;
  tokenContract: string;
  tokenSymbol: string;
  from: string;
  to: string;
  /** Decimal string in token units, never a float. */
  amount: string;
}

export interface ChainTx {
  chain: Chain;
  hash: string;
  status: "success" | "failed";
  errorCode?: string;
  feeBurned?: string;
  feeToken?: string;
  blockNumber: number;
  blockTime: string;
  /** True when the tx is a contract call carrying several Transfer events (exchange batch payout). */
  isBatch: boolean;
  transfers: TokenTransfer[];
}

export interface MempoolTx {
  chain: Chain;
  hash: string;
  firstSeenAt: string;
  gasPriceGwei: string;
}

export interface FreezeCheck {
  chain: Chain;
  token: Token;
  address: string;
  role: "sender" | "deposit";
  method: "isBlackListed" | "isBlacklisted";
  frozen: boolean;
  blockNumber: number;
}

export interface PriorTransfer {
  chain: Chain;
  hash: string;
  from: string;
  to: string;
  tokenSymbol: string;
  amount: string;
  time: string;
}

// ---- Company data (Files A and B) ----

export interface DepositAddressRow {
  row: number;
  address: string;
  chain: DepositChain;
  customerId: string;
  assignedAt: string;
  retiredAt?: string;
}

export type LedgerStatus = "CREDITED" | "PENDING" | "HELD" | "REVIEW" | "REJECTED";

export interface LedgerRow {
  row: number;
  depositId: string;
  txHash?: string;
  chain: DepositChain;
  token: Token;
  toAddress: string;
  amount: string;
  status: LedgerStatus;
  creditedAt?: string;
  customerId: string;
  /** Optional File B column: EVM log index or Tron event index of the transfer this row credits. */
  transferIndex?: number;
  /** Company's reason code for a REJECTED row, if the ledger carries one. Internal only. */
  reasonCode?: string;
  /** Free text from the company's system. Treated as data, never as instructions. */
  note?: string;
}

/**
 * How a ledger row was joined to the on-chain transfer (spec rule precedence 5).
 *  exact          chain + tx_hash + transfer index + token contract all match, or the index is
 *                 absent and the tx holds only one transfer to a company address
 *  ambiguous      tx_hash and contract match, no transfer index, and the tx holds several
 *                 transfers to company addresses
 *  address_amount no tx_hash; same chain, address and amount only
 * Only "exact" may decide a High ledger verdict.
 */
export type LedgerMatchQuality = "exact" | "ambiguous" | "address_amount";

export interface LedgerMatch {
  row: LedgerRow;
  quality: LedgerMatchQuality;
}

// ---- Provider payouts (data-model hedge, spec 22 Oct). No rules read these yet. ----

export type Workflow = "deposit" | "payout";

export interface ProviderEvent {
  provider: string;
  /** Provider's own reference for the payout. */
  reference: string;
  kind: "payout_created" | "status_update" | "returned";
  /** Status exactly as the provider reported it. */
  providerStatus: string;
  amount?: string;
  currency?: string;
  /** For a return: the provider's return or failure reason, verbatim. */
  returnReason?: string;
  at: string;
  fetchedAt: string;
  rawBody: string;
}

export interface Facts {
  /** Defaults to "deposit". Only deposit rules exist in v1. */
  workflow?: Workflow;
  input: NormalisedInput;
  customerId?: string;
  checkedAt: string;
  lookups: ChainLookup[];
  tx?: ChainTx;
  currentBlock?: number;
  mempool?: MempoolTx;
  freezes: FreezeCheck[];
  senderHistory: PriorTransfer[];
  depositAddresses: DepositAddressRow[];
  ledger: LedgerRow[];
  ledgerUploadedAt: string;
  providerEvents?: ProviderEvent[];
  /** Every raw API response behind these facts, in fetch order (spec 6.2). Empty for sample data. */
  rawResponses?: RawResponse[];
}

// ---- Company settings ----

export interface AcceptedToken {
  symbol: Token;
  contract: string;
}

export interface Settings {
  version: string;
  acceptedTokens: Record<DepositChain, AcceptedToken[]>;
  /** Genuine issuer contracts. Unset means "not confirmed yet", so D06 cannot run for that pair. */
  officialContracts: Partial<Record<Chain, Partial<Record<Token, string>>>>;
  confirmations: Record<DepositChain, number>;
  minimums: Record<DepositChain, Partial<Record<Token, string>>>;
  belowMinimumPolicy: string;
  keysHeldOnOtherChains: boolean;
  pendingWindowSec: Record<Chain, number>;
  blockTimeSec: Record<Chain, number>;
  ledgerStaleAfterHours: number;
  /** A prior transfer at or below this amount counts as dust for D07b. */
  dustThreshold: string;
  /** What ops does with a deposit to a retired address (D18 next step). */
  retiredAddressPolicy: string;
  /** Where a credited deposit appears in the company's app (D13 reply). */
  whereInApp: string;
  /**
   * D10 needs a reliable "pending since" time. Week 2 found neither TronGrid nor Etherscan V2
   * provides one, so this is off: an unmined or missing hash falls to D01.
   */
  mempoolChecksEnabled: boolean;
}

// ---- Engine output ----

export type EvidenceStatus = "pass" | "fail" | "warn" | "info";

export type EvidenceSource =
  | { kind: "explorer"; url: string }
  | { kind: "ledger"; row: number }
  | { kind: "addresses"; row: number }
  | { kind: "settings"; key: string }
  | { kind: "input" }
  | { kind: "provider"; provider: string; reference: string }
  | { kind: "none" };

export interface Evidence {
  id: string;
  label: string;
  status: EvidenceStatus;
  /** Short text shown in the timeline. */
  value: string;
  detail?: string;
  /** Values that may be monospaced (hashes, addresses, amounts). */
  mono?: { label: string; value: string }[];
  source: EvidenceSource;
}

export interface RuleResult {
  code: Code;
  matched: boolean;
  confidence?: Confidence;
  evidenceIds: string[];
  reason: string;
}

export interface Verdict {
  state: "verdict" | "paused";
  code: Code;
  confidence: Confidence | null;
  evidenceIds: string[];
  /** Other matched Medium rules, e.g. D07b beside a D07 verdict. Each needs analyst confirmation. */
  findings: RuleResult[];
  checks: RuleResult[];
  evidence: Evidence[];
  pausedChains: Chain[];
  /** Values the reply template may use; the only source of facts for any text. */
  fill: Record<string, string>;
  ruleVersion: string;
  settingsVersion: string;
  checkedAt: string;
}

// ---- Raw chain API responses (spec 6.2: stored with fetch time and SHA-256) ----

export interface RawResponse {
  source: "trongrid" | "etherscan";
  chain: Chain;
  /** Request as sent, with any API key removed. */
  request: { method: "GET" | "POST"; url: string; body?: string };
  status: number;
  fetchedAt: string;
  /** SHA-256 of `body`, hex. */
  sha256: string;
  body: string;
  /** True when served from cache; fetchedAt and sha256 are those of the original fetch. */
  cached?: boolean;
}
