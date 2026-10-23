// The on-chain leg: look up every transaction hash the instruction and provider records name, on
// every supported chain, with the existing read-only fetchers. Each token transfer becomes one
// canonical record, keyed chain + tx hash + transfer index, with its explorer link and the
// SHA-256 of the raw responses it was read from. A lookup error leaves the hash unknown.

import { explorerTxUrl } from "../catalogue";
import { lookupOne, type LiveDeps } from "../chain/investigate";
import type { ChainTx, RawResponse } from "../types";
import { ALL_CHAINS } from "../types";
import type { ChainLookupSummary, ChainTransferRecord, PaymentRecord } from "./types";

export const transferKey = (chain: string, txHash: string, index: number | undefined) => `${chain}:${txHash}:${index ?? "-"}`;

/** Hashes named by instruction and provider records, canonical (lower-case, no 0x), sorted. */
export function referencedHashes(records: PaymentRecord[]): string[] {
  const out = new Set<string>();
  for (const r of records) if ((r.kind === "instruction" || r.kind === "provider") && r.txHash) out.add(r.txHash);
  return [...out].sort();
}

export function transferRecords(tx: ChainTx, raws: RawResponse[], originalHash: string): ChainTransferRecord[] {
  const fetchedAt = raws.length ? raws.map((r) => r.fetchedAt).sort()[0] : new Date().toISOString();
  const source = { kind: "chain" as const, url: explorerTxUrl(tx.chain, tx.hash), rawSha256: [...new Set(raws.map((r) => r.sha256))], fetchedAt };
  const txHash = tx.hash.toLowerCase().replace(/^0x/, "");
  const base = {
    kind: "chain_transfer" as const, chain: tx.chain, txHash, txStatus: tx.status, blockNumber: tx.blockNumber,
    eventTime: tx.blockTime, observedTime: fetchedAt, sources: [source], transfersInTx: tx.transfers.length,
  };
  const ids = (index?: number) => [
    { role: "tx_hash", sourceField: tx.chain === "tron" ? "txID" : "hash", value: originalHash },
    ...(index === undefined ? [] : [{ role: "transfer_index", sourceField: tx.chain === "tron" ? "event_index" : "log_index", value: String(index) }]),
  ];
  if (!tx.transfers.length) {
    return [{ ...base, recordId: `chn:${transferKey(tx.chain, txHash, undefined)}`, identifiers: ids(), original: { status: tx.status, block: String(tx.blockNumber) } }];
  }
  return tx.transfers.map((t) => ({
    ...base,
    recordId: `chn:${transferKey(tx.chain, txHash, t.logIndex)}`,
    identifiers: ids(t.logIndex),
    transferIndex: t.logIndex, token: t.tokenSymbol, tokenContract: t.tokenContract, from: t.from, to: t.to, amount: t.amount,
    original: { from: t.from, to: t.to, amount: t.amount, token: t.tokenSymbol, contract: t.tokenContract, log_index: String(t.logIndex) },
  }));
}

/** Look every hash up on all chains. Found on one: its transfers. All "not found": not found. Any error: unknown. */
export async function fetchTransfers(hashes: string[], deps: LiveDeps, now: () => Date = () => new Date()):
  Promise<{ transfers: ChainTransferRecord[]; lookups: ChainLookupSummary[] }> {
  const transfers: ChainTransferRecord[] = [];
  const lookups: ChainLookupSummary[] = [];
  for (const hash of hashes) {
    const raws = new Map(ALL_CHAINS.map((c) => [c, [] as RawResponse[]]));
    const results = await Promise.all(ALL_CHAINS.map((c) => lookupOne(c, hash, deps, raws.get(c)!)));
    const found = results.find((r) => r.tx);
    const checkedAt = now().toISOString();
    if (found?.tx) {
      transfers.push(...transferRecords(found.tx, raws.get(found.tx.chain)!, hash));
      lookups.push({ txHash: hash, result: "found", chain: found.tx.chain, checkedAt });
    } else if (results.every((r) => r.lookup.result === "not_found")) {
      lookups.push({ txHash: hash, result: "not_found", checkedAt });
    } else if (results.some((r) => r.lookup.result === "pending") && results.every((r) => r.lookup.result !== "error")) {
      lookups.push({ txHash: hash, result: "pending", checkedAt });
    } else {
      const failed = results.filter((r) => r.lookup.result !== "not_found").map((r) => r.lookup.chain);
      lookups.push({ txHash: hash, result: "error", checkedAt, error: `No answer from ${failed.join(", ")}.` });
    }
  }
  return { transfers, lookups };
}
