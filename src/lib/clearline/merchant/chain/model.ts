/**
 * Outcome and fact types for the read-only chain readers, plus the helper the reconciliation engine uses to consume
 * them. Kept here (not in ../types.ts) so the engine's domain types stay unchanged. All amounts and block numbers are
 * BigInt; token identity is (network, contract) only.
 */
import { NETWORKS, TOKENS } from "../config";
import type { NetworkConfig, TokenConfig } from "../types";
import { V1_NETWORK_TOKENS } from "./networks";

/** v1: Polygon, Base, Arbitrum One and Solana are read behind per-network flags (default OFF; see networks.ts). */
export type ChainNetwork = "tron" | "ethereum" | "polygon" | "base" | "arbitrum_one" | "solana";
/**
 * "recording": a recorded or fixture client (tests, the synthetic e2e flow); never a live read. "evm-rpc": a JSON-RPC
 * reader on an EVM network other than Ethereum (the evidence's network says which). "solana-rpc": Solana JSON-RPC.
 */
export type EvidenceSource = "trongrid" | "ethereum-rpc" | "evm-rpc" | "solana-rpc" | "recording";

/** Where a fact came from. `host` is the hostname only: never a path, query, header or key. */
export interface Evidence {
  source: EvidenceSource;
  host: string;
  /** Endpoint or JSON-RPC method, e.g. "wallet/gettransactioninfobyid" or "eth_getTransactionReceipt". */
  method: string;
  /** ISO instant from the injected clock. */
  fetchedAt: string;
  blockNumber?: bigint;
  blockHash?: string;
  confirmationsAtFetch?: bigint;
}

/** A verified transfer of a configured token (receipt successful, log from the configured contract). */
export interface ChainTransferFact {
  network: ChainNetwork;
  txHash: string;
  logIndex: number;
  tokenContract: string;
  symbol: string;
  from: string;
  to: string;
  amountBaseUnits: bigint;
  decimals: number;
  blockNumber: bigint;
  blockHash?: string;
  timestamp: string;
  confirmations: bigint;
  /** confirmations >= the network's confirmationsRequired AND the receipt was re-read unchanged. */
  finalised: boolean;
  evidence: Evidence[];
  /** Earlier wallet-to-wallet hops a recording names for this transfer (facts only; live readers never set it). */
  priorHops?: readonly { from: string; to: string; txHash: string }[];
}

/** A Transfer-shaped log or listing from a contract that is NOT configured (look-alike token). A fact, not a payment. */
export interface NonMatchingTokenFact {
  network: ChainNetwork;
  txHash: string;
  logIndex?: number;
  contract: string;
  from?: string;
  to?: string;
  rawAmount?: bigint;
  /** What the explorer/API claims (TronGrid token_info); informative only. */
  claimedSymbol?: string;
  claimedDecimals?: number;
  reason: string;
  evidence: Evidence[];
}

/**
 * v1: "conflicting" = the primary and fallback providers disagree on a fact of this transaction (chain data
 * conflicting). Like "unavailable" it is never matched; unlike it, it is a typed exception that needs a person.
 */
export interface UnresolvedTx { txHash: string; status: "unavailable" | "reorged" | "not_found" | "failed_transaction" | "conflicting"; reason: string }

export type TransferOutcome =
  | { status: "ok"; transfers: ChainTransferFact[]; nonMatching: NonMatchingTokenFact[]; evidence: Evidence[] }
  /** Receipt says the transaction failed: never a transfer. */
  | { status: "failed_transaction"; reason: string; evidence: Evidence[] }
  /** The chain has no receipt for this hash (unknown or still pending). */
  | { status: "not_found"; reason: string; evidence: Evidence[] }
  /** The receipt moved or vanished between reads: not final. `currentBlock` is set if it reappeared elsewhere. */
  | { status: "reorged"; reason: string; currentBlock?: bigint; transfers: ChainTransferFact[]; evidence: Evidence[] }
  | { status: "unavailable"; reason: string; evidence: Evidence[] }
  /** v1: two providers disagree on this transaction's facts. Never matched; both sides' evidence is kept. */
  | { status: "conflicting"; reason: string; evidence: Evidence[] };

export type IncomingOutcome =
  | { status: "ok"; transfers: ChainTransferFact[]; nonMatching: NonMatchingTokenFact[]; unresolved: UnresolvedTx[]; evidence: Evidence[] }
  | { status: "unavailable"; reason: string; evidence: Evidence[] };

export type ChainOutcome = TransferOutcome | IncomingOutcome;

/** Public USDT on Ethereum. Not in ../config TOKENS (rc6 only configures USDC there), so the readers add it. */
export const USDT_ETHEREUM = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

