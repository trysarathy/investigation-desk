/**
 * RealChainClient: the existing `ChainClient` interface backed by the TronGrid and Ethereum JSON-RPC readers.
 * Construct it with injected readers (tests: recorded transports) or via `liveChainClientFromEnv`, which is gated by
 * CLEARLINE_CHAIN_LIVE=1 and refused under test runners / CI exactly like adapters/chain.ts.
 *
 * The richer API is `incoming()` / `transfer()` (outcomes with evidence and look-alike facts). The `ChainClient`
 * methods adapt those to the rc6 shapes; because that interface has no "unavailable" channel, they throw
 * `ChainDataUnavailableError`, which `readChainTransfers` → `collect()` already records as a per-source failure
 * (other addresses keep reconciling).
 */
import type { NetworkId } from "../types";
import type { ChainClient, ChainHead } from "../adapters/chain";
import { EthereumReader, type EvmNetwork } from "./ethereum";
import { type ChainReader, FallbackChainReader } from "./fallback";
import { FLAGGED_NETWORKS, NETWORK_READ_SPECS, networkFlagOn } from "./networks";
import { SolanaReader } from "./solana";
import { type Env, assertLiveChainAllowed, processEnv } from "./guard";
import { type ChainNetwork, type ChainTransferFact, type IncomingOutcome, type TransferOutcome, requiredConfirmations } from "./model";
import { type ChainFactCache, MemoryChainFactCache, RateLimiter, DEFAULT_RATE_LIMITS, type Runtime, systemRuntime } from "./resilience";
import { TronReader } from "./tron";
import { fetchTransport, type HttpTransport } from "./transport";

export class ChainDataUnavailableError extends Error {
  readonly code = "chain_data_unavailable";
  constructor(reason: string) { super(`chain data unavailable: ${reason}`); this.name = "ChainDataUnavailableError"; }
}

/** v1: two providers disagree on a transaction (chain data conflicting). Never matched. */
export class ChainDataConflictingError extends Error {
  readonly code = "chain_data_conflicting";
  constructor(reason: string) { super(reason.startsWith("chain data conflicting") ? reason : `chain data conflicting: ${reason}`); this.name = "ChainDataConflictingError"; }
}

export interface ChainReaders {
  tron?: TronReader | ChainReader;
  ethereum?: EthereumReader | ChainReader;
  /** v1: any network's reader (a single provider, or a FallbackChainReader over a primary and a fallback). */
  byNetwork?: Partial<Record<ChainNetwork, ChainReader>>;
  /** Why a reader is absent (e.g. "TRONGRID_API_KEY is not set"); reads on that network return unavailable. */
  missing?: Partial<Record<ChainNetwork, string>>;
  runtime?: Runtime;
}

export class RealChainClient implements ChainClient {
  readonly mode = "live" as const;
  private readonly rt: Runtime;
  constructor(private readonly readers: ChainReaders) { this.rt = readers.runtime ?? systemRuntime; }

  private reader(network: NetworkId): Pick<ChainReader, "getTransfer" | "listIncoming"> | string {
    const r = this.readers.byNetwork?.[network as ChainNetwork] ?? (network === "tron" ? this.readers.tron : network === "ethereum" ? this.readers.ethereum : undefined);
    if (r) return r;
    const name = (NETWORK_READ_SPECS as Partial<Record<string, { name: string }>>)[network]?.name;
    return this.readers.missing?.[network as ChainNetwork] ?? (name ? `no ${name} reader configured` : `${network} has no live chain reader`);
  }

  async incoming(network: NetworkId, address: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    const r = this.reader(network);
    if (typeof r === "string") return { status: "unavailable", reason: r, evidence: [] };
    return r.listIncoming(address, fromMs, toMs);
  }

  async transfer(network: NetworkId, txHash: string): Promise<TransferOutcome> {
    const r = this.reader(network);
    if (typeof r === "string") return { status: "unavailable", reason: r, evidence: [] };
    return r.getTransfer(txHash);
  }

