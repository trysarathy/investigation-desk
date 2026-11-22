/**
 * rc6 property tests with a seeded deterministic shuffle (no Math.random anywhere in the engine).
 */
import { describe, expect, it } from "vitest";
import type { ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { walletAddress } from "@/lib/clearline/merchant/fixtures/common";
import { reconcile, shuffleInput } from "./helpers";

const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);
const CASES: [string, () => ReconcileInput][] = [["case1", case1]];

describe.each(CASES)("%s properties", (_name, make) => {
  const baseline = reconcile(make());
  it("shuffling arrival order never changes results (25 seeds)", () => {
    for (const seed of SEEDS) expect(reconcile(shuffleInput(make(), seed))).toEqual(baseline);
  });
  it("an identical rerun gives deep-equal output", () => {
    expect(reconcile(make())).toEqual(baseline);
    expect(JSON.stringify(reconcile(make()), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(JSON.stringify(baseline, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
  it("the sender never decides: rotating every sender address leaves every decision and difference unchanged", () => {
    const input = make();
    const rotated = { ...input, transfers: input.transfers.map((t, i) => ({ ...t, from: walletAddress(t.network, `ROTATED_${i}`) })) };
    const strip = (r: ReturnType<typeof reconcile>) => r.records.map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId, x.explanation.differences]);
    expect(strip(reconcile(rotated))).toEqual(strip(baseline));
  });
});

describe("an amount-only coincidence never closes a match", () => {
  it("for every order, a transfer with exactly the quoted amount to an unissued address → exception, never matched", () => {
    const input = case1();
    for (const q of input.quotes) {
      const own = input.transfers.find((t) => t.to === q.depositAddress)!;
      const decoy = { ...own, to: walletAddress(q.network, "NOT_ISSUED"), amountBaseUnits: q.quotedBaseUnits };
      const r = reconcile({ ...input, transfers: input.transfers.map((t) => (t === own ? decoy : t)) });
      expect(r.exceptions.some((e) => e.ruleId === "M2.reference.unattributed" && e.transfer?.txHash === own.txHash)).toBe(true);
      const m = r.records.find((x) => x.orderId === q.orderId)!;
      expect(m.explanation.decision).toBe("exception");
      expect(m.chain.transfers).toEqual([]);
    }
  });
});
