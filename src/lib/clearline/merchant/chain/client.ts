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
import { EthereumReader } from "./ethereum";
import { type Env, assertLiveChainAllowed, processEnv } from "./guard";
import { type ChainTransferFact, type IncomingOutcome, type TransferOutcome, requiredConfirmations } from "./model";
import { type ChainFactCache, MemoryChainFactCache, RateLimiter, DEFAULT_RATE_LIMITS, type Runtime, systemRuntime } from "./resilience";
import { TronReader } from "./tron";
import { fetchTransport, type HttpTransport } from "./transport";

export class ChainDataUnavailableError extends Error {
  readonly code = "chain_data_unavailable";
  constructor(reason: string) { super(`chain data unavailable: ${reason}`); this.name = "ChainDataUnavailableError"; }
}

export interface ChainReaders {
  tron?: TronReader;
  ethereum?: EthereumReader;
  /** Why a reader is absent (e.g. "TRONGRID_API_KEY is not set"); reads on that network return unavailable. */
  missing?: { tron?: string; ethereum?: string };
  runtime?: Runtime;
}

export class RealChainClient implements ChainClient {
  readonly mode = "live" as const;
  private readonly rt: Runtime;
  constructor(private readonly readers: ChainReaders) { this.rt = readers.runtime ?? systemRuntime; }

  private reader(network: NetworkId): TronReader | EthereumReader | string {
    if (network === "tron") return this.readers.tron ?? this.readers.missing?.tron ?? "no TRON reader configured";
    if (network === "ethereum") return this.readers.ethereum ?? this.readers.missing?.ethereum ?? "no Ethereum reader configured";
    return `${network} has no live chain reader in rc7`;
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
    const blocked = o.unresolved.find((u) => u.status === "unavailable");
    if (blocked) throw new ChainDataUnavailableError(`${blocked.txHash.slice(0, 10)}…: ${blocked.reason}`);
    const required = requiredConfirmations(network as "tron" | "ethereum");
    const undecided = o.transfers.find((t) => !t.finalised && t.confirmations >= required);
    if (undecided) throw new ChainDataUnavailableError(`${undecided.txHash.slice(0, 10)}…: finality could not be re-checked`);
    return o.transfers.filter((t) => t.amountBaseUnits > 0n).map(toRecordedShape);
  }

  /** Current confirmations and block, or null if the chain no longer has it. Throws ChainDataUnavailableError on outage. */
  async confirmations(network: NetworkId, txHash: string): Promise<ChainHead | null> {
    const o = await this.transfer(network, txHash);
    switch (o.status) {
      case "unavailable": throw new ChainDataUnavailableError(o.reason);
      case "not_found": case "failed_transaction": return null;
      case "reorged": return o.currentBlock !== undefined ? { confirmations: 0, block: Number(o.currentBlock) } : null;
      case "ok": {
        const t = o.transfers[0];
        const required = requiredConfirmations(network as "tron" | "ethereum");
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

export interface LiveOptions { transport?: HttpTransport; runtime?: Runtime; cache?: ChainFactCache; timeoutMs?: number }

/**
 * Readers over real fetch, from env: TRONGRID_API_KEY (header TRON-PRO-API-KEY), optional TRONGRID_BASE_URL,
 * ETHEREUM_RPC_URL (may embed a key). Gated: throws unless CLEARLINE_CHAIN_LIVE=1, and always under tests / CI.
 */
export function liveReadersFromEnv(env: Env = processEnv(), o: LiveOptions = {}): ChainReaders {
  assertLiveChainAllowed(env);
  const runtime = o.runtime ?? systemRuntime;
  const transport = o.transport ?? fetchTransport({ timeoutMs: o.timeoutMs });
  const cache = o.cache ?? new MemoryChainFactCache();
  const readers: ChainReaders = { runtime, missing: {} };
  if (env.TRONGRID_API_KEY) {
    readers.tron = new TronReader({ transport, runtime, cache, apiKey: env.TRONGRID_API_KEY, baseUrl: env.TRONGRID_BASE_URL, limiter: new RateLimiter(DEFAULT_RATE_LIMITS.trongrid, runtime) });
  } else readers.missing!.tron = "TRONGRID_API_KEY is not set";
  if (env.ETHEREUM_RPC_URL) {
    readers.ethereum = new EthereumReader({ transport, runtime, cache, rpcUrl: env.ETHEREUM_RPC_URL, limiter: new RateLimiter(DEFAULT_RATE_LIMITS["ethereum-rpc"], runtime) });
  } else readers.missing!.ethereum = "ETHEREUM_RPC_URL is not set";
  return readers;
}

/** The gated live client. */
export function liveChainClientFromEnv(env: Env = processEnv(), o: LiveOptions = {}): RealChainClient {
  return new RealChainClient(liveReadersFromEnv(env, o));
}
