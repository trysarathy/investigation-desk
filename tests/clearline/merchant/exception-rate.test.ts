/**
 * v1 phase 0: "exceptions per 100", one definition (src/lib/clearline/merchant/exception-rate.ts): still-open
 * exceptions per 100 reconciled payments (evaluated by a run, unpaid orders excluded), batch not tied apart, and a
 * zero denominator reads "not measured", never 0. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import {
  BATCH_NOT_TIED_RULE, addExceptionRateCounts, exceptionRate, exceptionRateCounts, per100, rateText, type RateException, type RatePayment,
} from "@/lib/clearline/merchant/exception-rate";

const pay = (orderId: string, ruleId = "M2.reference.exact", creditedMinor: string | number = "1000"): RatePayment => ({ orderId, ruleId, creditedMinor });
const ex = (orderId: string | null, status = "open"): RateException => ({ orderId, status });

describe("per100", () => {
  it("is n per 100 of d to one decimal, half up", () => {
    expect(per100(3, 46)).toBe(6.5);
    expect(per100(1, 16)).toBe(6.3); // 6.25 rounds up
    expect(per100(1, 8)).toBe(12.5);
    expect(per100(0, 10)).toBe(0);
    expect(per100(10, 10)).toBe(100);
    expect(per100(1, 3)).toBe(33.3);
  });
  it("a zero denominator is not measured (null), never 0", () => {
    expect(per100(0, 0)).toBeNull();
    expect(per100(5, 0)).toBeNull();
    expect(rateText(null)).toBe("Not measured");
    expect(rateText(0)).toBe("0");
  });
  it("refuses fractional or negative counts", () => {
    expect(() => per100(-1, 4)).toThrow(RangeError);
    expect(() => per100(1.5, 4)).toThrow(RangeError);
    expect(() => per100(1, -4)).toThrow(RangeError);
  });
});

describe("exceptionRateCounts", () => {
  it("counts reconciled payments, excluding unpaid orders (nothing credited)", () => {
    const c = exceptionRateCounts([pay("A"), pay("B"), pay("C", "M3.finality.pending", "0"), pay("D", "M2.reference.exact", 0n as unknown as string)], []);
    expect(c.reconciledPayments).toBe(2);
  });
  it("counts only still-open exceptions ('open' and 'in_review', not 'resolved')", () => {
    const c = exceptionRateCounts([pay("A"), pay("B"), pay("C")], [ex("A"), ex("B", "in_review"), ex("C", "resolved")]);
    expect(c).toMatchObject({ reconciledPayments: 3, openExceptions: 2 });
    expect(exceptionRate(c).per100).toBe(66.7);
  });
  it("batch not tied is counted apart, over the same payments, and not in the main rate", () => {
    const c = exceptionRateCounts([pay("A"), pay("B", BATCH_NOT_TIED_RULE), pay("C", BATCH_NOT_TIED_RULE), pay("D")], [ex("A"), ex("B"), ex("C", "resolved")]);
    expect(c).toEqual({ reconciledPayments: 4, openExceptions: 1, openBatchNotTied: 1, openOnUnpaid: 0, openWithoutPayment: 0 });
    expect(exceptionRate(c)).toMatchObject({ per100: 25, batchNotTiedPer100: 25 });
  });
  it("open exceptions on unpaid orders, or on no reconciled payment, are in neither rate", () => {
    const c = exceptionRateCounts([pay("A"), pay("U", "M3.finality.pending", "0")], [ex("U"), ex(null), ex("NEVER-EVALUATED"), ex("A")]);
    expect(c).toEqual({ reconciledPayments: 1, openExceptions: 1, openBatchNotTied: 0, openOnUnpaid: 1, openWithoutPayment: 2 });
    expect(exceptionRate(c).per100).toBe(100);
  });
  it("a payment listed twice is one payment (its decision counts once)", () => {
    expect(exceptionRateCounts([pay("A"), pay("A"), pay("B")], [ex("A")])).toMatchObject({ reconciledPayments: 2, openExceptions: 1 });
  });
  it("no reconciled payment: not measured, even with open exceptions elsewhere", () => {
    const r = exceptionRate(exceptionRateCounts([pay("U", "M3.finality.pending", "0")], [ex("U"), ex(null)]));
    expect(r).toMatchObject({ reconciledPayments: 0, per100: null, batchNotTiedPer100: null, openOnUnpaid: 1, openWithoutPayment: 1 });
    expect(exceptionRate(exceptionRateCounts([], [])).per100).toBeNull();
  });
  it("nothing open over reconciled payments is a measured 0", () => {
    expect(exceptionRate(exceptionRateCounts([pay("A")], [ex("A", "resolved")])).per100).toBe(0);
  });
});

describe("totals across merchants", () => {
  it("add the counts and recompute the rate (never an average of rates)", () => {
    const a = exceptionRateCounts([pay("A1")], [ex("A1")]); // 100 per 100
    const b = exceptionRateCounts(Array.from({ length: 9 }, (_, i) => pay(`B${i}`)), []); // 0 per 100
    const tot = exceptionRate(addExceptionRateCounts([a, b]));
    expect(tot).toMatchObject({ reconciledPayments: 10, openExceptions: 1, per100: 10 });
    expect(exceptionRate(addExceptionRateCounts([])).per100).toBeNull();
  });
});
