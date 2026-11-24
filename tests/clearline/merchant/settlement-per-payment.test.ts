/**
 * v1 Phase 0 (approval-only draft): a per-payment settlement file (one row per payment: payment ID, order, gross, fee,
 * net, batch, currency) beside a totals-only settlement report. A batch ties from these lines only when they sum exactly
 * to the batch and its net to the bank credit, each line agreeing with the payment it names BY ITS ID; the decision rules
 * of step 5 are otherwise unchanged (an imported bank line still never verifies settlement while the flag is off). An
 * amount never links a payment to a batch. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { localDate, reconcile, toFiatMinor, type ReconcileInput, type SettlementPaymentLine } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { only } from "./helpers";

const ORDER = "BK-24817";
const FEE = 1234n;

/** BK-24817 alone: exact, no quote terms, its record names its transfer and batch B-PP; the report gives B-PP's totals only. */
function perPayment(opts: { bank?: "bank_feed" | "csv_import"; lines?: boolean } = {}): ReconcileInput {
  const base = only(case1(), [ORDER]);
  const t = { ...base.transfers[0], source: "chain_client" as const };
  const r = base.providerRecords[0];
  const credited = toFiatMinor(t.amountBaseUnits, t.decimals, r.executedRate, "SGD");
  const day = localDate(t.timestamp, base.entity.timeZone.utcOffsetMinutes);
  const account = base.batches[0].targetBankAccount;
  const batch = { ...base.batches[0], batchId: "B-PP", providerDay: day, grossMinor: credited, feesMinor: FEE, refundsMinor: 0n, netMinor: credited - FEE };
  return {
    ...base, transfers: [t],
    invoices: base.invoices.map((i) => ({ ...i, amountMinor: credited })),
    quotes: base.quotes.map((q) => ({ ...q, unknown: ["quoted_amount", "rate", "window"] as const })),
    providerRecords: [{ ...r, statusClaim: "paid", receivedBaseUnits: t.amountBaseUnits, creditedMinor: credited, creditedCurrency: "SGD", batchId: "B-PP" }],
    batches: [batch], batchLines: [],
    bankLines: [{ bankLineId: "BL-PP", account, currency: "SGD", valueDate: day, amountMinor: batch.netMinor, description: "PAYOUT B-PP", source: opts.bank ?? "bank_feed", provenance: "fictional" }],
    ...(opts.lines === false ? {} : { settlementPaymentLines: [{ batchId: "B-PP", providerPaymentId: r.providerPaymentId, orderId: ORDER, currency: "SGD", grossMinor: credited, feeMinor: FEE, netMinor: credited - FEE, settlementDate: day }] }),
  };
}
const verdict = (i: ReconcileInput) => { const e = reconcile(i).records.find((x) => x.orderId === ORDER)!.explanation; return `${e.decision} ${e.ruleId}`; };
const line = (i: ReconcileInput, f: (l: SettlementPaymentLine) => SettlementPaymentLine): ReconcileInput => ({ ...i, settlementPaymentLines: i.settlementPaymentLines!.map(f) });
const bridge = (i: ReconcileInput) => reconcile(i).bridges.find((b) => b.batchId === "B-PP")!;

describe("per-payment settlement lines tie a totals-only batch", () => {
  it("before: totals only, no line names the payment → the grouping is only proposed (review), as in rc8", () => {
    expect(verdict(perPayment({ lines: false }))).toBe("suggested_for_review M5.grouping.proposed_needs_confirmation");
    expect(bridge(perPayment({ lines: false })).checks.perPaymentLines).toBeUndefined();
  });
  it("after: the lines sum to the batch and the bank credit → tied; a bank-feed line verifies it → matched at step 5", () => {
    const i = perPayment();
    expect(bridge(i)).toMatchObject({ tied: true, settlementVerified: true, checks: { perPaymentLines: true, linesEqualGross: true, netEqualsBankLine: true } });
    expect(verdict(i)).toBe("matched M5.batch.tied_verified");
  });
  it("an imported bank line keeps 'imported, not bank-authenticated': tied, never verified, review (flag off)", () => {
    const i = perPayment({ bank: "csv_import" });
    expect(bridge(i)).toMatchObject({ tied: true, settlementVerified: false, bankLineLabel: "imported, not bank-authenticated" });
    expect(verdict(i)).toBe("suggested_for_review M5.bank.imported_not_verified");
    expect(verdict({ ...i, policy: { ...i.policy, allowImportedBankLinesAsVerified: true } })).toBe("matched M5.batch.tied_verified");
  });
});

