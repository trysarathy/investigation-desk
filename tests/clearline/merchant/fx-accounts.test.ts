/**
 * v1 founder decision 9: other-currency bank accounts under an entity (a USD account under an SGD entity). The tie is
 * evaluated in the account's currency; a currency mismatch is an exception; a recorded rate only SHOWS the entity
 * value ("needs a rate" otherwise, never 0). Revaluation: revaluation.test.ts. Fictional data only.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { CASE2_SG, case2Sgd, case2Usd } from "@/lib/clearline/merchant/fixtures/case2";
import { minor } from "@/lib/clearline/merchant/fixtures/common";
import { FIAT_RATE_MAX_AGE_MS, convertMinor, endOfLocalDay, valueIn } from "@/lib/clearline/merchant/fx";
import { LocalStandInRateSource, parseFiatPair, validRate } from "@/lib/clearline/fx/rate-source";
import type { FiatRate, ReconcileInput } from "@/lib/clearline/merchant/types";

const { reconcile, proposeJournals } = merchant;
const RATE = (rate: string, asOf: string, source = "Fictional Rate Desk"): FiatRate => ({ pair: "USD/SGD", rate, asOf, source });
const BANK_DAY_END = "2026-11-26T15:59:59.999Z"; // end of 26 Nov in SGT (the USD bank line's value date)

/** Case 2's USD payments and batch moved under the SGD entity (a USD bank account of ENT-SG-02); records state USD. */
function usdUnderSgd(extra: Partial<ReconcileInput> = {}): ReconcileInput {
  const u = case2Usd();
  return {
    ...u, entity: CASE2_SG, invoices: u.invoices.map((i) => ({ ...i, entityId: CASE2_SG.id })),
    providerRecords: u.providerRecords.map((r) => ({ ...r, creditedCurrency: "USD" as const })), ...extra,
  };
}
const bridgeOf = (input: ReconcileInput) => reconcile(input).bridges.find((b) => b.batchId === "B-1125-USD")!;

describe("fx arithmetic (exact, half-up)", () => {
  it("converts minor units across currencies with their decimals", () => {
    expect(convertMinor(minor("9355.50"), "USD", "SGD", "1.3500")).toBe(minor("12629.93")); // 12,629.925 → half-up
    expect(convertMinor(minor("100.00"), "USD", "AED", "3.6725")).toBe(minor("367.25"));
    expect(convertMinor(-minor("100.00"), "USD", "SGD", "1.3333")).toBe(-minor("133.33"));
  });
  it("the end of a local day at a fixed offset", () => {
    expect(endOfLocalDay("2026-11-26", 480)).toBe(BANK_DAY_END);
    expect(endOfLocalDay("2026-11-26", 0)).toBe("2026-11-26T23:59:59.999Z");
  });
  it("a rate at or before the instant, no more than 24 h older; otherwise needs a rate (never 0)", () => {
    const at = BANK_DAY_END;
    expect(valueIn(minor("100.00"), "USD", "SGD", [RATE("1.3500", "2026-11-26T08:00:00.000Z")], at)).toMatchObject({ status: "rated", amountMinor: minor("135.00"), rate: "1.3500" });
    const tooOld = new Date(Date.parse(at) - FIAT_RATE_MAX_AGE_MS - 1).toISOString();
    for (const rates of [[], [RATE("1.3500", tooOld)], [RATE("1.3500", "2026-11-26T16:00:00.000Z")], [{ ...RATE("1.3500", "2026-11-26T08:00:00.000Z"), pair: "AED/SGD" }]]) {
      const v = valueIn(minor("100.00"), "USD", "SGD", rates, at);
      expect(v.status).toBe("needs_rate");
      expect(v).not.toHaveProperty("amountMinor");
    }
    const edge = new Date(Date.parse(at) - FIAT_RATE_MAX_AGE_MS).toISOString();
    expect(valueIn(minor("100.00"), "USD", "SGD", [RATE("1.3400", edge)], at).status).toBe("rated");
  });
  it("the latest usable rate wins; two sources disagreeing at that instant need a rate (Clearline does not choose)", () => {
    const at = BANK_DAY_END;
    expect(valueIn(minor("100.00"), "USD", "SGD", [RATE("1.3400", "2026-11-26T01:00:00.000Z"), RATE("1.3500", "2026-11-26T08:00:00.000Z")], at)).toMatchObject({ rate: "1.3500" });
    expect(valueIn(minor("100.00"), "USD", "SGD", [RATE("1.3500", "2026-11-26T08:00:00.000Z", "A"), RATE("1.3501", "2026-11-26T08:00:00.000Z", "B")], at)).toMatchObject({ status: "needs_rate" });
    expect(valueIn(minor("100.00"), "USD", "SGD", [RATE("1.35", "2026-11-26T08:00:00.000Z", "A"), RATE("1.3500", "2026-11-26T08:00:00.000Z", "B")], at)).toMatchObject({ status: "rated", source: "A" });
  });
});

