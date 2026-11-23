/**
 * The recorded chain client for the verify step (tests, CI and the synthetic e2e flow): it serves a recording in the
 * rc6 `RecordedChainClient` format through the same `incoming()` / `transfer()` outcomes the live readers return,
 * so the verify path that stores chain facts is exercised end to end. No network. Evidence names the source
 * "recording" and the host "recorded-fixture", so a recorded fact is never mistaken for a live read.
 *
 * Finality comes from the recording: confirmations ≥ the network's confirmationsRequired. Reads can be made to fail
 * (`unavailable`) per address or transaction, to exercise "chain data unavailable".
 */
import type { z } from "zod";
import { NETWORKS, normAddress } from "../config";
import type { ChainTransfer, NetworkConfig, NetworkId, TokenConfig } from "../types";
import { RecordedTransfer } from "../adapters/chain";
import { CHAIN_TOKENS, type ChainTransferFact, type Evidence, type IncomingOutcome, type NonMatchingTokenFact, type TransferOutcome } from "./model";

/** What the verify step needs from a chain client (RealChainClient and RecordingChainClient both provide it). */
export interface VerifyChainClient {
  readonly mode: "live" | "recorded" | "none";
  incoming(network: NetworkId, address: string, fromMs: number, toMs: number): Promise<IncomingOutcome>;
  transfer(network: NetworkId, txHash: string): Promise<TransferOutcome>;
}

export interface UnavailableRead { network: NetworkId; address?: string; txHash?: string; reason: string }
export interface RecordingOptions {
  /** The instant of every read (evidence fetchedAt). Injected: the client reads no clock. */
  now: string;
  unavailable?: readonly UnavailableRead[];
  networks?: readonly NetworkConfig[];
  tokens?: readonly TokenConfig[];
}

export const RECORDING_HOST = "recorded-fixture";
type Rec = z.infer<typeof RecordedTransfer>;
const txKey = (network: string, hash: string) => `${network}|${hash.toLowerCase().replace(/^0x/, "")}`;

export class RecordingChainClient implements VerifyChainClient {
  readonly mode = "recorded" as const;
  private readonly transfers: Rec[];
  constructor(recording: unknown, private readonly o: RecordingOptions) {
    const rec = recording as { label?: unknown; transfers?: unknown };
    if (!rec || rec.label !== "Test mode · illustrative data" || !Array.isArray(rec.transfers)) throw new Error("not a chain recording (Test mode · illustrative data)");
    this.transfers = rec.transfers.map((x) => RecordedTransfer.parse(x));
    if (!Number.isFinite(Date.parse(o.now))) throw new Error("RecordingChainClient: `now` is not an instant");
  }

  private down(network: NetworkId, target: { address?: string; txHash?: string }): UnavailableRead | undefined {
    return (this.o.unavailable ?? []).find((u) => u.network === network
      && ((target.address !== undefined && u.address !== undefined && normAddress(network, u.address) === normAddress(network, target.address))
        || (target.txHash !== undefined && u.txHash !== undefined && txKey(network, u.txHash) === txKey(network, target.txHash))));
  }

  private evidence(method: string, t?: Rec): Evidence {
    return { source: "recording", host: RECORDING_HOST, method, fetchedAt: new Date(Date.parse(this.o.now)).toISOString(),
      ...(t ? { blockNumber: BigInt(t.block), confirmationsAtFetch: BigInt(t.confirmations) } : {}) };
  }

