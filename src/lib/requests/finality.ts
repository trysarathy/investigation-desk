// Finality for the release wording (closes gap G1 for S1): the chain's own finality signal, read-only
// through the provider layer, never a confirmation count. Tron: solidified block (19 distinct SRs,
// TronGrid /walletsolidity/getnowblock). EVM: the `finalized` block tag. Any error, timeout or odd
// answer is not_run (finality unknown), never passed. finality-reorgs.md has the policy.

import { MemoryStore } from "../chain/store";
import { buildFetchers } from "../chain/sources";
import type { LiveDeps } from "../chain/investigate";
import { demoTransport } from "../demo/transport";
import type { Recording } from "../demo/recordings";
import type { Chain, EvmChain, RawResponse } from "../types";
import { finalityCheck, type FinalityCheck } from "./release-checks";

export interface FinalityQuery { chain: Chain; blockNumber?: number; /** The 6a status sentence, shown while not final. */ eta?: string }

const SIGNAL = (chain: Chain) => (chain === "tron" ? "Tron solidified block (TronGrid /walletsolidity/getnowblock)" : `${chain} \`finalized\` block (eth_getBlockByNumber)`);
const FINALITY_REQUEST = /walletsolidity\/getnowblock|"finalized"|tag=finalized/;

export async function readFinality(deps: Pick<LiveDeps, "tron" | "evm">, q: FinalityQuery, now = () => new Date(),
  o: { recordedAt?: string } = {}): Promise<FinalityCheck> {
  if (q.blockNumber === undefined) return finalityCheck({ chain: q.chain, eta: q.eta });
  const raws: RawResponse[] = [];
  const head = q.chain === "tron" ? await deps.tron.solidifiedBlock(raws) : await deps.evm.finalizedBlock(q.chain as EvmChain, raws);
  const checkedAt = o.recordedAt ?? now().toISOString();
  const shas = raws.map((r) => r.sha256.slice(0, 12)).join(", ");
  const source = `${SIGNAL(q.chain)}${shas ? `; responses ${shas}` : ""}${o.recordedAt ? `; recorded at ${o.recordedAt}` : ""}`;
  const c = finalityCheck({ chain: q.chain, blockNumber: q.blockNumber, finalizedBlock: head, source, checkedAt, eta: q.eta });
  return o.recordedAt ? { ...c, detail: `${c.detail} (from a recording made at ${o.recordedAt}, not a live read)` } : c;
}

/**
 * Demo: finality answered only from recordings that actually read the chain's finality signal, and
 * labelled with that recording's time. No such read in the recordings → not_run: a latest-head
 * confirmation count is never turned into "final".
 */
export async function readFinalityFromRecordings(recordings: Recording[], q: FinalityQuery): Promise<FinalityCheck> {
  const withReads = recordings.filter((r) => r.exchanges.some((e) => FINALITY_REQUEST.test(`${e.request.url} ${e.request.body ?? ""}`)));
  if (!withReads.length) {
    return { state: "not_run", blockNumber: q.blockNumber, eta: q.eta, detail: "The recordings hold no finality read, so finality is unknown." };
  }
  // demoTransport serves the most recent recording's answer, so that is the time to state.
  const recordedAt = withReads.map((r) => r.recordedAt).sort().at(-1)!;
  const deps = buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(), transport: demoTransport(withReads), noSpacing: true, sleep: async () => {} });
  return readFinality(deps, q, () => new Date(recordedAt), { recordedAt });
}