describe("a USD account under the SGD entity: the batch tie in USD", () => {
  it("ties in USD exactly as in its own book; the SGD value is shown from the recorded rate and decides nothing", () => {
    const own = reconcile(case2Usd()).bridges.find((b) => b.batchId === "B-1125-USD")!;
    const b = bridgeOf(usdUnderSgd({ fiatRates: [RATE("1.3500", "2026-11-26T00:30:00.000Z")] }));
    expect(b.currency).toBe("USD");
    expect(b.lines.map((l) => [l.kind, l.amountMinor])).toEqual(own.lines.map((l) => [l.kind, l.amountMinor]));
    expect(b.checks).toMatchObject({ ...own.checks, currencyAgrees: true });
    expect(b.tied).toBe(true);
    expect(b.entityValue).toEqual({ status: "rated", amountMinor: minor("12629.93"), currency: "SGD", pair: "USD/SGD", rate: "1.3500", asOf: "2026-11-26T00:30:00.000Z", source: "Fictional Rate Desk" });
    // the same batch without any recorded rate: same tie, the SGD value needs a rate
    const none = bridgeOf(usdUnderSgd());
    expect(none.tied).toBe(true);
    expect(none.entityValue).toMatchObject({ status: "needs_rate", pair: "USD/SGD", currency: "SGD" });
  });
  it("payment level is not loosened: a USD invoice under the SGD entity still stops at M3.currency.invoice_currency", () => {
    const r = reconcile(usdUnderSgd({ fiatRates: [RATE("1.3500", "2026-11-26T00:30:00.000Z")] }));
    expect(r.records.length).toBeGreaterThan(0);
    for (const rec of r.records) expect([rec.explanation.decision, rec.explanation.ruleId]).toEqual(["exception", "M3.currency.invoice_currency"]);
  });
  it("no settlement entry is proposed for a batch in another currency (FX posting rules pending sign-off)", () => {
    const input = usdUnderSgd({ fiatRates: [RATE("1.3500", "2026-11-26T00:30:00.000Z")] });
    expect(proposeJournals(input, reconcile(input)).filter((j) => j.kind === "settlement")).toEqual([]);
  });
});