  /** Configured tokens become transfer facts; any other contract is a look-alike fact (never a payment). */
  private split(list: Rec[], method: string): { transfers: ChainTransferFact[]; nonMatching: NonMatchingTokenFact[] } {
    const tokens = this.o.tokens ?? CHAIN_TOKENS;
    const networks = this.o.networks ?? NETWORKS;
    const transfers: ChainTransferFact[] = [];
    const nonMatching: NonMatchingTokenFact[] = [];
    for (const t of list) {
      const ev = [this.evidence(method, t)];
      const token = tokens.find((k) => k.network === t.network && normAddress(t.network, k.contract) === normAddress(t.network, t.tokenContract));
      if (!token || token.decimals !== t.decimals || (t.network !== "tron" && t.network !== "ethereum")) {
        nonMatching.push({
          network: t.network === "tron" ? "tron" : "ethereum", txHash: t.txHash, logIndex: t.logIndex, contract: t.tokenContract, from: t.from, to: t.to, rawAmount: BigInt(t.amountBaseUnits),
          ...(t.claimedSymbol ? { claimedSymbol: t.claimedSymbol } : {}), claimedDecimals: t.decimals,
          reason: "Transfer from a contract that is not a configured token (look-alike); a fact, never a payment", evidence: ev,
        });
        continue;
      }
      const required = networks.find((n) => n.network === t.network)?.confirmationsRequired ?? Number.MAX_SAFE_INTEGER;
      transfers.push({
        network: t.network, txHash: t.txHash, logIndex: t.logIndex, tokenContract: token.contract, symbol: token.symbol, from: t.from, to: t.to,
        amountBaseUnits: BigInt(t.amountBaseUnits), decimals: t.decimals, blockNumber: BigInt(t.block), timestamp: new Date(Date.parse(t.timestamp)).toISOString(),
        confirmations: BigInt(t.confirmations), finalised: t.confirmations >= required, evidence: ev,
      });
    }
    return { transfers, nonMatching };
  }

  async incoming(network: NetworkId, address: string, fromMs: number, toMs: number): Promise<IncomingOutcome> {
    const d = this.down(network, { address });
    if (d) return { status: "unavailable", reason: d.reason, evidence: [this.evidence("recording/incoming")] };
    const want = normAddress(network, address);
    const list = this.transfers.filter((t) => t.network === network && normAddress(network, t.to) === want && Date.parse(t.timestamp) >= fromMs && Date.parse(t.timestamp) <= toMs);
    return { status: "ok", ...this.split(list, "recording/incoming"), unresolved: [], evidence: [this.evidence("recording/incoming")] };
  }

  async transfer(network: NetworkId, txHash: string): Promise<TransferOutcome> {
    const d = this.down(network, { txHash });
    if (d) return { status: "unavailable", reason: d.reason, evidence: [this.evidence("recording/transaction")] };
    const list = this.transfers.filter((t) => t.network === network && txKey(network, t.txHash) === txKey(network, txHash));
    if (!list.length) return { status: "not_found", reason: "the recording has no such transaction", evidence: [this.evidence("recording/transaction")] };
    return { status: "ok", ...this.split(list, "recording/transaction"), evidence: [this.evidence("recording/transaction", list[0])] };
  }
}

/** The client used when nothing is configured: every read is unavailable (never "nothing arrived"). */
export class NoChainClient implements VerifyChainClient {
  readonly mode = "none" as const;
  constructor(private readonly reason = "No chain client is configured: set CLEARLINE_CHAIN_LIVE=1 with read keys, or CLEARLINE_CHAIN_RECORDING for recorded data.") {}
  async incoming(): Promise<IncomingOutcome> { return { status: "unavailable", reason: this.reason, evidence: [] }; }
  async transfer(): Promise<TransferOutcome> { return { status: "unavailable", reason: this.reason, evidence: [] }; }
}

/** A recording (rc6 RecordedChainClient format) from chain transfers, e.g. a synthetic world's. */
export function recordingOf(transfers: readonly ChainTransfer[]): { label: "Test mode · illustrative data"; transfers: Record<string, unknown>[] } {
  return {
    label: "Test mode · illustrative data",
    transfers: transfers.map((t) => ({
      network: t.network, txHash: t.txHash, logIndex: t.logIndex, tokenContract: t.tokenContract, ...(t.claimedSymbol ? { claimedSymbol: t.claimedSymbol } : {}),
      from: t.from, to: t.to, amountBaseUnits: t.amountBaseUnits.toString(), decimals: t.decimals, block: t.block, timestamp: t.timestamp, confirmations: t.confirmations,
    })),
  };
}
