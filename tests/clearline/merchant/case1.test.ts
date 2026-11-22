/**
 * rc6 Case 1 — Singapore entity, SGD, rate 1.3500, provider fee 1%, batch B-1124-001. Every figure is asserted.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { CASE1_BATCH, CASE1_TWIN_ADDRESSES, EXCHANGE_SENDER, case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { minor, units } from "@/lib/clearline/merchant/fixtures/common";

const { reconcile, TEST_MODE_LABEL, DEFAULT_POLICY, bpsOf } = merchant;
const res = reconcile(case1());
const rec = (id: string) => res.records.find((r) => r.orderId === id)!;
const diffs = (id: string) => rec(id).explanation.differences.map((d) => [d.type, d.amountMinor]);

describe("Case 1: decisions per order", () => {
  it("carries the test-mode label on the fixture, the result and every record", () => {
    expect(case1().label).toBe("Test mode · illustrative data");
    expect(res.label).toBe(TEST_MODE_LABEL);
    expect(res.records.every((r) => r.label === TEST_MODE_LABEL)).toBe(true);
    expect(res.records.map((r) => r.orderId)).toEqual(["BK-24817", "BK-24823", "BK-24830", "BK-24836"]);
  });

  it("default policy band is min(0.5% × 1,350.00 = 6.75, 5.00) = 5.00", () => {
    expect(DEFAULT_POLICY.tolerancePct).toBe(50);
    expect(DEFAULT_POLICY.toleranceAbsMinor).toBe(minor("5.00"));
    expect(bpsOf(minor("1350.00"), 50)).toBe(minor("6.75"));
  });

  it("BK-24817: 999.00 of 1,000.00 USDT from an exchange → matched_with_difference (sender_side_fee −1.35), write-off 1.35 proposed", () => {
    const r = rec("BK-24817");
    expect(r.explanation).toMatchObject({ decision: "matched_with_difference", decidingStep: 4, ruleId: "M4.tolerance.within_band" });
    expect(diffs("BK-24817")).toEqual([["sender_side_fee", minor("-1.35")]]);
    expect(r.explanation.differences[0].reason).toMatch(/network-fee bound/);
    expect(r.ledger).toMatchObject({ creditedMinor: minor("1348.65"), openBalanceMinor: minor("1.35"), balanceState: "short_paid" });
    expect(r.chain.transfers[0]).toMatchObject({ amountBaseUnits: units("999.00"), from: EXCHANGE_SENDER, senderFacts: ["exchange_hot_wallet"], symbol: "USDT" });
    const wo = res.writeOffs.find((w) => w.orderId === "BK-24817")!;
    expect(wo).toEqual({ id: "WO-BK-24817", orderId: "BK-24817", amountMinor: minor("1.35"), direction: "shortfall", currency: "SGD", differenceIds: ["BK-24817.D1"], status: "proposed", preparedBy: "engine", approverRoles: ["finance_approver"] });
  });

  it("BK-24823: 1,760.00 of 2,000.00 → exception (underpayment 12.0%), 324.00 still owed", () => {
    const r = rec("BK-24823");
    expect(r.explanation).toMatchObject({ decision: "exception", decidingStep: 4, ruleId: "M4.tolerance.underpayment_beyond_band" });
    expect(diffs("BK-24823")).toEqual([["underpayment", minor("-324.00")]]);
    expect(r.explanation.differences[0].reason).toContain("12.0% short");
    expect(r.ledger).toMatchObject({ creditedMinor: minor("2376.00"), openBalanceMinor: minor("324.00"), customerOverpaymentMinor: 0n });
    expect(r.attention).toMatchObject({ owner: "Payment Operations" });
    expect(r.attention!.nextStep).toContain("SGD 324.00");
    expect(res.exceptions.find((e) => e.orderId === "BK-24823")).toMatchObject({ owner: "Payment Operations", step: 4 });
  });

  it("BK-24830: 708.00 against 600.00 USDC → exception (overpayment 18.0%), 145.80 customer-overpayment liability", () => {
    const r = rec("BK-24830");
    expect(r.explanation).toMatchObject({ decision: "exception", decidingStep: 4, ruleId: "M4.tolerance.overpayment_beyond_band" });
    expect(diffs("BK-24830")).toEqual([["overpayment", minor("145.80")]]);
    expect(r.explanation.differences[0].reason).toContain("18.0% over");
    expect(r.ledger).toMatchObject({ creditedMinor: minor("955.80"), openBalanceMinor: 0n, customerOverpaymentMinor: minor("145.80"), balanceState: "over_credited" });
    expect(r.chain.transfers[0].symbol).toBe("USDC");
  });

  it("BK-24836: 1,000.00 USDT 26 min after expiry, re-quoted at 1.3410 → suggested_for_review (requote_after_expiry −9.00)", () => {
    const r = rec("BK-24836");
    expect(r.explanation).toMatchObject({ decision: "suggested_for_review", decidingStep: 4, ruleId: "M4.tolerance.explained_outside_band" });
    expect(diffs("BK-24836")).toEqual([["requote_after_expiry", minor("-9.00")]]);
    expect(r.explanation.differences[0].reason).toContain("26 min after");
    expect(r.ledger.creditedMinor).toBe(minor("1341.00"));
    expect(res.writeOffs.some((w) => w.orderId === "BK-24836")).toBe(false);
  });

  it("every difference has a type, a plain-English reason and a rule id; every exception an owner, reason and next step", () => {
    for (const r of res.records) for (const d of r.explanation.differences) expect(d.reason.length > 20 && d.ruleId.startsWith("M") && d.currency === "SGD").toBe(true);
    expect(res.exceptions.map((e) => e.orderId)).toEqual(["BK-24823", "BK-24830"]);
    for (const e of res.exceptions) expect(e.owner && e.reason && e.nextStep).toBeTruthy();
    expect(res.writeOffs.map((w) => [w.orderId, w.status])).toEqual([["BK-24817", "proposed"]]);
  });
});

describe("Case 1: batch figures", () => {
  const input = case1();
  it("credited total 6,021.45; fee 1% = 60.21 (half-up of 60.2145); net 5,961.24 = the 25 Nov bank line", () => {
    const credited = res.records.reduce((t, r) => t + r.ledger.creditedMinor, 0n);
    expect(credited).toBe(minor("6021.45"));
    const [b] = input.batches;
    expect(b).toMatchObject({ batchId: CASE1_BATCH, grossMinor: credited, feesMinor: bpsOf(credited, 100), refundsMinor: 0n });
    expect(bpsOf(credited, 100)).toBe(minor("60.21"));
    expect(b.grossMinor - b.feesMinor - b.refundsMinor).toBe(minor("5961.24"));
    expect(input.bankLines[0]).toMatchObject({ valueDate: "2026-11-25", amountMinor: minor("5961.24"), source: "bank_feed" });
    expect(res.records.every((r) => r.bank.status === "in_batch" && r.bank.batchIds[0] === CASE1_BATCH)).toBe(true);
  });
});

describe("Case 1 must-pass: the two SGD 1,350.00 orders are never cross-matched", () => {
  const twins = ["BK-24817", "BK-24836"] as const;
  const assertOwn = (r: ReturnType<typeof reconcile>) => {
    for (const id of twins) {
      const m = r.records.find((x) => x.orderId === id)!;
      expect(m.chain.transfers.map((t) => t.to)).toEqual([CASE1_TWIN_ADDRESSES[id]]);
      expect(m.provider.records.map((p) => p.providerPaymentId)).toEqual([`PP-${id.slice(3)}`]);
    }
  };
  it("swapping their arrival order changes nothing", () => {
    const input = case1();
    const swapped = { ...input, transfers: [input.transfers[3], input.transfers[1], input.transfers[2], input.transfers[0]], providerRecords: [...input.providerRecords].reverse() };
    const r = reconcile(swapped);
    expect(r).toEqual(res);
    assertOwn(r);
  });
  it("with both payments carrying exactly the same amount (1,000.00 USDT), each still links only by its own deposit address", () => {
    const input = case1();
    const t17 = { ...input.transfers[0], amountBaseUnits: units("1000.00") };
    const p17 = { ...input.providerRecords[0], receivedBaseUnits: units("1000.00"), creditedMinor: minor("1350.00") };
    for (const order of [[t17, input.transfers[3]], [input.transfers[3], t17]]) {
      const r = reconcile({ ...input, transfers: [...order, input.transfers[1], input.transfers[2]], providerRecords: [p17, ...input.providerRecords.slice(1)] });
      assertOwn(r);
      expect(r.records.find((x) => x.orderId === "BK-24817")!.explanation).toMatchObject({ decision: "matched", differences: [] });
      expect(r.records.find((x) => x.orderId === "BK-24836")!.explanation.differences.map((d) => d.type)).toEqual(["requote_after_expiry"]);
    }
  });
});