describe("matching never loosens: currency mismatch is an exception, conversion never ties, an amount alone never matches", () => {
  it("a bank line naming the USD batch in SGD (even at exactly net × rate) is a mismatch, never a tie", () => {
    const input = usdUnderSgd({ fiatRates: [RATE("1.3500", "2026-11-26T00:30:00.000Z")] });
    const converted = { ...input.bankLines[0], account: "USD-OPS-FICT-002", currency: "SGD" as const, amountMinor: minor("12629.93") };
    const b = bridgeOf({ ...input, bankLines: [converted] });
    expect(b.checks.currencyAgrees).toBe(false);
    expect(b.checks.netEqualsBankLine).toBe(false);
    expect(b.tied).toBe(false);
    expect(b.bankLineId).toBeNull();
  });
  it("a payment stated in SGD inside the USD batch makes it a mismatch (records without a currency are not assumed USD)", () => {
    const input = usdUnderSgd();
    const b = bridgeOf({ ...input, providerRecords: input.providerRecords.map((r, i) => (i === 0 ? { ...r, creditedCurrency: "SGD" as const } : r)) });
    expect([b.checks.currencyAgrees, b.tied]).toEqual([false, false]);
    const unstated = bridgeOf({ ...input, providerRecords: input.providerRecords.map((r) => { const c = { ...r }; delete c.creditedCurrency; return c; }) });
    expect([unstated.checks.currencyAgrees, unstated.tied]).toEqual([false, false]);
  });
  it("a USD credit of exactly the net but naming no batch is never this batch's bank line", () => {
    const input = usdUnderSgd();
    const b = bridgeOf({ ...input, bankLines: [{ ...input.bankLines[0], description: "Fictional incoming transfer" }] });
    expect([b.bankLineId, b.tied, b.checks.netEqualsBankLine]).toEqual([null, false, false]);
  });
  it("an entity-currency batch whose bank line is in another currency: the payments that would match become exceptions (M5.batch.currency_mismatch)", () => {
    const sgd = case2Sgd();
    const before = reconcile(sgd).records.filter((r) => r.provider.records.some((p) => p.batchId === "B-1124-SGD"));
    expect(before.some((r) => r.explanation.decision === "matched")).toBe(true);
    const bad = { ...sgd, bankLines: sgd.bankLines.map((l) => (l.description.includes("B-1124-SGD") ? { ...l, currency: "USD" as const } : l)) };
    const r = reconcile(bad);
    const after = r.records.filter((x) => x.provider.records.some((p) => p.batchId === "B-1124-SGD"));
    expect(after.length).toBe(before.length);
    for (const rec of after.filter((x) => before.find((y) => y.orderId === x.orderId)!.explanation.decision === "matched")) {
      expect([rec.explanation.decision, rec.explanation.ruleId]).toEqual(["exception", "M5.batch.currency_mismatch"]);
      expect(rec.attention).toMatchObject({ owner: "Payment Operations" });
      expect(r.exceptions.some((e) => e.orderId === rec.orderId && e.ruleId === "M5.batch.currency_mismatch")).toBe(true);
    }
    // the other SGD batch is untouched
    expect(r.bridges.find((b) => b.batchId === "B-1125-SGD")!.tied).toBe(reconcile(sgd).bridges.find((b) => b.batchId === "B-1125-SGD")!.tied);
  });
  it("entity-currency batches carry no currency check and no entity value (the existing behaviour is unchanged)", () => {
    for (const b of reconcile(case2Sgd()).bridges) { expect(b.checks).not.toHaveProperty("currencyAgrees"); expect(b).not.toHaveProperty("entityValue"); }
  });
  it("unbatched payments are proposed per provider day AND currency, never grouped across currencies", () => {
    const input = usdUnderSgd();
    const recs = input.providerRecords.map((r, i) => { const c = { ...r, creditedCurrency: i === 0 ? ("SGD" as const) : ("USD" as const) }; delete c.batchId; return c; });
    const g = reconcile({ ...input, batches: [], batchLines: [], providerRecords: recs }).proposedGroupings;
    expect(g.map((x) => [x.id, x.currency, x.paymentIds.length])).toEqual([["PG-SGD-2026-11-25", "SGD", 1], ["PG-USD-2026-11-25", "USD", recs.length - 1]]);
  });
});

describe("rate source (pluggable, local stand-in only)", () => {
  it("answers only from its own table; never a guess", async () => {
    const src = new LocalStandInRateSource({ "USD/SGD": "1.3500", "XXX/SGD": "1", "USD/SGD ": "2" });
    expect(await src.quote("USD/SGD", new Date("2026-11-30T09:00:00Z"))).toEqual({ pair: "USD/SGD", rate: "1.3500", asOf: new Date("2026-11-30T09:00:00Z"), sourceLabel: "Local stand-in (fictional rates)" });
    expect(await src.quote("AED/SGD", new Date())).toBeNull();
    expect(await src.quote("XXX/SGD", new Date())).toBeNull();
  });
  it("pairs and rates are validated", () => {
    expect(parseFiatPair("USD/SGD")).toEqual({ base: "USD", quote: "SGD" });
    for (const p of ["USD/USD", "usd/sgd", "EUR/SGD", "USDSGD", "USDT/SGD"]) expect(parseFiatPair(p), p).toBeNull();
    for (const r of ["0", "0.0", "-1", "1e3", "1.12345678901", "abc", ""]) expect(validRate(r), r).toBeNull();
    expect(validRate("1.3500")).toBe("1.3500");
  });
});
