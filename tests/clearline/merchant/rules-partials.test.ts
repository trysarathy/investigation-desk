/**
 * rc6 partials and multi-chain: one unit test per rule, named [ruleId] for docs/plan/RC6_RULE_PROOFS.md,
 * plus the link-level checks that make multi-link payments safe.
 */
import { describe, expect, it } from "vitest";
import { case3, case3AfterPart1 } from "@/lib/clearline/merchant/fixtures/case3";
import { minor } from "@/lib/clearline/merchant/fixtures/common";
import { reconcile, verdict } from "./helpers";

describe("partials", () => {
  it("[M4.partial.balance_link_open] part 1 paid with balance link PL-2 still open → partial_payment_open −7,347.50, part paid", () => {
    const r = reconcile(case3AfterPart1()).records[0];
    expect(r.explanation.differences.map((d) => [d.type, d.ruleId, d.amountMinor])).toEqual([["partial_payment_open", "M4.partial.balance_link_open", minor("-7347.50")]]);
    expect(r.ledger.balanceState).toBe("part_paid");
  });
  it("without a balance link, the same 3,000.00 of 5,000.00 is an underpayment beyond the band → exception (rest owed)", () => {
    const input = case3AfterPart1();
    const r = reconcile({ ...input, paymentLinks: input.paymentLinks.filter((l) => l.kind !== "balance") }).records[0];
    expect([r.explanation.decision, r.explanation.ruleId, r.ledger.balanceState]).toEqual(["exception", "M4.tolerance.underpayment_beyond_band", "short_paid"]);
  });
});

describe("multi-chain: every part is checked against its own link", () => {
  it("part 2 after PL-2 expired, not re-quoted → exception at step 3 (the link's window, not the quote's)", () => {
    const input = case3();
    const late = { ...input, transfers: input.transfers.map((t) => (t.network === "ethereum" ? { ...t, timestamp: "2026-12-03T07:00:00.000Z" } : t)) };
    expect(verdict(late, "BK-25102")).toEqual(["exception", 3, "M3.window.after_expiry_no_requote"]);
  });
  it("a provider record naming PL-1 for the part that reached PL-2's address → exception at step 2", () => {
    const input = case3();
    const swapped = { ...input, providerRecords: input.providerRecords.map((r) => (r.ref.linkId === "PL-2" ? { ...r, ref: { linkId: "PL-1" } } : r)) };
    expect(verdict(swapped, "BK-25102")).toEqual(["exception", 2, "M2.reference.provider_ref_mismatch"]);
  });
  it("USDT sent to the USDC balance-link address on another network never attaches to the order", () => {
    const input = case3();
    const wrongNet = { ...input, transfers: input.transfers.map((t) => (t.network === "ethereum" ? { ...t, network: "tron" as const, tokenContract: input.transfers[0].tokenContract } : t)) };
    const r = reconcile(wrongNet);
    expect(r.exceptions.some((e) => e.ruleId === "M2.reference.unattributed")).toBe(true);
    expect(r.records[0].explanation.differences.map((d) => d.type)).toEqual(["partial_payment_open"]);
  });
});
