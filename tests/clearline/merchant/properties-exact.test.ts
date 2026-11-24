/**
 * rc8 property tests for founder decision 1 (M4.exact.no_quote_terms), with the repo's seeded PRNG (no Math.random):
 * an amount equal to an invoice never closes an order on its own; input order, reruns and very large amounts change
 * nothing; every amount stays a BigInt. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { reconcile, toFiatMinor, type ChainTransfer, type ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { depositAddress, USDT } from "@/lib/clearline/merchant/fixtures/common";
import { shuffleInput, shuffled } from "./helpers";

const SEEDS = Array.from({ length: 40 }, (_, i) => 4242 + i * 7919);
/** mulberry32: a deterministic stream of 32-bit integers per seed (test-only). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
}

/** All four case 1 orders, each paid exactly (random token amounts per seed), no quote terms, no settlement files. */
function exactWorld(seed: number): ReconcileInput {
  const next = prng(seed);
  const base = case1();
  const amounts = new Map(base.transfers.map((t) => [t.txHash, BigInt(1 + (next() % 5_000_000)) * 10_000n + BigInt(next() % 10_000)]));
  const transfers = base.transfers.map((t) => ({ ...t, amountBaseUnits: amounts.get(t.txHash)!, source: "chain_client" as const }));
  const providerRecords = base.providerRecords.map((r) => {
    const t = transfers.find((x) => x.txHash === r.transferRef!.txHash)!;
    const { transferRef: _t, batchId: _b, ...rest } = r;
    void _t; void _b;
    return { ...rest, statusClaim: "paid" as const, receivedBaseUnits: t.amountBaseUnits, creditedMinor: toFiatMinor(t.amountBaseUnits, t.decimals, r.executedRate, "SGD"), creditedCurrency: "SGD" as const };
  });
  const invoices = base.invoices.map((i) => ({ ...i, amountMinor: providerRecords.find((r) => base.quotes.find((q) => q.quoteId === r.ref.quoteId)!.orderId === i.orderId)!.creditedMinor }));
  return { ...base, transfers, providerRecords, invoices, quotes: base.quotes.map((q) => ({ ...q, unknown: ["quoted_amount", "rate", "window"] as const })), batches: [], batchLines: [], bankLines: [] };
}
const decisions = (i: ReconcileInput) => Object.fromEntries(reconcile(i).records.map((r) => [r.orderId, `${r.explanation.decision} ${r.explanation.ruleId}`]));
const closed = (i: ReconcileInput) => reconcile(i).records.filter((r) => r.explanation.decision === "matched" || r.explanation.decision === "matched_with_difference").map((r) => r.orderId);
const ORDERS = ["BK-24817", "BK-24823", "BK-24830", "BK-24836"];

