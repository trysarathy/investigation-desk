/**
 * Chain data, read-only. A ChainClient only READS transfers to an address and a transaction's confirmations; there is
 * no signing, sending or key anywhere. `RecordedChainClient` replays recorded fixture JSON. `LiveChainClient` is a
 * stub behind CLEARLINE_CHAIN_LIVE=1, OFF by default, and refuses to exist in tests or CI: rc6 makes no live calls.
 *
 * `readChainTransfers` validates what a client returns (decimals against the token's configuration; amounts in base
 * units) and `refreshFinality` returns a transfer to "not final" on a reorg (fewer confirmations, a different block,
 * or the transaction gone). Senders and earlier hops are recorded as facts only, never judged.
 */
import { z } from "zod";
import { NETWORKS, TOKENS, normAddress } from "../config";
import type { ChainTransfer, NetworkConfig, NetworkId, TokenConfig } from "../types";
import { type AdapterResult, type AdapterSource, type RawItem, RowError, collect, isoInstant, jsonItems } from "./common";

export interface ChainHead { confirmations: number; block: number }

export interface ChainClient {
  readonly mode: "recorded" | "live";
  /** Raw transfer records to `address` on `network` at or after `since` (validated by readChainTransfers). */
  transfersTo(network: NetworkId, address: string, since: string): Promise<unknown[]>;
  /** The transaction's current confirmations and block, or null if the chain no longer has it. */
  confirmations(network: NetworkId, txHash: string): Promise<ChainHead | null>;
}

const NET = z.enum(["tron", "ethereum", "polygon", "solana", "arbitrum_one", "ton", "base"]);
const Hop = z.object({ from: z.string().min(1).max(120), to: z.string().min(1).max(120), txHash: z.string().min(1).max(200) }).strict();
export const RecordedTransfer = z.object({
  network: NET, txHash: z.string().min(1).max(200), logIndex: z.number().int().min(0).max(1_000_000),
  tokenContract: z.string().min(1).max(120), claimedSymbol: z.string().min(1).max(20).optional(),
  from: z.string().min(1).max(120), to: z.string().min(1).max(120),
  amountBaseUnits: z.string().regex(/^[1-9]\d{0,77}$/, "base units are a positive integer string"),
  decimals: z.number().int().min(0).max(36), block: z.number().int().min(0), timestamp: z.string(), confirmations: z.number().int().min(0),
  priorHops: z.array(Hop).max(20).optional(),
}).strict();
const Recording = z.object({ label: z.literal("Test mode · illustrative data"), transfers: z.array(z.unknown()), heads: z.record(z.string(), z.object({ confirmations: z.number().int().min(0), block: z.number().int().min(0) }).strict()).optional() }).strict();

/** Replays a recorded fixture. No network: the recording is the only input. */
export class RecordedChainClient implements ChainClient {
  readonly mode = "recorded" as const;
  private readonly rec: z.infer<typeof Recording>;
  constructor(recording: unknown) { this.rec = Recording.parse(recording); }
  async transfersTo(network: NetworkId, address: string, since: string): Promise<unknown[]> {
    const want = normAddress(network, address);
    return this.rec.transfers.filter((t) => {
      const x = t as Record<string, unknown>;
      return x && x.network === network && typeof x.to === "string" && normAddress(network, x.to) === want && (typeof x.timestamp !== "string" || x.timestamp >= since);
    });
  }
  async confirmations(network: NetworkId, txHash: string): Promise<ChainHead | null> {
    const head = this.rec.heads?.[`${network}:${txHash}`];
    if (head) return head;
    const t = this.rec.transfers.find((x) => (x as Record<string, unknown>)?.network === network && (x as Record<string, unknown>)?.txHash === txHash) as { confirmations?: number; block?: number } | undefined;
    return t && typeof t.confirmations === "number" && typeof t.block === "number" ? { confirmations: t.confirmations, block: t.block } : null;
  }
}

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (globalThis as { process?: { env: Env } }).process?.env ?? {};

/** Live mode needs CLEARLINE_CHAIN_LIVE=1 and is refused outright under a test runner or CI. */
export function assertLiveChainAllowed(env: Env = processEnv()): void {
  if (env.CLEARLINE_CHAIN_LIVE !== "1") throw new Error("Live chain mode is off (set CLEARLINE_CHAIN_LIVE=1 outside tests to enable the stub).");
  if (env.CI || env.VITEST || env.NODE_ENV === "test") throw new Error("Live chain mode is refused in tests and CI: use RecordedChainClient.");
}

