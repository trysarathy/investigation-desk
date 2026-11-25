/**
 * v1 (#173): a token-priced invoice without a recorded rate shows "needs a rate" on every surface, never 0. The helpers
 * every surface uses, and the engine's record they read. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/clearline/merchant";
import { NEEDS_A_RATE, differenceNeedsRate, fiatOrNeedsRate, ledgerWire, minorOrNull, needsRate, unknownFiat } from "@/lib/clearline/merchant/fiat-value";
import { tokenPriced } from "./rules-token-priced.test";

const ledger = (balanceState: string, status: "rated" | "needs_rate" | null) => ({
  invoice: { amountMinor: "0" }, openBalanceMinor: "0", customerOverpaymentMinor: "0", balanceState,
  ...(status ? { fiatValue: { status } } : {}),
});

describe("fiat-value helpers", () => {
  it("a fiat-priced or rated ledger: nothing is unknown, amounts unchanged", () => {
    for (const l of [ledger("short_paid", null), ledger("short_paid", "rated")]) {
      expect(needsRate(l)).toBe(false);
      expect(unknownFiat(l)).toEqual({ invoice: false, open: false, overpaid: false });
      expect(ledgerWire({ ...l, openBalanceMinor: "500" })).toMatchObject({ invoice: { amountMinor: "0" }, openBalanceMinor: "500" });
      expect(differenceNeedsRate("price_token_amount", l)).toBe(false);
    }
    expect(ledgerWire(ledger("fully_credited", null))).not.toHaveProperty("fiatValueStatus");
  });
  it("needs a rate: the invoice value is unknown; the open balance unless the token price was received in full", () => {
    expect(unknownFiat(ledger("fully_credited", "needs_rate"))).toEqual({ invoice: true, open: false, overpaid: false });
    for (const st of ["nothing_received", "part_paid", "short_paid"]) expect(unknownFiat(ledger(st, "needs_rate"))).toEqual({ invoice: true, open: true, overpaid: false });
    expect(unknownFiat(ledger("over_credited", "needs_rate"))).toEqual({ invoice: true, open: false, overpaid: true });
    expect(ledgerWire(ledger("short_paid", "needs_rate"))).toMatchObject({ fiatValueStatus: "needs_rate", invoice: { amountMinor: null }, openBalanceMinor: null, customerOverpaymentMinor: "0" });
    expect(ledgerWire(ledger("over_credited", "needs_rate"))).toMatchObject({ openBalanceMinor: "0", customerOverpaymentMinor: null });
  });
  it("differences: another token is never valued; a token-amount difference needs a rate only without one", () => {
    expect(differenceNeedsRate("price_token_mismatch", ledger("short_paid", "rated"))).toBe(true);
    expect(differenceNeedsRate("price_token_amount", ledger("short_paid", "needs_rate"))).toBe(true);
    expect(differenceNeedsRate("underpayment", ledger("short_paid", "needs_rate"))).toBe(false);
  });
  it("display and wire forms", () => {
    expect(fiatOrNeedsRate(true, () => "SGD 0.00")).toBe(NEEDS_A_RATE);
    expect(fiatOrNeedsRate(false, () => "SGD 0.00")).toBe("SGD 0.00");
    expect([minorOrNull(true, 0n), minorOrNull(false, 0n)]).toEqual([null, "0"]);
  });
  it("on the engine's own record: one base unit short without a rate leaves every fiat amount unknown", () => {
    const i = { ...tokenPriced(), fxRates: [] };
    const short = { ...i, invoices: i.invoices.map((x) => ({ ...x, price: { ...x.price!, baseUnits: x.price!.baseUnits + 1n } })) };
    const r = reconcile(short).records.find((x) => x.orderId === "BK-24817")!;
    expect(r.ledger.fiatValue?.status).toBe("needs_rate");
    expect(unknownFiat(r.ledger)).toEqual({ invoice: true, open: true, overpaid: false });
    expect(r.explanation.differences.every((d) => differenceNeedsRate(d.type, r.ledger))).toBe(true);
  });
});
