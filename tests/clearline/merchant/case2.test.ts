/**
 * rc6 Case 2 — one settlement, many payments: the bridge from the merchant's SGT day to the bank credit. Every figure asserted.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { HELD_ORDER, REFUND_ORDER, case2Sgd, case2SgdSpecs, case2Usd, case2UsdNoBatchIds } from "@/lib/clearline/merchant/fixtures/case2";
import { minor } from "@/lib/clearline/merchant/fixtures/common";

const { reconcile, TEST_MODE_LABEL, bpsOf } = merchant;
const sgd = reconcile(case2Sgd());
const usd = reconcile(case2Usd());
const bridge = (r: ReturnType<typeof reconcile>, id: string) => r.bridges.find((b) => b.batchId === id)!;
const lines = (r: ReturnType<typeof reconcile>, id: string) => bridge(r, id).lines.map((l) => [l.kind, l.amountMinor, l.paymentIds.length]);

describe("Case 2 fixture: 33 + 2 deterministic orders", () => {
  it("33 merchant-day orders on 25 Nov SGT total 44,412.30; 2 next-day orders on 26 Nov SGT total 1,620.00", () => {
    const specs = case2SgdSpecs();
    expect(specs).toHaveLength(35);
    const day = (s: (typeof specs)[number]) => merchant.localDate(s.at, 480);
    expect(specs.filter((s) => day(s) === "2026-11-25")).toHaveLength(33);
    expect(specs.filter((s) => day(s) === "2026-11-25").reduce((t, s) => t + s.amount, 0n)).toBe(minor("44412.30"));
    expect(specs.filter((s) => day(s) === "2026-11-26").map((s) => s.amount)).toEqual([minor("810.00"), minor("810.00")]);
    expect(specs.every((s) => s.amount > 0n)).toBe(true);
    expect(case2Sgd().label).toBe(TEST_MODE_LABEL);
  });
});

describe("Case 2: SGD account bridge, batch B-1125-SGD", () => {
  it("merchant day 44,412.30 − prior batch 2,970.00 − held 1,200.00 + next-day 1,620.00 = gross 41,862.30 (31 payments)", () => {
    expect(lines(sgd, "B-1125-SGD")).toEqual([
      ["merchant_day", minor("44412.30"), 33],
      ["timing_prior_batch", minor("-2970.00"), 3],
      ["held_by_provider", minor("-1200.00"), 1],
      ["timing_next_batch", minor("1620.00"), 2],
      ["gross", minor("41862.30"), 31],
      ["provider_fee", minor("-418.62"), 31],
      ["refund_netted", minor("-1215.00"), 1],
      ["net", minor("40228.68"), 31],
    ]);
    expect(bpsOf(minor("41862.30"), 100)).toBe(minor("418.62"));
  });
  it("net 40,228.68 = the bank credit; the batch is tied and verified (bank feed)", () => {
    const b = bridge(sgd, "B-1125-SGD");
    expect(b).toMatchObject({ tied: true, settlementVerified: true, bankLineId: "BL-SG-1126-02", bankLineSource: "bank_feed", bankLineLabel: null, merchantDay: "2026-11-25", providerDay: "2026-11-25" });
    expect(Object.values(b.checks).every(Boolean)).toBe(true);
    expect(b.merchantTimeZone.name).toBe("Asia/Singapore");
    expect(b.providerTimeZone.name).toBe("UTC");
  });
  it("every bridge line lists its payment ids; the refund line names BK-24788 (900 USDT at 1.35 = 1,215.00)", () => {
    const b = bridge(sgd, "B-1125-SGD");
    for (const l of b.lines) expect(l.paymentIds.length).toBeGreaterThan(0);
    expect(b.lines.find((l) => l.kind === "held_by_provider")).toMatchObject({ paymentIds: ["PP-24871"], orderIds: [HELD_ORDER], differenceType: "held_by_provider" });
    expect(b.lines.find((l) => l.kind === "timing_prior_batch")!.orderIds).toEqual(["BK-24850", "BK-24851", "BK-24852"]);
    expect(b.lines.find((l) => l.kind === "timing_next_batch")!.orderIds).toEqual(["BK-24883", "BK-24884"]);
    expect(b.lines.find((l) => l.kind === "refund_netted")).toMatchObject({ paymentIds: ["RF-24788"], orderIds: [REFUND_ORDER], differenceType: "refund_netted" });
    expect(merchant.toFiatMinor(900_000_000n, 6, "1.3500", "SGD")).toBe(minor("1215.00"));
  });
  it("the prior batch B-1124-SGD (3 payments, 2,970.00) is tied on its own", () => {
    expect(bridge(sgd, "B-1124-SGD")).toMatchObject({ tied: true, settlementVerified: true });
    expect(lines(sgd, "B-1124-SGD")[0]).toEqual(["merchant_day", 0n, 0]);
  });
  it("BK-24871 → exception, owner Treasury: shown as completed, in no settlement, held for review", () => {
    const r = sgd.records.find((x) => x.orderId === HELD_ORDER)!;
    expect(r.explanation).toMatchObject({ decision: "exception", ruleId: "M3.batch.held_by_provider" });
    expect(r.attention).toMatchObject({ owner: "Treasury" });
    expect(r.attention!.reason).toMatch(/shown as completed, in no settlement, held for review/i);
    expect(r.bank.status).toBe("held_by_provider");
    expect(sgd.exceptions.map((e) => [e.orderId, e.owner])).toEqual([[HELD_ORDER, "Treasury"]]);
  });
  it("every other order is matched at step 5 against a tied, verified batch", () => {
    const others = sgd.records.filter((x) => x.orderId !== HELD_ORDER);
    expect(others).toHaveLength(34);
    for (const r of others) expect([r.explanation.decision, r.explanation.decidingStep, r.explanation.ruleId, r.bank.batchTied, r.bank.settlementVerified]).toEqual(["matched", 5, "M5.batch.tied_verified", true, true]);
  });
});

describe("Case 2: USD account, batch B-1125-USD", () => {
  it("7 payments, gross 9,450.00, fee 94.50, net 9,355.50 — tied", () => {
    expect(lines(usd, "B-1125-USD")).toEqual([
      ["merchant_day", minor("9450.00"), 7], ["gross", minor("9450.00"), 7], ["provider_fee", minor("-94.50"), 7], ["net", minor("9355.50"), 7],
    ]);
    expect(bridge(usd, "B-1125-USD")).toMatchObject({ tied: true, settlementVerified: true, bankLineId: "BL-US-1126-02", currency: "USD" });
    expect(usd.records.every((r) => r.explanation.decision === "matched")).toBe(true);
  });
});

describe("Case 2: no batch ID → a proposed grouping, never auto-closed", () => {
  const r = reconcile(case2UsdNoBatchIds());
  it("one grouping for provider day 2026-11-25 with all 7 payments, status proposed_needs_confirmation", () => {
    expect(r.bridges).toEqual([]);
    expect(r.proposedGroupings).toHaveLength(1);
    expect(r.proposedGroupings[0]).toMatchObject({ status: "proposed_needs_confirmation", providerDay: "2026-11-25", totalMinor: minor("9450.00"), candidateBankLineIds: ["BL-US-1126-02"] });
    expect(r.proposedGroupings[0].paymentIds).toHaveLength(7);
  });
  it("no payment is matched or tied: each is suggested for review at step 5", () => {
    for (const x of r.records) {
      expect([x.explanation.decision, x.explanation.decidingStep, x.explanation.ruleId]).toEqual(["suggested_for_review", 5, "M5.grouping.proposed_needs_confirmation"]);
      expect(x.bank).toMatchObject({ status: "proposed_grouping", batchTied: false, settlementVerified: false });
    }
  });
});