/** A stub. rc6 implements no live provider: every method refuses, so nothing can reach a chain by accident. */
export class LiveChainClient implements ChainClient {
  readonly mode = "live" as const;
  constructor(env: Env = processEnv()) { assertLiveChainAllowed(env); }
  async transfersTo(): Promise<unknown[]> { throw new Error("LiveChainClient is a read-only stub in rc6; no live chain reader is configured."); }
  async confirmations(): Promise<ChainHead | null> { throw new Error("LiveChainClient is a read-only stub in rc6; no live chain reader is configured."); }
}

/** The client to use: recorded unless live mode is explicitly enabled (and allowed). */
export function chainClientFor(recording: unknown, env: Env = processEnv()): ChainClient {
  return env.CLEARLINE_CHAIN_LIVE === "1" ? new LiveChainClient(env) : new RecordedChainClient(recording);
}

export interface ChainTarget { network: NetworkId; address: string }
export interface ChainReadOptions { since: string; tokens?: readonly TokenConfig[]; networks?: readonly NetworkConfig[] }
export interface ReadTransfer extends ChainTransfer { finalised: boolean }

export function parseRecordedTransfer(item: RawItem, opts: ChainReadOptions): ReadTransfer {
  const r = RecordedTransfer.parse(item.value);
  const token = (opts.tokens ?? TOKENS).find((k) => k.network === r.network && normAddress(r.network, k.contract) === normAddress(r.network, r.tokenContract));
  if (token && token.decimals !== r.decimals) throw new RowError(`${r.txHash}: ${r.decimals} decimals, but ${token.symbol} on ${r.network} has ${token.decimals}`);
  const net = (opts.networks ?? NETWORKS).find((n) => n.network === r.network);
  return {
    network: r.network, txHash: r.txHash, logIndex: r.logIndex, tokenContract: r.tokenContract, ...(r.claimedSymbol ? { claimedSymbol: r.claimedSymbol } : {}),
    from: r.from, to: r.to, amountBaseUnits: BigInt(r.amountBaseUnits), decimals: r.decimals, block: r.block, timestamp: isoInstant(r.timestamp),
    confirmations: r.confirmations, ...(r.priorHops ? { priorHops: r.priorHops } : {}), finalised: !!net && r.confirmations >= net.confirmationsRequired,
  };
}

/** One source per target address; a failed or slow target never stops the others. */
export async function readChainTransfers(client: ChainClient, targets: readonly ChainTarget[], opts: ChainReadOptions): Promise<AdapterResult<ReadTransfer>> {
  const sources: AdapterSource[] = targets.map((t) => ({ id: `${t.network}:${t.address}`, read: () => client.transfersTo(t.network, t.address, opts.since) }));
  return collect(sources, (raw, id) => ({ items: jsonItems(raw, id) }), (i) => parseRecordedTransfer(i, opts), (t) => `${t.network}|${t.txHash}|${t.logIndex}`);
}

export interface FinalityUpdate { confirmations: number; block: number; finalised: boolean; reorg: boolean; reason: string }

/**
 * Compare what is stored with the chain now. Fewer confirmations, a different block, or a missing transaction is a
 * reorg: the transfer is NOT final again. On a block change the count restarts at the new block's confirmations
 * only once it is re-observed [ASSUMPTION: stored as 0 until then].
 */
export function refreshFinality(stored: { confirmations: number; block: number }, now: ChainHead | null, required: number): FinalityUpdate {
  if (!now) return { confirmations: 0, block: stored.block, finalised: false, reorg: true, reason: "The transaction is no longer on the chain (reorg)." };
  if (now.block !== stored.block) return { confirmations: 0, block: now.block, finalised: false, reorg: true, reason: `Moved from block ${stored.block} to ${now.block} (reorg).` };
  if (now.confirmations < stored.confirmations) return { confirmations: now.confirmations, block: now.block, finalised: false, reorg: true, reason: `Confirmations fell from ${stored.confirmations} to ${now.confirmations} (reorg).` };
  const finalised = now.confirmations >= required;
  return { confirmations: now.confirmations, block: now.block, finalised, reorg: false, reason: finalised ? "Final." : `${now.confirmations} of ${required} confirmations.` };
}