/** Tokens the readers recognise: config TOKENS plus USDT on Ethereum (6 decimals). Identity is (network, contract). */
export const CHAIN_TOKENS: readonly TokenConfig[] = [
  ...TOKENS,
  ...(TOKENS.some((t) => t.network === "ethereum" && t.contract.toLowerCase() === USDT_ETHEREUM.toLowerCase())
    ? [] : [{ network: "ethereum" as const, contract: USDT_ETHEREUM, symbol: "USDT", decimals: 6 }]),
  // v1: the flagged networks' verified allowlists (networks.ts). Recognised by the readers only; matching still needs token_config.
  ...V1_NETWORK_TOKENS,
];

export function requiredConfirmations(network: ChainNetwork | string, networks: readonly NetworkConfig[] = NETWORKS): bigint {
  const n = networks.find((x) => x.network === network);
  if (!n) throw new Error(`no network config for ${network}`);
  return BigInt(n.confirmationsRequired);
}

/** head − block + 1, floored at 0 (a head behind the block, e.g. a lagging node, gives 0, never negative). */
export function confirmationsOf(head: bigint, block: bigint): bigint {
  const c = head - block + 1n;
  return c > 0n ? c : 0n;
}

/** Strict 0x-hex → BigInt. Throws on anything else (callers turn that into `unavailable`). */
export function hexToBigInt(v: unknown, what: string): bigint {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]+$/.test(v)) throw new Error(`malformed ${what}`);
  return BigInt(v);
}

/** JSON with BigInt rendered as decimal strings (for logs, snapshots and the redaction test). */
export const stringifyFacts = (v: unknown, space?: number): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), space);

/**
 * How the reconciliation engine consumes a reader outcome. The rule, exactly:
 *
 * 1. `status: "unavailable"` (whole read) → the engine shows "chain data unavailable" for every payment that depends on
 *    that read (that deposit address / that transaction) and MUST NOT match, settle-verify, write off or close those
 *    payments. They stay open as "awaiting chain data" and are retried on the next run. It is NOT evidence that no
 *    transfer happened: never treat it as zero received, underpaid or missing. Other payments, addresses and networks
 *    reconcile normally.
 * 2. `unresolved` entries inside an ok listing → the same treatment, scoped to that one transaction hash.
 * 3. `reorged` → the transaction is not final; any earlier match on it returns to "pending confirmation".
 * 4. `failed_transaction` / `not_found` → no transfer exists for that hash (a fact, not an outage).
 * 5. `transfers` with `finalised: false` → seen but not final: may be shown as pending, never counted as paid.
 * 6. Only `finalised: true` transfers may be matched as received funds.
 * 7. `nonMatching` facts (look-alike contracts) are shown as facts and never count as a payment of a configured token.
 * 8. v1: `conflicting` (two providers disagree) → "chain data conflicting" for that transaction: never matched, a typed
 *    exception for a person (it is not an outage, so it is not simply retried away).
 */
export type ChainConsumption =
  | { kind: "chain_data_unavailable"; reason: string; mayMatch: false; evidence: Evidence[] }
  | { kind: "chain_data_conflicting"; reason: string; mayMatch: false; evidence: Evidence[] }
  | { kind: "facts"; final: ChainTransferFact[]; pending: ChainTransferFact[]; nonMatching: NonMatchingTokenFact[]; unavailableTx: UnresolvedTx[]; noTransfer: UnresolvedTx[]; reorged: UnresolvedTx[]; conflictingTx: UnresolvedTx[] };

export function consumeChainOutcome(o: ChainOutcome, txHash?: string): ChainConsumption {
  if (o.status === "unavailable") return { kind: "chain_data_unavailable", reason: o.reason, mayMatch: false, evidence: o.evidence };
  if (o.status === "conflicting") return { kind: "chain_data_conflicting", reason: o.reason, mayMatch: false, evidence: o.evidence };
  const empty = { final: [], pending: [], nonMatching: [], unavailableTx: [], noTransfer: [], reorged: [], conflictingTx: [] };
  const tx = txHash ?? "";
  if (o.status === "failed_transaction" || o.status === "not_found") return { kind: "facts", ...empty, noTransfer: [{ txHash: tx, status: o.status, reason: o.reason }] };
  if (o.status === "reorged") return { kind: "facts", ...empty, pending: o.transfers.map((t) => ({ ...t, finalised: false })), reorged: [{ txHash: tx, status: "reorged", reason: o.reason }] };
  const unresolved = "unresolved" in o ? o.unresolved : [];
  return {
    kind: "facts",
    final: o.transfers.filter((t) => t.finalised),
    pending: o.transfers.filter((t) => !t.finalised),
    nonMatching: o.nonMatching,
    unavailableTx: unresolved.filter((u) => u.status === "unavailable"),
    noTransfer: unresolved.filter((u) => u.status === "failed_transaction" || u.status === "not_found"),
    reorged: unresolved.filter((u) => u.status === "reorged"),
    conflictingTx: unresolved.filter((u) => u.status === "conflicting"),
  };
}
