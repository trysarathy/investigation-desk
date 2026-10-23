// Re-run matching over everything held: look up any transaction hash not yet found on chain,
// then match. Found transfers are kept (a mined transfer doesn't change); "not found", pending
// and failed lookups are asked again, since they can change.

import type { LiveDeps } from "../chain/investigate";
import { fetchTransfers, referencedHashes } from "./chain";
import { matchPayments } from "./match";
import type { PaymentsData, PaymentsStore } from "./store";
import type { LedgerEntryRecord } from "./types";

export async function refreshMatching(data: PaymentsData, deps: LiveDeps, ledger: LedgerEntryRecord[], now: () => Date = () => new Date()):
  Promise<PaymentsData> {
  const records = [...data.records.instruction, ...data.records.provider];
  const known = new Map(data.chain.lookups.map((l) => [l.txHash, l]));
  const todo = referencedHashes(records).filter((h) => known.get(h)?.result !== "found");
  const fetched = await fetchTransfers(todo, deps, now);
  const transfers = new Map(data.chain.transfers.map((t) => [t.recordId, t]));
  for (const t of fetched.transfers) if (!transfers.has(t.recordId)) transfers.set(t.recordId, t);
  for (const l of fetched.lookups) known.set(l.txHash, l);
  const chain = { transfers: [...transfers.values()], lookups: [...known.values()] };
  const { instruction: instructions, provider, bank } = data.records;
  const result = matchPayments({ instructions, provider, bank, chain: chain.transfers, lookups: chain.lookups, ledger });
  return { ...data, chain, match: { result, at: now().toISOString() } };
}

export async function refreshAndSave(store: PaymentsStore, deps: LiveDeps, ledger: LedgerEntryRecord[], now?: () => Date) {
  const next = await refreshMatching(await store.load(), deps, ledger, now);
  await store.save(next);
  return next;
}