describe("decision 1 properties (40 seeds)", () => {
  it("baseline: every exact order linked by reference closes, and only through the new rule", () => {
    for (const seed of SEEDS) expect(Object.values(decisions(exactWorld(seed)))).toEqual(ORDERS.map(() => "matched M4.exact.no_quote_terms"));
  });

  it("an amount equal to the invoice never closes without the reference link, the issued address, the verified contract or finality", () => {
    for (const seed of SEEDS) {
      const pick = prng(seed + 1);
      const base = exactWorld(seed);
      const victim = base.transfers[pick() % base.transfers.length];
      const orderOf = base.quotes.find((q) => q.depositAddress === victim.to)!.orderId;
      const variants: [string, (t: ChainTransfer) => ChainTransfer][] = [
        ["to an address issued for no order", (t) => ({ ...t, to: depositAddress(t.network === "tron" ? USDT : { network: t.network, contract: t.tokenContract }, `STRAY-${seed}`) })],
        ["on a look-alike contract", (t) => ({ ...t, tokenContract: `${t.tokenContract.slice(0, -4)}DEAD`, claimedSymbol: t.network === "tron" ? "USDT" : "USDC" })],
        ["not final", (t) => ({ ...t, confirmations: 1 })],
        ["not read by Clearline's chain client", (t) => ({ ...t, source: "recorded_fixture" as const })],
      ];
      for (const [why, f] of variants) {
        const x = { ...base, transfers: base.transfers.map((t) => (t === victim ? f(t) : t)) };
        expect(closed(x), `${seed} ${why}`).not.toContain(orderOf);
        expect(closed(x).sort(), `${seed} ${why}: the other orders are unaffected`).toEqual(ORDERS.filter((o) => o !== orderOf));
      }
      // the record no longer names the order's own reference (it names another order's quote)
      const other = base.quotes.find((q) => q.orderId !== orderOf)!.quoteId;
      const rec = base.providerRecords.find((r) => base.quotes.find((q) => q.quoteId === r.ref.quoteId)!.orderId === orderOf)!;
      const x = { ...base, providerRecords: base.providerRecords.map((r) => (r === rec ? { ...r, ref: { quoteId: other } } : r)) };
      expect(closed(x), `${seed} record without the order's reference`).not.toContain(orderOf);
    }
  });

  it("two orders with the same invoice amount never take each other's payment (any arrival order)", () => {
    for (const seed of SEEDS) {
      const base = exactWorld(seed);
      // BK-24823 gets BK-24817's invoice and the same transfer amount, but its record and transfer stay its own
      const a = base.transfers[0], b = base.transfers[1];
      const twin = { ...base, transfers: base.transfers.map((t) => (t === b ? { ...b, amountBaseUnits: a.amountBaseUnits } : t)),
        providerRecords: base.providerRecords.map((r) => (r.ref.quoteId === base.quotes[1].quoteId ? { ...r, receivedBaseUnits: a.amountBaseUnits, creditedMinor: base.providerRecords[0].creditedMinor } : r)),
        invoices: base.invoices.map((i) => (i.orderId === "BK-24823" ? { ...i, amountMinor: base.invoices[0].amountMinor } : i)) };
      // now drop BK-24823's own transfer: its twin's payment (same amount) must not close it
      const lost = { ...twin, transfers: twin.transfers.filter((t) => t !== twin.transfers[1]) };
      const r = reconcile(shuffleInput(lost, seed)).records.find((o) => o.orderId === "BK-24823")!;
      expect(r.explanation.decision, `${seed}`).toBe("exception");
      expect(r.chain.transfers).toEqual([]);
    }
  });

  it("shuffling every input list never changes the output", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const base = exactWorld(seed);
      const mixed = { ...base, transfers: [...base.transfers, { ...base.transfers[0], txHash: "e".repeat(64), to: depositAddress(USDT, "STRAY"), source: "chain_client" as const }] };
      const want = reconcile(mixed);
      for (const s of [seed, seed + 1, seed + 2]) expect(reconcile(shuffleInput(mixed, s))).toEqual(want);
      expect(reconcile({ ...mixed, tokens: shuffled(mixed.tokens, seed), networks: shuffled(mixed.networks, seed) })).toEqual(want);
    }
  });

  it("idempotent: a rerun, or a rerun on its own output's input, gives deep-equal results", () => {
    const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
    for (const seed of SEEDS.slice(0, 10)) {
      const i = exactWorld(seed);
      const first = reconcile(i);
      expect(reconcile(i)).toEqual(first);
      expect(j(reconcile(exactWorld(seed)))).toBe(j(first));
    }
  });

  it("no floats: amounts beyond 2^53 decide exactly, and every amount in the output is a BigInt", () => {
    const i = exactWorld(SEEDS[0]);
    const huge = 2n ** 80n + 1n; // its fiat value is far beyond 2^53: not representable exactly as a double
    const t0 = i.transfers[0];
    const big = { ...i, transfers: i.transfers.map((t) => (t === t0 ? { ...t, amountBaseUnits: huge } : t)) };
    const credited = toFiatMinor(huge, 6, i.providerRecords[0].executedRate, "SGD");
    const y = { ...big, providerRecords: big.providerRecords.map((r, k) => (k === 0 ? { ...r, receivedBaseUnits: huge, creditedMinor: credited } : r)), invoices: big.invoices.map((v) => (v.orderId === "BK-24817" ? { ...v, amountMinor: credited } : v)) };
    expect(decisions(y)["BK-24817"]).toBe("matched M4.exact.no_quote_terms");
    const off = { ...y, invoices: y.invoices.map((v) => (v.orderId === "BK-24817" ? { ...v, amountMinor: credited + 1n } : v)) };
    expect(Number(credited + 1n)).toBe(Number(credited)); // a float could not tell them apart
    expect(decisions(off)["BK-24817"]).toBe("suggested_for_review M3.quote.terms_unknown");
    const walk = (v: unknown, path: string): string[] => v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => walk(x, `${path}.${k}`))
      : /(Minor|BaseUnits)$/.test(path) && typeof v !== "bigint" ? [path] : [];
    expect(walk(reconcile(y), "r")).toEqual([]);
  });
});
