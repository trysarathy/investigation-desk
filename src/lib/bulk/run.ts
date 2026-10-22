// Bulk investigation (spec 5.3): each valid row runs the same live investigation as a pasted
// hash, against the uploaded Files A and B. Rows that failed validation were already skipped.

import { sameAddress } from "../address";
import { VERDICT_LABELS } from "../catalogue";
import type { BulkRow } from "../csv/files";
import { fetchFacts, type LiveDeps, type Workspace } from "../chain/investigate";
import { investigate } from "../engine/run";
import { CHAIN_NAMES, type Settings } from "../types";
import type { BulkResult } from "./types";

export async function investigateRow(row: BulkRow, ws: Workspace, deps: LiveDeps, settings: Settings): Promise<BulkResult> {
  const base = { line: row.line, txHash: row.txHash, statedChain: row.chain, customerId: row.customerId, customerInferred: false };
  try {
    const facts = await fetchFacts(row.txHash, { ...ws, customerId: row.customerId }, deps, settings);
    const v = investigate(facts, settings);
    const t = facts.tx?.transfers.find((x) => facts.depositAddresses.some((r) => sameAddress(r.address, x.to))) ?? facts.tx?.transfers[0];
    const note = row.chain && facts.tx && facts.tx.chain !== row.chain
      ? `Found on ${CHAIN_NAMES[facts.tx.chain]}, not on ${CHAIN_NAMES[row.chain]} as the row says.`
      : undefined;
    return {
      ...base,
      customerId: facts.customerId,
      customerInferred: facts.customerInferredFromRow !== undefined,
      state: v.state,
      code: v.state === "verdict" ? v.code : undefined,
      label: v.state === "paused" ? `Check paused (${v.pausedChains.map((c) => CHAIN_NAMES[c]).join(", ")} unavailable)` : VERDICT_LABELS[v.code],
      confidence: v.confidence,
      foundChain: facts.tx?.chain,
      token: t?.tokenSymbol,
      amount: t?.amount,
      note,
    };
  } catch {
    return { ...base, state: "error", label: "Lookup failed; not guessed", confidence: null };
  }
}

/** Runs rows with a small worker pool; each API keeps its own rate limit inside the fetchers. */
export async function runBulk(rows: BulkRow[], ws: Workspace, deps: LiveDeps, settings: Settings,
  onResult: (r: BulkResult) => void, concurrency = 3): Promise<BulkResult[]> {
  const results: BulkResult[] = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      results[i] = await investigateRow(rows[i], ws, deps, settings);
      onResult(results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}

export { isNonCredited, resultsCsv, csvCell } from "./export";
export type { BulkResult } from "./types";