describe("any disagreement leaves the batch untied (exception, never closed)", () => {
  const cases: [string, (i: ReconcileInput) => ReconcileInput][] = [
    ["the line's gross is one cent off the payment's credit", (i) => line(i, (l) => ({ ...l, grossMinor: l.grossMinor + 1n, netMinor: l.netMinor + 1n }))],
    ["gross − fee ≠ net on the line", (i) => line(i, (l) => ({ ...l, netMinor: l.netMinor - 1n }))],
    ["the fees do not sum to the batch's fees", (i) => line(i, (l) => ({ ...l, feeMinor: l.feeMinor + 1n, netMinor: l.netMinor - 1n }))],
    ["another currency", (i) => line(i, (l) => ({ ...l, currency: "USD" }))],
    ["the line names another order", (i) => line(i, (l) => ({ ...l, orderId: "BK-OTHER" }))],
    ["the provider record names another batch", (i) => ({ ...i, providerRecords: i.providerRecords.map((r) => ({ ...r, batchId: "B-ELSEWHERE" })), batches: [...i.batches, { ...i.batches[0], batchId: "B-ELSEWHERE" }] })],
    ["the same payment twice in the batch", (i) => ({ ...i, settlementPaymentLines: [...i.settlementPaymentLines!, ...i.settlementPaymentLines!] })],
    ["the bank credit is one cent off", (i) => ({ ...i, bankLines: i.bankLines.map((b) => ({ ...b, amountMinor: b.amountMinor - 1n })) })],
  ];
  for (const [why, f] of cases) it(why, () => {
    const i = f(perPayment());
    expect(reconcile(i).records.find((x) => x.orderId === ORDER)!.explanation.decision, why).not.toMatch(/^matched/);
  });
  it("a line naming a payment that is in another batch's lines: both batches untied", () => {
    const i = perPayment();
    const x = { ...i, batches: [...i.batches, { ...i.batches[0], batchId: "B-PP2" }], settlementPaymentLines: [...i.settlementPaymentLines!, { ...i.settlementPaymentLines![0], batchId: "B-PP2" }] };
    const r = reconcile(x);
    expect(r.bridges.filter((b) => b.batchId.startsWith("B-PP")).map((b) => b.tied)).toEqual([false, false]);
    expect(r.records[0].explanation.decision).not.toMatch(/^matched/);
  });
});

describe("never by amount alone", () => {
  it("a line with the exact amounts but another payment's ID links nothing: the payment stays unbatched", () => {
    const i = line(perPayment(), (l) => ({ ...l, providerPaymentId: "PP-NOT-THIS-ONE" }));
    expect(verdict(i)).not.toMatch(/^matched/);
    expect(bridge(i).paymentIds).toEqual([]);
  });
  it("a line naming a batch that is not in the settlement report links nothing (review, not closed)", () => {
    const i = line(perPayment(), (l) => ({ ...l, batchId: "B-UNKNOWN" }));
    expect(verdict(i)).not.toMatch(/^matched/);
  });
  it("the step-4 decision still decides first: a payment one cent short is not closed by a tied batch", () => {
    const i = perPayment();
    const x = { ...i, invoices: i.invoices.map((v) => ({ ...v, amountMinor: v.amountMinor + 1n })) };
    expect(verdict(x)).toBe("suggested_for_review M3.quote.terms_unknown");
  });
  it("input order never changes the result", () => {
    const i = perPayment();
    const rev = { ...i, settlementPaymentLines: [...i.settlementPaymentLines!].reverse(), batches: [...i.batches].reverse() };
    expect(reconcile(rev)).toEqual(reconcile(i));
  });
});
