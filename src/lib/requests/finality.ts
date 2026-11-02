// Finality for the release wording (closes gap G1 for S1): the chain's own finality signal, read-only
// through the provider layer, never a confirmation count and never a cached block number.
//   Tron: solidified head (/walletsolidity/getnowblock), then the transaction as the solidity node sees
//         it (/walletsolidity/gettransactioninfobyid answers only once it's irreversible).
//   EVM:  the `finalized` head, then the receipt re-read uncached and its block hash compared with the
//         canonical block at that height.
// Passed only if the transaction is, right now, canonical at or below the head, in the SAME block the
// earlier lookup saw, and successful. Any error, timeout or
// malformed answer is not_run. finality-reorgs.md has the policy.

import { MemoryStore } from "../chain/store";
import { buildFetchers, EVM_SOURCES, KEYLESS_RPC } from "../chain/sources";
import type { LiveDeps } from "../chain/investigate";
import { demoTransport } from "../demo/transport";
import type { Recording } from "../demo/recordings";
import { EVM_CHAIN_IDS, type Chain, type EvmChain, type RawResponse } from "../types";
import { finalityCheck, sgtTime, type FinalityCheck } from "./release-checks";

export interface FinalityQuery {
  chain: Chain;
  /** The transaction: its block is re-read now, never taken from an earlier (cached) lookup. */
  hash: string;
  /** The block an earlier lookup saw, if any (only reported in `technical` if it moved). */
  blockNumber?: number;
  eta?: string;
}

const SIGNAL = (chain: Chain) => (chain === "tron" ? "Tron solidified block (TronGrid /walletsolidity)" : `${chain} \`finalized\` block + canonical receipt (eth_getBlockByNumber, eth_getTransactionReceipt)`);

export async function readFinality(deps: Pick<LiveDeps, "tron" | "evm">, q: FinalityQuery, now = () => new Date(),
  o: { recordedAt?: string } = {}): Promise<FinalityCheck> {
  try {
    return await read(deps, q, now, o);
  } catch {
    // Anything unexpected in the provider layer is an unknown, never an exception and never "final".
    return { state: "not_run", blockNumber: q.blockNumber, eta: q.eta, detail: "We couldn't read whether the network has made this payment final." };
  }
}

async function read(deps: Pick<LiveDeps, "tron" | "evm">, q: FinalityQuery, now: () => Date, o: { recordedAt?: string }): Promise<FinalityCheck> {
  if (q.blockNumber === undefined) return finalityCheck({ chain: q.chain, eta: q.eta });
  const raws: RawResponse[] = [];
  const checkedAt = o.recordedAt ?? now().toISOString();
  const stamp = (c: FinalityCheck): FinalityCheck => {
    const shas = raws.map((r) => r.sha256.slice(0, 12)).join(", ");
    const source = `${SIGNAL(q.chain)}${shas ? `; responses ${shas}` : ""}${o.recordedAt ? `; recorded at ${o.recordedAt}` : ""}`;
    return { ...c, source, checkedAt, detail: o.recordedAt ? `${c.detail} (${sgtTime(o.recordedAt) ? `recorded ${sgtTime(o.recordedAt)}` : "from a recording"}, not a live read)` : c.detail };
  };
  const unknown = (why: string): FinalityCheck =>
    stamp({ state: "not_run", blockNumber: q.blockNumber, eta: q.eta, detail: why, technical: `Earlier lookup saw block ${q.blockNumber}.` });

  // Head first, then the transaction: a transaction read after the head can only be newer, never older.
  const head = q.chain === "tron" ? await deps.tron.solidifiedBlock(raws) : await deps.evm.finalizedBlock(q.chain as EvmChain, raws);
  if (head === undefined) return unknown(finalityCheck({ chain: q.chain, blockNumber: q.blockNumber }).detail);
  const now_ = q.chain === "tron" ? await deps.tron.solidTxBlock(q.hash, raws) : await deps.evm.canonicalBlock(q.chain as EvmChain, q.hash, raws);
  if (now_ === undefined || now_ === "gone") return unknown("We couldn't find this payment on the chain just now, so finality is unknown.");
  if (now_ === "moved") return unknown("The network was still settling this payment's block, so finality is unknown: look it up again.");
  if (now_ === "not_solid") {
    // The solidity node doesn't have it: not irreversible. Its current block isn't known to be ≤ head, so pending, never passed.
    const c = finalityCheck({ chain: q.chain, blockNumber: Math.max(q.blockNumber, head + 1), finalizedBlock: head, eta: q.eta });
    return stamp({ ...c, blockNumber: q.blockNumber, technical: `Not yet on the solidity node; solidified up to block ${head}.` });
  }
  // Only the very transaction the earlier lookup saw, in the same block, and successful, can be final-and-paid.
  if (now_.block !== q.blockNumber) {
    return stamp({ state: "not_run", blockNumber: q.blockNumber, finalizedBlock: head, eta: q.eta,
      detail: "This payment's block changed since it was looked up, so finality is unknown: look it up again.",
      technical: `Earlier lookup saw block ${q.blockNumber}, now in block ${now_.block}.` });
  }
  if (!now_.success) {
    return stamp({ state: "not_run", blockNumber: q.blockNumber, finalizedBlock: head, eta: q.eta,
      detail: "The chain now reports this transaction as failed, so it isn't counted as final: look it up again.",
      technical: `In block ${now_.block}, receipt not successful.` });
  }
  return stamp(finalityCheck({ chain: q.chain, blockNumber: now_.block, finalizedBlock: head, eta: q.eta }));
}

/** Does this recorded request read the finality signal of `chain`? */
function readsFinality(chain: Chain, e: Recording["exchanges"][number]): boolean {
  if (chain === "tron") return e.request.url.endsWith("/walletsolidity/getnowblock");
  const evm = chain as EvmChain, plan = EVM_SOURCES[evm];
  const hosts = [plan.kind === "public-rpc" ? plan.url : "", KEYLESS_RPC[evm as keyof typeof KEYLESS_RPC] ?? ""].filter(Boolean);
  const etherscan = e.request.url.includes(`chainid=${EVM_CHAIN_IDS[evm]}&`) && e.request.url.includes("tag=finalized");
  const rpc = hosts.some((h) => e.request.url.replace(/\/$/, "") === h.replace(/\/$/, "")) && /"finalized"/.test(e.request.body ?? "");
  return etherscan || rpc;
}

/**
 * Demo: finality answered only by ONE recording that read this chain's finality signal and re-read this
 * transaction, labelled with that recording's own time. None → not_run: a confirmation count from a
 * latest-head recording is never turned into "final".
 */
export async function readFinalityFromRecordings(recordings: Recording[], q: FinalityQuery): Promise<FinalityCheck> {
  const id = q.hash.replace(/^0x/i, "").toLowerCase();
  const usable = recordings
    .filter((r) => r.exchanges.some((e) => readsFinality(q.chain, e)) && r.exchanges.some((e) => `${e.request.url} ${e.request.body ?? ""}`.toLowerCase().includes(id)))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  if (!usable.length) {
    return { state: "not_run", blockNumber: q.blockNumber, eta: q.eta, detail: "The recordings hold no finality read for this payment, so finality is unknown." };
  }
  const rec = usable[0];
  const deps = buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(), transport: demoTransport([rec]), noSpacing: true, sleep: async () => {} });
  return readFinality(deps, q, () => new Date(rec.recordedAt), { recordedAt: rec.recordedAt });
}