  /**
   * rc6 adapter: configured-token transfers to `address` since `since`, as RecordedTransfer-shaped records.
   * Throws ChainDataUnavailableError if the read, or any listed transaction, is unavailable. Reorged and failed
   * transactions are omitted (not transfers / not final). Look-alike facts are only on `incoming()`: the rc6 record
   * needs decimals and a block that a look-alike listing does not carry. Zero-value transfers are omitted.
   */
  async transfersTo(network: NetworkId, address: string, since: string): Promise<unknown[]> {
    const fromMs = Date.parse(since);
    if (!Number.isFinite(fromMs)) throw new Error("transfersTo: `since` is not an ISO instant");
    const o = await this.incoming(network, address, fromMs, this.rt.now());
    if (o.status === "unavailable") throw new ChainDataUnavailableError(o.reason);
    const conflict = o.unresolved.find((u) => u.status === "conflicting");
    if (conflict) throw new ChainDataConflictingError(`${conflict.txHash.slice(0, 10)}…: ${conflict.reason}`);
    const blocked = o.unresolved.find((u) => u.status === "unavailable");
    if (blocked) throw new ChainDataUnavailableError(`${blocked.txHash.slice(0, 10)}…: ${blocked.reason}`);
    const required = requiredConfirmations(network);
    const undecided = o.transfers.find((t) => !t.finalised && t.confirmations >= required);
    if (undecided) throw new ChainDataUnavailableError(`${undecided.txHash.slice(0, 10)}…: finality could not be re-checked`);
    return o.transfers.filter((t) => t.amountBaseUnits > 0n).map(toRecordedShape);
  }

  /** Current confirmations and block, or null if the chain no longer has it. Throws ChainDataUnavailableError on outage. */
  async confirmations(network: NetworkId, txHash: string): Promise<ChainHead | null> {
    const o = await this.transfer(network, txHash);
    switch (o.status) {
      case "unavailable": throw new ChainDataUnavailableError(o.reason);
      case "conflicting": throw new ChainDataConflictingError(o.reason);
      case "not_found": case "failed_transaction": return null;
      case "reorged": return o.currentBlock !== undefined ? { confirmations: 0, block: Number(o.currentBlock) } : null;
      case "ok": {
        const t = o.transfers[0];
        const required = requiredConfirmations(network);
        if (t && !t.finalised && t.confirmations >= required) throw new ChainDataUnavailableError("finality could not be re-checked");
        const block = t?.blockNumber ?? o.evidence[0]?.blockNumber;
        const confirmations = t?.confirmations ?? o.evidence[0]?.confirmationsAtFetch;
        if (block === undefined || confirmations === undefined) throw new ChainDataUnavailableError("no block in the receipt");
        return { confirmations: Number(confirmations), block: Number(block) };
      }
    }
  }
}

/** A verified fact in the rc6 RecordedTransfer record shape (validated by readChainTransfers). */
export function toRecordedShape(t: ChainTransferFact): Record<string, unknown> {
  return {
    network: t.network, txHash: t.txHash, logIndex: t.logIndex, tokenContract: t.tokenContract, claimedSymbol: t.symbol,
    from: t.from, to: t.to, amountBaseUnits: t.amountBaseUnits.toString(), decimals: t.decimals,
    block: Number(t.blockNumber), timestamp: t.timestamp, confirmations: Number(t.confirmations),
  };
}

export interface LiveOptions {
  transport?: HttpTransport; runtime?: Runtime; cache?: ChainFactCache; timeoutMs?: number;
  /** v1: the per-reader-call deadline of a primary/fallback pair (FallbackChainReader). */
  callTimeoutMs?: number;
}

/**
 * Readers over real fetch, from env. Gated: throws unless CLEARLINE_CHAIN_LIVE=1, and always under tests / CI.
 * - TRON: TRONGRID_API_KEY (header TRON-PRO-API-KEY), optional TRONGRID_BASE_URL; fallback TRON_FALLBACK_BASE_URL (any
 *   TronGrid-API-compatible endpoint) with optional TRON_FALLBACK_API_KEY.
 * - Ethereum: ETHEREUM_RPC_URL (may embed a key); fallback ETHEREUM_FALLBACK_RPC_URL.
 * - v1, each only with its flag exactly "1" (default OFF): Polygon (CLEARLINE_CHAIN_POLYGON, POLYGON_RPC_URL,
 *   POLYGON_FALLBACK_RPC_URL), Base (CLEARLINE_CHAIN_BASE, BASE_RPC_URL, ...), Arbitrum One (CLEARLINE_CHAIN_ARBITRUM_ONE,
 *   ARBITRUM_ONE_RPC_URL, ...), Solana (CLEARLINE_CHAIN_SOLANA, SOLANA_RPC_URL, SOLANA_FALLBACK_RPC_URL).
 * A network with a fallback is read through a FallbackChainReader (corroborated finality, conflicts typed). Paid tiers
 * are never assumed: the rate limits are the free-tier defaults in resilience.ts.
 */
