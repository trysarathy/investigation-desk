// Re-run matching over everything held: look up any transaction hash not yet found on chain,
// then match. Found transfers are kept (a mined transfer doesn't change); "not found", pending
// and failed lookups are asked again, since they can change.

import type { LiveDeps } from "../chain/investigate";
import { fetchTransfers, referencedHashes } from "./chain";
import { matchPayments, type DepositAddress } from "./match";
import type { PaymentsData } from "./store";
import type { LedgerEntryRecord } from "./types";

export interface RefreshOpts {
  depositAddresses?: DepositAddress[];
  /** Progress through the chain lookups, and a hook just before the (synchronous) match. */
  onLookup?: (done: number, total: number) => void;
  beforeMatch?: () => Promise<void>;
}

export async function refreshMatching(data: PaymentsData, deps: LiveDeps, ledger: LedgerEntryRecord[], now: () => Date = () => new Date(),
  opts: RefreshOpts = {}): Promise<PaymentsData> {
  const records = [...data.records.instruction, ...data.records.provider];
  const known = new Map(data.chain.lookups.map((l) => [l.txHash, l]));
  // Settled: found, with every other chain answering "not found". Anything else is asked again.
  const settled = (h: string) => known.get(h)?.result === "found" && !known.get(h)?.unresolved?.length;
  const todo = referencedHashes(records).filter((h) => !settled(h));
  const fetched = await fetchTransfers(todo, deps, now, opts.onLookup);
  const transfers = new Map(data.chain.transfers.map((t) => [t.recordId, t]));
  for (const t of fetched.transfers) if (!transfers.has(t.recordId)) transfers.set(t.recordId, t);
  for (const l of fetched.lookups) known.set(l.txHash, l);
  const chain = { transfers: [...transfers.values()], lookups: [...known.values()] };
  const { instruction: instructions, provider, bank } = data.records;
  // The ledger leg reads the payout ledger and File B (deposits).
  const allLedger = [...(data.records.ledger ?? []), ...ledger];
  await opts.beforeMatch?.();
  const result = matchPayments({ instructions, provider, bank, chain: chain.transfers, lookups: chain.lookups, ledger: allLedger, assigned: data.paymentIds, redirects: data.paymentRedirects, decisions: data.decisions,
    depositAddresses: opts.depositAddresses, previousLedgerLinks: data.match?.result.ledgerLinks });
  return { ...data, chain, paymentIds: result.paymentIds, paymentRedirects: result.redirects, match: { result, at: now().toISOString(), depositLedger: ledger } };
}
