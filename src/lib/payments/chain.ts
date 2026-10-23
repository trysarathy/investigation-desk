// The on-chain leg: look up every transaction hash the instruction and provider records name, on
// every supported chain, with the existing read-only fetchers. Each token transfer becomes one
// canonical record, keyed chain + tx hash + transfer index, with its explorer link and the
// SHA-256 of the raw responses it was read from. A lookup error leaves the hash unknown.

import { explorerTxUrl } from "../catalogue";
import { lookupOne, type LiveDeps } from "../chain/investigate";
import type { ChainTx, RawResponse } from "../types";
import { ALL_CHAINS, CHAIN_NAMES } from "../types";
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

/**
 * Look every hash up on all chains and keep every chain's answer:
 *   found on one, every other chain "not found": found there;
 *   found on two or more: found, with all of them listed (matching sends it to review);
 *   found on one while another errored or only saw it pending: found, with those chains listed
 *     as unresolved (matching treats the hash as unknown unless the record names the found chain);
 *   nowhere found, all "not found": not found. Any error otherwise: unknown.
 */
export async function fetchTransfers(hashes: string[], deps: LiveDeps, now: () => Date = () => new Date()):
  Promise<{ transfers: ChainTransferRecord[]; lookups: ChainLookupSummary[] }> {
  const transfers: ChainTransferRecord[] = [];
  const lookups: ChainLookupSummary[] = [];
  for (const hash of hashes) {
    const raws = new Map(ALL_CHAINS.map((c) => [c, [] as RawResponse[]]));
    const results = await Promise.all(ALL_CHAINS.map((c) => lookupOne(c, hash, deps, raws.get(c)!)));
    const checkedAt = now().toISOString();
    const found = results.filter((r) => r.tx);
    const unresolved = results.filter((r) => !r.tx && r.lookup.result !== "not_found").map((r) => r.lookup.chain);
    if (found.length) {
      for (const r of found) transfers.push(...transferRecords(r.tx!, raws.get(r.tx!.chain)!, hash));
      const chains = found.map((r) => r.tx!.chain);
      lookups.push({ txHash: hash, result: "found", chain: chains[0], checkedAt,
        ...(chains.length > 1 ? { chains } : {}), ...(unresolved.length ? { unresolved } : {}) });
    } else if (!unresolved.length) {
      lookups.push({ txHash: hash, result: "not_found", checkedAt });
    } else if (results.every((r) => r.lookup.result !== "error")) {
      lookups.push({ txHash: hash, result: "pending", checkedAt });
    } else {
      lookups.push({ txHash: hash, result: "error", checkedAt, unresolved, error: `No answer from ${unresolved.map((c) => CHAIN_NAMES[c]).join(", ")}.` });
    }
  }
  return { transfers, lookups };
}