export function liveReadersFromEnv(env: Env = processEnv(), o: LiveOptions = {}): ChainReaders {
  assertLiveChainAllowed(env);
  const runtime = o.runtime ?? systemRuntime;
  const transport = o.transport ?? fetchTransport({ timeoutMs: o.timeoutMs });
  const readers: ChainReaders = { runtime, missing: {}, byNetwork: {} };
  // each provider gets its own fact cache and limiter (a fallback must not be answered from the primary's cache)
  const cache = () => o.cache ?? new MemoryChainFactCache();
  const pair = (primary: ChainReader, fallback: ChainReader | undefined): ChainReader =>
    fallback ? new FallbackChainReader({ primary, fallback, runtime, ...(o.callTimeoutMs ? { timeoutMs: o.callTimeoutMs } : {}) }) : primary;

  if (env.TRONGRID_API_KEY) {
    const primary = new TronReader({ transport, runtime, cache: cache(), apiKey: env.TRONGRID_API_KEY, baseUrl: env.TRONGRID_BASE_URL, limiter: new RateLimiter(DEFAULT_RATE_LIMITS.trongrid, runtime) });
    const fallback = env.TRON_FALLBACK_BASE_URL ? new TronReader({ transport, runtime, cache: cache(), apiKey: env.TRON_FALLBACK_API_KEY, baseUrl: env.TRON_FALLBACK_BASE_URL, provider: "fallback", limiter: new RateLimiter(DEFAULT_RATE_LIMITS.trongrid, runtime) }) : undefined;
    const r = pair(primary, fallback);
    readers.byNetwork!.tron = r;
    readers.tron = r;
  } else readers.missing!.tron = "TRONGRID_API_KEY is not set";

  const evm = (network: EvmNetwork, primaryUrl: string | undefined, fallbackUrl: string | undefined): ChainReader | undefined => {
    if (!primaryUrl) return undefined;
    const source = network === "ethereum" ? "ethereum-rpc" : "evm-rpc";
    const mk = (rpcUrl: string, provider: string) => new EthereumReader({ transport, runtime, cache: cache(), rpcUrl, network, provider, limiter: new RateLimiter(DEFAULT_RATE_LIMITS[source], runtime) });
    return pair(mk(primaryUrl, "primary"), fallbackUrl ? mk(fallbackUrl, "fallback") : undefined);
  };
  const eth = evm("ethereum", env.ETHEREUM_RPC_URL, env.ETHEREUM_FALLBACK_RPC_URL);
  if (eth) { readers.byNetwork!.ethereum = eth; readers.ethereum = eth; } else readers.missing!.ethereum = "ETHEREUM_RPC_URL is not set";

  for (const network of FLAGGED_NETWORKS) {
    const spec = NETWORK_READ_SPECS[network];
    if (!networkFlagOn(network, env)) { readers.missing![network] = `${spec.name} chain reads are off (${spec.flag} is not 1)`; continue; }
    const primaryUrl = env[spec.primaryEnv], fallbackUrl = env[spec.fallbackEnv];
    if (!primaryUrl) { readers.missing![network] = `${spec.primaryEnv} is not set`; continue; }
    if (network === "solana") {
      const mk = (rpcUrl: string, provider: string) => new SolanaReader({ transport, runtime, cache: cache(), rpcUrl, provider, limiter: new RateLimiter(DEFAULT_RATE_LIMITS["solana-rpc"], runtime) });
      readers.byNetwork!.solana = pair(mk(primaryUrl, "primary"), fallbackUrl ? mk(fallbackUrl, "fallback") : undefined);
    } else readers.byNetwork![network] = evm(network, primaryUrl, fallbackUrl);
  }
  return readers;
}

/** The gated live client. */
export function liveChainClientFromEnv(env: Env = processEnv(), o: LiveOptions = {}): RealChainClient {
  return new RealChainClient(liveReadersFromEnv(env, o));
}
