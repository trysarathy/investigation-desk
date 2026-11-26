/**
 * v1 founder decision 9: period-end revaluation of other-currency balances (receivable from the provider / provider
 * clearing) at the closing rate. Proposals only (pending the founder's sign-off of the FX posting rules); no rate or an
 * unknown carrying value: "needs a rate", no entry, never 0. Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { CASE2_SG } from "@/lib/clearline/merchant/fixtures/case2";
import { minor } from "@/lib/clearline/merchant/fixtures/common";
import { FX_SIGN_OFF, proposeRevaluations, type ForeignBalance } from "@/lib/clearline/merchant/revaluation";
import type { FiatRate } from "@/lib/clearline/merchant/types";

const RATE = (rate: string, asOf: string, source = "Fictional Rate Desk"): FiatRate => ({ pair: "USD/SGD", rate, asOf, source });

describe("period-end revaluation (proposals only, pending sign-off)", () => {
  const bal = (foreign: string, carrying: string | null, ref = "provider-p-usd"): ForeignBalance => ({ account: "provider_clearing", currency: "USD", foreignMinor: minor(foreign), carryingMinor: carrying === null ? null : minor(carrying), ref });
  const END = "2026-11-30";
  const atEnd = [RATE("1.3600", "2026-11-30T09:00:00.000Z")];
  it("a USD receivable worth more SGD at the closing rate: Dr Provider clearing / Cr Unrealised FX gain, balanced, proposed only", () => {
    const { items, proposals } = proposeRevaluations(CASE2_SG, END, [bal("1000.00", "1350.00")], atEnd);
    expect(items).toMatchObject([{ status: "proposed", differenceMinor: minor("10.00") }]);
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p).toMatchObject({ kind: "fx_revaluation", status: "proposed", postingRuleStatus: "pending_sign_off", ruleId: "J.revaluation.period_end", currency: "SGD", entryDate: END, requiresApprovalOf: FX_SIGN_OFF });
    expect(p.lines).toEqual([{ side: "debit", account: "provider_clearing", amountMinor: minor("10.00") }, { side: "credit", account: "unrealised_fx", amountMinor: minor("10.00") }]);
    expect(p.memo).toMatch(/Unrealised gain SGD 10\.00/);
  });
  it("worth less: Dr Unrealised FX loss / Cr Provider clearing; a credit balance is revalued the same way", () => {
    const loss = proposeRevaluations(CASE2_SG, END, [bal("1000.00", "1365.00")], atEnd).proposals[0];
    expect(loss.lines).toEqual([{ side: "debit", account: "unrealised_fx", amountMinor: minor("5.00") }, { side: "credit", account: "provider_clearing", amountMinor: minor("5.00") }]);
    const credit = proposeRevaluations(CASE2_SG, END, [bal("-1000.00", "-1350.00")], atEnd).proposals[0];
    expect(credit.lines).toEqual([{ side: "debit", account: "unrealised_fx", amountMinor: minor("10.00") }, { side: "credit", account: "provider_clearing", amountMinor: minor("10.00") }]);
    expect(credit.memo).toMatch(/Unrealised loss/);
  });
  it("needs a rate: none in the 24 h before the period's end, disagreeing rates, or an unknown carrying value; no entry and never 0", () => {
    for (const rates of [[], [RATE("1.3600", "2026-11-29T15:00:00.000Z")], [RATE("1.3600", "2026-11-30T09:00:00.000Z", "A"), RATE("1.3700", "2026-11-30T09:00:00.000Z", "B")]]) {
      const r = proposeRevaluations(CASE2_SG, END, [bal("1000.00", "1350.00")], rates);
      expect(r.proposals).toEqual([]);
      expect(r.items).toMatchObject([{ status: "needs_rate" }]);
    }
    const unknown = proposeRevaluations(CASE2_SG, END, [bal("1000.00", null)], atEnd);
    expect([unknown.proposals, unknown.items[0].status]).toEqual([[], "needs_rate"]);
    // a rate after the period's end (1 Dec 00:00 SGT) is not the closing rate
    expect(proposeRevaluations(CASE2_SG, END, [bal("1000.00", "1350.00")], [RATE("1.3600", "2026-11-30T16:00:00.000Z")]).items[0].status).toBe("needs_rate");
  });
  it("no difference: no entry; an entity-currency balance is refused", () => {
    expect(proposeRevaluations(CASE2_SG, END, [bal("1000.00", "1360.00")], atEnd)).toMatchObject({ proposals: [], items: [{ status: "no_difference" }] });
    expect(() => proposeRevaluations(CASE2_SG, END, [{ ...bal("1.00", "1.00"), currency: "SGD" }], atEnd)).toThrow(/not an other-currency balance/);
  });
});

