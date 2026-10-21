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
  | "D08" | "D09" | "D10" | "D11" | "D12" | "D13" | "D14" | "D99";

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
  result: "found" | "not_found" | "error";
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
  /** Free text from the company's system. Treated as data, never as instructions. */
  note?: string;
}

export interface Facts {
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
}

// ---- Engine output ----

export type EvidenceStatus = "pass" | "fail" | "warn" | "info";

export type EvidenceSource =
  | { kind: "explorer"; url: string }
  | { kind: "ledger"; row: number }
  | { kind: "addresses"; row: number }
  | { kind: "settings"; key: string }
  | { kind: "input" }
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
  checks: RuleResult[];
  evidence: Evidence[];
  pausedChains: Chain[];
  /** Values the reply template may use; the only source of facts for any text. */
  fill: Record<string, string>;
  ruleVersion: string;
  settingsVersion: string;
  checkedAt: string;
}
