import { merchant } from "@/lib/clearline";
import type { ReconcileInput } from "@/lib/clearline/merchant";

export const { reconcile } = merchant;

/** Seeded deterministic shuffle (mulberry32 + Fisher–Yates). Test-only: the engine never uses randomness. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffle every input list with one seed. */
export function shuffleInput(input: ReconcileInput, seed: number): ReconcileInput {
  return {
    ...input,
    invoices: shuffled(input.invoices, seed), quotes: shuffled(input.quotes, seed + 1), paymentLinks: shuffled(input.paymentLinks, seed + 2),
    transfers: shuffled(input.transfers, seed + 3), providerRecords: shuffled(input.providerRecords, seed + 4), batches: shuffled(input.batches, seed + 5),
    batchLines: shuffled(input.batchLines, seed + 6), bankLines: shuffled(input.bankLines, seed + 7), addressFacts: shuffled(input.addressFacts, seed + 8),
  };
}

/** Keep only the named orders (and their quotes, links, transfers to their addresses and records). */
export function only(input: ReconcileInput, orderIds: readonly string[]): ReconcileInput {
  const keep = new Set(orderIds);
  const quotes = input.quotes.filter((q) => keep.has(q.orderId));
  const links = input.paymentLinks.filter((l) => keep.has(l.orderId));
  const addrs = new Set([...quotes.map((q) => q.depositAddress), ...links.map((l) => l.depositAddress)]);
  const ids = new Set([...quotes.map((q) => q.quoteId), ...links.map((l) => l.linkId)]);
  return {
    ...input,
    invoices: input.invoices.filter((i) => keep.has(i.orderId)), quotes, paymentLinks: links,
    transfers: input.transfers.filter((t) => addrs.has(t.to) || addrs.has(t.from)),
    providerRecords: input.providerRecords.filter((r) => ids.has(r.ref.quoteId ?? "") || ids.has(r.ref.linkId ?? "")),
  };
}

export const recOf = (input: ReconcileInput, orderId: string) => reconcile(input).records.find((r) => r.orderId === orderId)!;
export const verdict = (input: ReconcileInput, orderId: string) => {
  const e = recOf(input, orderId).explanation;
  return [e.decision, e.decidingStep, e.ruleId];
};
