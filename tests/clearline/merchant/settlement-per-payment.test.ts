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

/**
 * v1 #174: refund rows in a per-payment settlement file. A refund row (kind "refund") names the ORIGINAL payment by its
 * provider payment ID and its own refund ID; by convention its gross and net are negative (the money returned) and its
 * fee 0. A batch with refunds ties only when gross − fees − refunds = net exactly, every refund row is valid and the net
 * equals the bank line. A refund row never links a payment to a batch and never closes a payment by its amount.
 */
const REFUND = 2000n;
const PRIOR = "PP-PRIOR-FICTIONAL";
/** B-PP also nets a refund of SGD 20.00 for an earlier payment (PP-PRIOR-FICTIONAL, credited SGD 50.00, settled before). */
function withRefund(opts: { bank?: "bank_feed" | "csv_import"; row?: Partial<SettlementPaymentLine> | null } = {}): ReconcileInput {
  const i = perPayment({ bank: opts.bank });
  const prior = { ...i.providerRecords[0], providerPaymentId: PRIOR, ref: { quoteId: "Q-PRIOR-FICTIONAL" }, creditedMinor: 5000n, receivedBaseUnits: 1n, batchId: undefined, transferRef: undefined };
  const b = { ...i.batches[0], refundsMinor: REFUND, netMinor: i.batches[0].netMinor - REFUND };
  const refund: SettlementPaymentLine = { batchId: "B-PP", kind: "refund", refundId: "RF-FICTIONAL-1", providerPaymentId: PRIOR, currency: "SGD", grossMinor: -REFUND, feeMinor: 0n, netMinor: -REFUND, ...(opts.row ?? {}) };
  return {
    ...i, providerRecords: [...i.providerRecords, prior], batches: [b],
    bankLines: i.bankLines.map((l) => ({ ...l, amountMinor: b.netMinor })),
    settlementPaymentLines: [...i.settlementPaymentLines!, ...(opts.row === null ? [] : [refund])],
  };
}

describe("#174 refund rows: a batch with refunds ties only when every row adds up exactly", () => {
  it("gross − fee − refunds = net = the bank line, the refund valid: tied; the exact payment closes (bank feed)", () => {
    const i = withRefund();
    const br = bridge(i);
    expect(br).toMatchObject({ tied: true, settlementVerified: true, checks: { perPaymentLines: true, linesEqualGross: true, grossLessFeesRefundsEqualsNet: true, netEqualsBankLine: true } });
    expect(br.lines.find((l) => l.kind === "refund_netted")).toMatchObject({ amountMinor: -REFUND, paymentIds: ["RF-FICTIONAL-1"] });
    expect(br.paymentIds).toEqual([i.providerRecords[0].providerPaymentId]);
    expect(verdict(i)).toBe("matched M5.batch.tied_verified");
  });
  it("imported bank line: still never verified with the flag off", () => {
    expect(verdict(withRefund({ bank: "csv_import" }))).toBe("suggested_for_review M5.bank.imported_not_verified");
  });
  it("before #174: the same batch without the refund row cannot tie (the refund is unnamed): not matched", () => {
    const i = withRefund({ row: null });
    expect(bridge(i).tied).toBe(false);
    expect(verdict(i)).not.toMatch(/^matched/);
  });
  const bad: [string, Partial<SettlementPaymentLine>][] = [
    ["names an unknown payment", { providerPaymentId: "PP-UNKNOWN" }],
    ["another currency", { currency: "USD" }],
    ["more than the original payment", { grossMinor: -5001n, netMinor: -5001n }],
    ["a positive amount (sign convention)", { grossMinor: REFUND, netMinor: REFUND }],
    ["a fee on a refund row", { feeMinor: 1n, netMinor: -REFUND - 1n }],
    ["net ≠ gross", { netMinor: -REFUND + 1n }],
    ["no refund ID", { refundId: undefined }],
    ["one cent off the batch's refunds", { grossMinor: -REFUND + 1n, netMinor: -REFUND + 1n }],
    ["names another order than its payment's", { orderId: "BK-OTHER" }],
  ];
  for (const [why, row] of bad) it(`an invalid refund row leaves the batch untied: ${why}`, () => {
    const i = withRefund({ row });
    expect(bridge(i).tied, why).toBe(false);
    expect(verdict(i), why).not.toMatch(/^matched/);
  });
  it("the same refund ID twice: untied", () => {
    const i = withRefund();
    const r = i.settlementPaymentLines!.find((l) => l.kind === "refund")!;
    const half = { ...r, grossMinor: -REFUND / 2n, netMinor: -REFUND / 2n };
    expect(bridge({ ...i, settlementPaymentLines: [...i.settlementPaymentLines!.filter((l) => l.kind !== "refund"), half, half] }).tied).toBe(false);
  });
  it("two refunds of one payment together above its credit: untied", () => {
    const i = withRefund();
    const r = i.settlementPaymentLines!.find((l) => l.kind === "refund")!;
    const big = { ...r, refundId: "RF-FICTIONAL-2", grossMinor: -4000n, netMinor: -4000n };
    const b = { ...i.batches[0], refundsMinor: REFUND + 4000n, netMinor: i.batches[0].netMinor - 4000n };
    expect(bridge({ ...i, batches: [b], bankLines: i.bankLines.map((l) => ({ ...l, amountMinor: b.netMinor })), settlementPaymentLines: [...i.settlementPaymentLines!, big] }).tied).toBe(false);
  });
});

describe("#174 refund rows never close or link a payment by amount", () => {
  it("a refund of the order's own payment: the batch may tie, the order is never closed automatically", () => {
    const i = withRefund({ row: { providerPaymentId: perPayment().providerRecords[0].providerPaymentId } });
    expect(bridge(i).tied).toBe(true);
    // decision 1 declines it ("a refund is recorded for this order") and the missing quote terms send it to review
    expect(verdict(i)).toBe("suggested_for_review M3.quote.terms_unknown");
    expect(reconcile(i).records.find((x) => x.orderId === ORDER)!.explanation.history.some((h) => /a refund is recorded for this order/.test(h.detail))).toBe(true);
    // without the refund row the same order closes: the refund row is what stops it
    expect(verdict(perPayment())).toBe("matched M5.batch.tied_verified");
  });
  it("a refund row alone never puts its payment in the batch", () => {
    const i = withRefund();
    const onlyRefund = { ...i, settlementPaymentLines: i.settlementPaymentLines!.filter((l) => l.kind === "refund") };
    expect(bridge(onlyRefund).paymentIds).toEqual([]);
    expect(verdict(onlyRefund)).not.toMatch(/^matched/);
  });
  it("input order never changes the result", () => {
    const i = withRefund();
    expect(reconcile({ ...i, settlementPaymentLines: [...i.settlementPaymentLines!].reverse(), providerRecords: [...i.providerRecords].reverse() })).toEqual(reconcile(i));
  });
});
