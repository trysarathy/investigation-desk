/**
 * rc7: what the engine does when a provider export lacks quote terms or log indexes. It abstains rather than
 * assuming: an order whose quote has unknown terms is never closed (M3.quote.terms_unknown), though the provider's
 * credit is still checked; a transfer named by tx hash only is resolved from chain facts, and when several transfers
 * of that transaction reach the order's address the order is an exception (M3.provider.transfer_ambiguous).
 * Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { reconcile, type ReconcileInput } from "@/lib/clearline/merchant";
import { resolveClaimedTransfers } from "@/lib/clearline/merchant/claims";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";

const decision = (input: ReconcileInput, orderId: string) => {
  const r = reconcile(input).records.find((x) => x.orderId === orderId)!;
  return `${r.explanation.decision} ${r.explanation.ruleId}`;
};
const input = case1();
const MATCHED = "BK-24817"; // matched with a difference within the band in case 1

describe("[M3.quote.terms_unknown] quote terms not in the files", () => {
  it("baseline: the order closes with every term known", () => {
    expect(decision(input, MATCHED)).toBe("matched_with_difference M4.tolerance.within_band");
  });
  for (const terms of [["rate"], ["quoted_amount"], ["window"], ["rate", "window"]] as const) {
    it(`abstains (suggested for review, Payment Operations, reason and next step) when the ${terms.join(" and ")} is unknown`, () => {
      const x = { ...input, quotes: input.quotes.map((q) => (q.orderId === MATCHED ? { ...q, unknown: terms } : q)) };
      const r = reconcile(x).records.find((o) => o.orderId === MATCHED)!;
      expect([r.explanation.decision, r.explanation.decidingStep, r.explanation.ruleId]).toEqual(["suggested_for_review", 3, "M3.quote.terms_unknown"]);
      expect(r.attention).toMatchObject({ owner: "Payment Operations" });
      expect(r.attention!.reason).toContain("Nothing is assumed or derived");
      expect(r.attention!.nextStep).toMatch(/rate, quoted amount and validity window/);
      expect(reconcile(x).writeOffs.some((w) => w.orderId === MATCHED)).toBe(false);
      // every other order is unchanged
      const others = (y: ReconcileInput) => reconcile(y).records.filter((o) => o.orderId !== MATCHED).map((o) => [o.orderId, o.explanation.decision, o.explanation.ruleId]);
      expect(others(x)).toEqual(others(input));
    });
  }
  it("a link without its own window abstains too; a credit that is not received × executed rate is still an exception", () => {
    const rec = input.providerRecords.find((r) => r.ref.quoteId && input.quotes.find((q) => q.quoteId === r.ref.quoteId)?.orderId === MATCHED)!;
    const bad = { ...input, quotes: input.quotes.map((q) => (q.orderId === MATCHED ? { ...q, unknown: ["rate"] as const } : q)),
      providerRecords: input.providerRecords.map((r) => (r === rec ? { ...r, creditedMinor: r.creditedMinor + 7n } : r)) };
    expect(decision(bad, MATCHED)).toBe("exception M4.tolerance.unexplained");
  });
});

describe("[M3.provider.transfer_ambiguous] a claim named by tx hash only is resolved from chain facts, never assumed", () => {
  const rec = input.providerRecords.find((r) => r.transferRef && input.quotes.find((q) => q.quoteId === r.ref.quoteId)?.orderId === MATCHED)!;
  const fact = input.transfers.find((t) => t.txHash === rec.transferRef!.txHash)!;
  const moved = { ...fact, logIndex: 37 }; // the chain's real log index; the file has none
  const withClaim = (transfers: ReconcileInput["transfers"]): ReconcileInput => ({
    ...input, transfers, providerRecords: input.providerRecords.map((r) => (r === rec ? { ...r, transferRef: { ...r.transferRef!, logIndex: 0 }, logIndexUnknown: true as const } : r)),
  });
  it("exactly one transfer of that transaction reaches the order's address with its token: that one is used", () => {
    const x = withClaim(input.transfers.map((t) => (t === fact ? moved : t)));
    expect(decision(x, MATCHED)).toBe(decision(input, MATCHED));
    expect(resolveClaimedTransfers(x).input.providerRecords.find((r) => r.providerPaymentId === rec.providerPaymentId)!.transferRef!.logIndex).toBe(37);
  });
  it("without the flag, an assumed log index 0 misses the chain fact (the old behaviour this replaces)", () => {
    const x = { ...withClaim(input.transfers.map((t) => (t === fact ? moved : t))), providerRecords: input.providerRecords.map((r) => (r === rec ? { ...r, transferRef: { ...r.transferRef!, logIndex: 0 } } : r)) };
    expect(decision(x, MATCHED)).toBe("exception M3.provider.no_record");
  });
  it("several transfers of that transaction reach the address: an exception for Payment Operations, nothing chosen", () => {
    const x = withClaim([...input.transfers.map((t) => (t === fact ? moved : t)), { ...moved, logIndex: 38, amountBaseUnits: 1_000_000n }]);
    const r = reconcile(x).records.find((o) => o.orderId === MATCHED)!;
    expect([r.explanation.decision, r.explanation.decidingStep, r.explanation.ruleId]).toEqual(["exception", 3, "M3.provider.transfer_ambiguous"]);
    expect(r.attention!.reason).toMatch(/2 of its transfers \(log indexes 37, 38\)/);
    expect(r.attention!.nextStep).toMatch(/which transfer \(log index\)/);
  });
  it("a transfer of that transaction to another address, or of another token, is never used", () => {
    const x = withClaim(input.transfers.map((t) => (t === fact ? { ...moved, tokenContract: "TLookAlikeContract1111111111111111" } : t)));
    expect(resolveClaimedTransfers(x).ambiguous.size).toBe(0);
    expect(resolveClaimedTransfers(x).input.providerRecords.find((r) => r.providerPaymentId === rec.providerPaymentId)!.logIndexUnknown).toBe(true);
  });
});
