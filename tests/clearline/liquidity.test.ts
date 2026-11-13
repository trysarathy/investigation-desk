import { describe, expect, it } from "vitest";
import { computeLiquidity, emptyWorkspace } from "@/lib/clearline";
import { approved, later, run } from "./helpers";

describe("liquidity", () => {
  it("usable = eligible − restricted − safeguarded − committed − buffer, labelled with its policy", () => {
    const v = computeLiquidity(emptyWorkspace());
    const row = v.rows.find((r) => r.id === "liq_northline_sgd")!;
    expect(row.bufferMinor).toBe(Math.max(480_000, Math.floor((row.eligibleMinor * 500) / 10000)));
    expect(row.usableMinor).toBe(row.eligibleMinor - row.restrictedMinor - row.safeguardedMinor - row.committedPayoutsMinor - row.bufferMinor);
    expect(row.policyLabel).toMatch(/provider-defined/);
    expect(row.source).toMatch(/fictional/);
    expect(row.asOf).toBeTruthy();
  });
  it("restricted and safeguarded balances are never usable", () => {
    const v = computeLiquidity(emptyWorkspace());
    const hf = v.rows.find((r) => r.id === "liq_harbour_sgd")!;
    expect(hf.usableMinor).toBeLessThan(hf.eligibleMinor - hf.restrictedMinor - hf.safeguardedMinor + 1);
  });
  it("stale balances are flagged and excluded from current totals", () => {
    const v = computeLiquidity(emptyWorkspace());
    const usd = v.rows.find((r) => r.id === "liq_harbour_usd")!;
    expect(usd.stale).toBe(true);
    expect(v.staleExcluded).toContain("liq_harbour_usd");
    expect(v.currentUsableByCurrency.USD).toBeUndefined();
    const all = computeLiquidity(emptyWorkspace(), "2026-11-14T12:00:00Z");
    expect(all.rows.every((r) => r.stale)).toBe(true);
    expect(all.currentUsableByCurrency).toEqual({});
  });
  it("approved payouts are committed against the chosen provider in their currency only", () => {
    const before = computeLiquidity(emptyWorkspace());
    const { ws } = approved({ amountMinor: 2_000_000 });
    const after = computeLiquidity(ws);
    const b = before.rows.find((r) => r.id === "liq_northline_sgd")!, a = after.rows.find((r) => r.id === "liq_northline_sgd")!;
    expect(a.committedPayoutsMinor - b.committedPayoutsMinor).toBe(2_000_000);
    expect(after.rows.find((r) => r.id === "liq_tidewater_usdc")!.committedPayoutsMinor).toBe(0);
    expect(Object.keys(after.currentUsableByCurrency).sort()).toEqual(["SGD", "USDC"]);
    void later; void run;
  });
});
