/**
 * v1 Phase 0 property tests for token-priced invoices (M4.exact.token_priced), with a seeded PRNG (no Math.random): an
 * exact token payment linked by reference closes; any base-unit difference, another token or a missing reference never
 * closes; two orders with the same token price never take each other's payment; input order and very large amounts
 * change nothing. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { reconcile, toFiatMinor, type ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { depositAddress, USDC, USDT } from "@/lib/clearline/merchant/fixtures/common";
import { shuffleInput } from "./helpers";

const SEEDS = Array.from({ length: 40 }, (_, i) => 5151 + i * 7919);
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
}
const ORDERS = ["BK-24817", "BK-24823", "BK-24830", "BK-24836"];

/** All four case 1 orders priced in the token they were paid with (random amounts per seed), no quote terms or settlement. */
function pricedWorld(seed: number): ReconcileInput {
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
  const quoteOf = (orderId: string) => base.quotes.find((q) => q.orderId === orderId)!;
  const invoices = base.invoices.map((i) => {
    const q = quoteOf(i.orderId);
    const t = transfers.find((x) => x.to === q.depositAddress)!;
    return { ...i, amountMinor: 0n, price: { token: q.token, baseUnits: t.amountBaseUnits } };
  });
  return { ...base, transfers, providerRecords, invoices, quotes: base.quotes.map((q) => ({ ...q, unknown: ["quoted_amount", "rate", "window"] as const })), batches: [], batchLines: [], bankLines: [] };
}
const decisions = (i: ReconcileInput) => Object.fromEntries(reconcile(i).records.map((r) => [r.orderId, `${r.explanation.decision} ${r.explanation.ruleId}`]));
const closed = (i: ReconcileInput) => reconcile(i).records.filter((r) => r.explanation.decision === "matched" || r.explanation.decision === "matched_with_difference").map((r) => r.orderId);

describe("token-priced properties (40 seeds)", () => {
  it("baseline: every exact token payment linked by reference closes, only through the new rule", () => {
    for (const seed of SEEDS) expect(Object.values(decisions(pricedWorld(seed))), `${seed}`).toEqual(ORDERS.map(() => "matched M4.exact.token_priced"));
  });

  it("any base-unit difference (1 up to 10^6, either way, on the price or the payment) never closes, and is typed", () => {
    for (const seed of SEEDS) {
      const pick = prng(seed + 3);
      const base = pricedWorld(seed);
      const victim = base.invoices[pick() % base.invoices.length];
      const delta = BigInt(1 + (pick() % 1_000_000)) * (pick() % 2 ? 1n : -1n);
      const x = { ...base, invoices: base.invoices.map((i) => (i === victim ? { ...i, price: { ...i.price!, baseUnits: i.price!.baseUnits + delta } } : i)) };
      expect(closed(x), `${seed}`).not.toContain(victim.orderId);
      expect(closed(x).sort(), `${seed}: the other orders are unaffected`).toEqual(ORDERS.filter((o) => o !== victim.orderId));
      const r = reconcile(x).records.find((o) => o.orderId === victim.orderId)!;
      expect(r.explanation.ruleId).toBe("M4.token_priced.amount_difference");
      expect(r.explanation.differences.find((d) => d.type === "price_token_amount")?.token?.baseUnits).toBe(-delta);
    }
  });

  it("another token, a transfer to an address issued for no order, or no provider reference: never closes", () => {
    for (const seed of SEEDS) {
      const base = pricedWorld(seed);
      const v = base.invoices[prng(seed + 5)() % base.invoices.length];
      const other = v.price!.token.network === "tron" ? USDC : USDT;
      const token = { ...base, invoices: base.invoices.map((i) => (i === v ? { ...i, price: { ...i.price!, token: other } } : i)) };
      expect(closed(token), `${seed} other token`).not.toContain(v.orderId);
      const q = base.quotes.find((x) => x.orderId === v.orderId)!;
      const stray = { ...base, transfers: base.transfers.map((t) => (t.to === q.depositAddress ? { ...t, to: depositAddress(q.token, `STRAY-${seed}`) } : t)) };
      expect(closed(stray), `${seed} stray`).not.toContain(v.orderId);
      const otherQuote = base.quotes.find((x) => x.orderId !== v.orderId)!.quoteId;
      const noRef = { ...base, providerRecords: base.providerRecords.map((r) => (r.ref.quoteId === q.quoteId ? { ...r, ref: { quoteId: otherQuote } } : r)) };
      expect(closed(noRef), `${seed} no reference`).not.toContain(v.orderId);
    }
  });

  it("two orders with the same token price never take each other's payment", () => {
    for (const seed of SEEDS) {
      const base = pricedWorld(seed);
      const [a, b] = base.invoices;
      const same = { ...base, invoices: base.invoices.map((i) => (i === b ? { ...i, price: { ...a.price! } } : i)) };
      const qb = base.quotes.find((q) => q.orderId === b.orderId)!;
      const lost = { ...same, transfers: same.transfers.filter((t) => t.to !== qb.depositAddress) };
      const r = reconcile(shuffleInput(lost, seed)).records.find((o) => o.orderId === b.orderId)!;
      expect(r.explanation.decision, `${seed}`).toBe("exception");
      expect(r.chain.transfers).toEqual([]);
    }
  });

  it("shuffling every input list never changes the output", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const i = pricedWorld(seed);
      const want = reconcile(i);
      for (const s of [seed, seed + 1]) expect(reconcile(shuffleInput(i, s))).toEqual(want);
    }
  });

  it("no floats: a price beyond 2^53 is compared exactly", () => {
    const i = pricedWorld(SEEDS[0]);
    const huge = 2n ** 80n + 1n;
    const t0 = i.transfers[0];
    const q = i.quotes.find((x) => x.depositAddress === t0.to)!;
    const y = { ...i, transfers: i.transfers.map((t) => (t === t0 ? { ...t, amountBaseUnits: huge } : t)),
      providerRecords: i.providerRecords.map((r) => (r.ref.quoteId === q.quoteId ? { ...r, receivedBaseUnits: huge, creditedMinor: toFiatMinor(huge, 6, r.executedRate, "SGD") } : r)),
      invoices: i.invoices.map((v) => (v.orderId === q.orderId ? { ...v, price: { ...v.price!, baseUnits: huge } } : v)) };
    expect(decisions(y)[q.orderId]).toBe("matched M4.exact.token_priced");
    const off = { ...y, invoices: y.invoices.map((v) => (v.orderId === q.orderId ? { ...v, price: { ...v.price!, baseUnits: huge - 1n } } : v)) };
    expect(Number(huge - 1n)).toBe(Number(huge));
    expect(decisions(off)[q.orderId]).toBe("suggested_for_review M4.token_priced.amount_difference");
  });
});
