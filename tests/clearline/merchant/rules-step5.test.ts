/**
 * rc6 step 5 (grouping and bridge): one unit test per rule, named [ruleId] for docs/plan/RC6_RULE_PROOFS.md.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { case2Sgd, case2UsdNoBatchIds } from "@/lib/clearline/merchant/fixtures/case2";
import { minor } from "@/lib/clearline/merchant/fixtures/common";
import { reconcile } from "./helpers";

const sgdBridge = () => reconcile(case2Sgd()).bridges.find((b) => b.batchId === "B-1125-SGD")!;
const imported = (allow: boolean) => {
  const input = case1();
  return { ...input, policy: { ...input.policy, allowImportedBankLinesAsVerified: allow }, bankLines: input.bankLines.map((l) => ({ ...l, source: "csv_import" as const, provenance: "CSV uploaded by a person" })) };
};

describe("step 5: bridge lines", () => {
  it("[M5.bridge.timing_prior_batch] 3 merchant-day orders in the prior batch are bridged out (−2,970.00) and the batch ties", () => {
    const b = sgdBridge();
    expect(b.lines.find((l) => l.kind === "timing_prior_batch")!.amountMinor).toBe(minor("-2970.00"));
    expect(b.tied).toBe(true);
  });
  it("[M5.bridge.timing_next_batch] 2 next-day orders inside the UTC provider day are bridged in (+1,620.00) and the batch ties", () => {
    const b = sgdBridge();
    expect(b.lines.find((l) => l.kind === "timing_next_batch")!.amountMinor).toBe(minor("1620.00"));
    expect(b.tied).toBe(true);
  });
  it("[M5.bridge.held_by_provider] the held order is bridged out (−1,200.00) and the batch ties", () => {
    const b = sgdBridge();
    expect(b.lines.find((l) => l.kind === "held_by_provider")!.amountMinor).toBe(minor("-1200.00"));
    expect(b.tied).toBe(true);
  });
});

describe("step 5: decisions", () => {
  it("[M5.batch.not_tied] a bank line one cent short → batch not tied → exception for every payment that would close", () => {
    const input = case1();
    const r = reconcile({ ...input, bankLines: input.bankLines.map((l) => ({ ...l, amountMinor: minor("5961.23") })) });
    const b = r.bridges[0];
    expect([b.tied, b.checks.netEqualsBankLine, b.checks.grossLessFeesRefundsEqualsNet]).toEqual([false, false, true]);
    const m = r.records.find((x) => x.orderId === "BK-24817")!;
    expect([m.explanation.decision, m.explanation.decidingStep, m.explanation.ruleId, m.attention?.owner]).toEqual(["exception", 5, "M5.batch.not_tied", "Payment Operations"]);
    expect(r.writeOffs).toEqual([]);
  });
  it("[M5.bank.imported_not_verified] a csv_import bank line ties but is not verified while the flag is false (default)", () => {
    expect(merchant.DEFAULT_POLICY.allowImportedBankLinesAsVerified).toBe(false);
    const r = reconcile(imported(false));
    expect(r.bridges[0]).toMatchObject({ tied: true, settlementVerified: false, bankLineLabel: "imported, not bank-authenticated" });
    const m = r.records.find((x) => x.orderId === "BK-24817")!;
    expect([m.explanation.decision, m.explanation.ruleId]).toEqual(["suggested_for_review", "M5.bank.imported_not_verified"]);
    expect(m.bank.bankLineLabels).toEqual(["imported, not bank-authenticated"]);
    expect(r.writeOffs).toEqual([]);
  });
  it("[M5.bank.imported_not_verified] with allowImportedBankLinesAsVerified = true it is verified, and the label is still shown", () => {
    const r = reconcile(imported(true));
    expect(r.bridges[0]).toMatchObject({ tied: true, settlementVerified: true, bankLineLabel: "imported, not bank-authenticated" });
    expect(r.records.find((x) => x.orderId === "BK-24817")!.explanation.decision).toBe("matched_with_difference");
    expect(r.writeOffs.map((w) => w.amountMinor)).toEqual([minor("1.35")]);
  });
  it("[M5.grouping.proposed_needs_confirmation] no batch ID → proposed grouping; nothing is matched", () => {
    const r = reconcile(case2UsdNoBatchIds());
    expect(r.proposedGroupings.map((g) => g.status)).toEqual(["proposed_needs_confirmation"]);
    expect(new Set(r.records.map((x) => x.explanation.decision))).toEqual(new Set(["suggested_for_review"]));
  });
  it("[M5.batch.tied_verified] an exact payment in a tied, verified batch is matched at step 5", () => {
    const m = reconcile(case2Sgd()).records.find((x) => x.orderId === "BK-24860")!;
    expect([m.explanation.decision, m.explanation.decidingStep, m.explanation.ruleId]).toEqual(["matched", 5, "M5.batch.tied_verified"]);
  });
});
