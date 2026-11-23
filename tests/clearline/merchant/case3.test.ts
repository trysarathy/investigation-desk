/**
 * rc6 Case 3 — partial payment across chains (UAE entity, AED). Every figure asserted.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { minor, units } from "@/lib/clearline/merchant/fixtures/common";
import { CASE3_POLICY, EXCHANGE_HOT_WALLET, INTERMEDIATE_WALLET, REGISTERED_WALLET, case3, case3AfterPart1, case3SmallerOfPolicy } from "@/lib/clearline/merchant/fixtures/case3";

const { reconcile, toFiatMinor, bpsOf, TEST_MODE_LABEL } = merchant;
const res = reconcile(case3());
const [rec] = res.records;

describe("Case 3: figures", () => {
  it("quote 5,000 USD × 3.6730 = 18,365.00; part 1 3,000.00 × 3.6725 = 11,017.50; part 2 1,996.50 × 3.6731 = 7,333.34 (half-up of 7,333.34415)", () => {
    expect(toFiatMinor(units("5000.00"), 6, "3.6730", "AED")).toBe(minor("18365.00"));
    expect(toFiatMinor(units("3000.00"), 6, "3.6725", "AED")).toBe(minor("11017.50"));
    expect(toFiatMinor(units("1996.50"), 6, "3.6731", "AED")).toBe(minor("7333.34"));
    expect(rec.ledger.creditedMinor).toBe(minor("18350.84"));
  });
  it("gap 14.16 = 12.86 shortfall (3.50 USD × 3.6730) + 1.30 rate difference (4,996.50 × 3.6730 = 18,352.14 − 18,350.84)", () => {
    expect(toFiatMinor(units("3.50"), 6, "3.6730", "AED")).toBe(minor("12.86"));
    expect(toFiatMinor(units("4996.50"), 6, "3.6730", "AED")).toBe(minor("18352.14"));
    expect(rec.explanation.differences.map((d) => [d.type, d.amountMinor])).toEqual([["underpayment", minor("-12.86")], ["rate_difference", minor("-1.30")]]);
    expect(rec.ledger.openBalanceMinor).toBe(minor("14.16"));
    expect(rec.explanation.differences[1].reason).toContain("3.6725 and 3.6731");
  });
  it("result matched_with_difference with a 14.16 write-off proposed for approval (AED default policy: band = max(91.83, 20.00) = 91.83; write-off threshold 20.00)", () => {
    expect(bpsOf(minor("18365.00"), CASE3_POLICY.tolerancePct)).toBe(minor("91.83"));
    expect(CASE3_POLICY).toMatchObject({ toleranceAbsMinor: minor("20.00"), toleranceCombine: "larger", writeoffThresholdMinor: minor("20.00") });
    expect(CASE3_POLICY).toEqual(merchant.defaultPolicyFor("AED"));
    expect(rec.explanation).toMatchObject({ decision: "matched_with_difference", decidingStep: 4, ruleId: "M4.tolerance.within_band" });
    expect(res.writeOffs).toEqual([{ id: "WO-BK-25102", orderId: "BK-25102", amountMinor: minor("14.16"), direction: "shortfall", currency: "AED", differenceIds: ["BK-25102.D1", "BK-25102.D2"], status: "proposed", preparedBy: "engine", approverRoles: ["finance_approver"] }]);
    expect(rec.label).toBe(TEST_MODE_LABEL);
  });
  it("two transfers on two networks and two tokens via PL-1 and PL-2; batches B-UAE-1201 (fee 110.18) and B-UAE-1203 (fee 73.33) both tied (Document A)", () => {
    expect(rec.chain.transfers.map((t) => [t.network, t.symbol, t.linkId, t.amountBaseUnits])).toEqual([["ethereum", "USDC", "PL-2", units("1996.50")], ["tron", "USDT", "PL-1", units("3000.00")]]);
    expect(res.bridges.map((b) => [b.batchId, b.tied, b.lines.find((l) => l.kind === "net")!.amountMinor, b.lines.find((l) => l.kind === "provider_fee")!.amountMinor])).toEqual([
      ["B-UAE-1201", true, minor("10907.32"), minor("-110.18")], ["B-UAE-1203", true, minor("7260.01"), minor("-73.33")],
    ]);
    expect(rec.bank).toMatchObject({ batchIds: ["B-UAE-1201", "B-UAE-1203"], batchTied: true, settlementVerified: true });
  });
  it("the hop and the exchange sender are recorded as facts only", () => {
    const [eth, tron] = rec.chain.transfers;
    expect(tron.from).toBe(INTERMEDIATE_WALLET);
    expect(tron.senderFacts).toEqual(["intermediate_wallet"]);
    expect(tron.pathFacts).toEqual([{ address: REGISTERED_WALLET, facts: ["registered_wallet"] }, { address: INTERMEDIATE_WALLET, facts: ["intermediate_wallet"] }]);
    expect(eth).toMatchObject({ from: EXCHANGE_HOT_WALLET, senderFacts: ["exchange_hot_wallet"] });
    const noFacts = reconcile({ ...case3(), addressFacts: [] }).records[0].explanation;
    expect(noFacts).toEqual(rec.explanation); // facts never change a decision
  });
});

describe("Case 3: after part 1 only", () => {
  const r = reconcile(case3AfterPart1()).records[0];
  it("open balance 7,347.50 is partial_payment_open ('part paid'), not overdue", () => {
    expect(r.explanation.differences.map((d) => [d.type, d.amountMinor])).toEqual([["partial_payment_open", minor("-7347.50")]]);
    expect(r.ledger).toMatchObject({ creditedMinor: minor("11017.50"), openBalanceMinor: minor("7347.50"), balanceState: "part_paid", balanceLabel: "part paid" });
    expect(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/overdue"|"overdue/);
    expect(r.explanation.differences[0].reason).toContain("not overdue");
    expect([r.explanation.decision, r.explanation.ruleId]).toEqual(["suggested_for_review", "M4.tolerance.explained_outside_band"]);
    expect(r.attention!.nextStep).toContain("nothing is overdue");
    expect(reconcile(case3AfterPart1()).writeOffs).toEqual([]);
  });
});

describe("Case 3: the founder's tolerance decision (rc7)", () => {
  it("under the rejected 'smaller of' alternative the band would be min(91.83, 20.00) = 20.00 > 14.16, still matched — but under rc6's min(…, 5.00) it was an exception", () => {
    const r = reconcile(case3SmallerOfPolicy());
    expect([r.records[0].explanation.decision, r.records[0].explanation.ruleId]).toEqual(["matched_with_difference", "M4.tolerance.within_band"]);
    const rc6 = reconcile({ ...case3(), policy: { ...CASE3_POLICY, toleranceCombine: "smaller", toleranceAbsMinor: minor("5.00"), writeoffThresholdMinor: minor("5.00") } });
    expect([rc6.records[0].explanation.decision, rc6.records[0].explanation.ruleId]).toEqual(["exception", "M4.tolerance.underpayment_beyond_band"]);
    expect(rc6.writeOffs).toEqual([]);
  });
  it("the combine rule decides: fixed AED 10.00 (below the 12.86 shortfall) → 'larger' matches within 91.83, 'smaller' is an exception", () => {
    const pol = { ...CASE3_POLICY, toleranceAbsMinor: minor("10.00"), writeoffThresholdMinor: minor("100.00") };
    const larger = reconcile({ ...case3(), policy: { ...pol, toleranceCombine: "larger" } }).records[0].explanation;
    const smaller = reconcile({ ...case3(), policy: { ...pol, toleranceCombine: "smaller" } }).records[0].explanation;
    expect([larger.decision, larger.ruleId]).toEqual(["matched_with_difference", "M4.tolerance.within_band"]);
    expect([smaller.decision, smaller.ruleId]).toEqual(["exception", "M4.tolerance.underpayment_beyond_band"]);
  });
  it("the band note names the rule: max(18,365.00 × 50 bps = 91.83, 20.00) = 91.83", () => {
    expect(rec.explanation.history.find((h) => h.ruleId === "M4.tolerance.within_band" && h.outcome === "note")!.detail).toContain("band max(50 bps = AED 91.83, AED 20.00) = AED 91.83");
  });
});
