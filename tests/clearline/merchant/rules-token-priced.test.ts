/**
 * v1 Phase 0 (approval-only draft): invoices priced directly in a token (M4.exact.token_priced). A token-priced invoice
 * closes ONLY under decision 1's conditions, with the token in place of the fiat credit: linked by reference, one final
 * chain_client transfer on the configured contract of exactly the invoice's token on its network, one provider record
 * by the order's own reference, paid, and received = the invoice's token amount to the base unit. Any difference (one
 * base unit, another token, another network) goes to review with a typed difference; an amount never closes on its own.
 * The fiat value comes only from a recorded rate. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { proposeJournals, reconcile, toFiatMinor, type ChainTransfer, type ProviderPaymentRecord, type ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { depositAddress, USDC, USDT } from "@/lib/clearline/merchant/fixtures/common";
import { USDT_TRON } from "@/lib/clearline/merchant/config";
import { shuffleInput, only } from "./helpers";

const ORDER = "BK-24817";

/** As in rules-exact-no-terms.test.ts: case 1's BK-24817 alone, exact, no quote terms, no settlement files. */
function exactNoTerms(): ReconcileInput {
  const base = only(case1(), [ORDER]);
  const t = base.transfers[0];
  const r = base.providerRecords[0];
  const credited = toFiatMinor(t.amountBaseUnits, t.decimals, r.executedRate, "SGD");
  const { batchId: _drop, transferRef: _ref, ...unbatched } = r;
  void _drop; void _ref;
  return {
    ...base, batches: [], batchLines: [], bankLines: [],
    invoices: base.invoices.map((i) => ({ ...i, amountMinor: credited })),
    quotes: base.quotes.map((q) => ({ ...q, unknown: ["quoted_amount", "rate", "window"] as const })),
    transfers: base.transfers.map((x) => ({ ...x, source: "chain_client" as const })),
    providerRecords: [{ ...unbatched, statusClaim: "paid", receivedBaseUnits: t.amountBaseUnits, creditedMinor: credited, creditedCurrency: "SGD" }],
  };
}

/** Case 1's BK-24817, exact and linked by reference, its invoice priced as the token amount it was paid with. */
export function tokenPriced(): ReconcileInput {
  const base = exactNoTerms();
  const t = base.transfers[0];
  return { ...base, invoices: base.invoices.map((i) => ({ ...i, amountMinor: 0n, price: { token: USDT, baseUnits: t.amountBaseUnits } })) };
}
const rec = (input: ReconcileInput) => reconcile(input).records.find((r) => r.orderId === ORDER)!;
const verdict = (input: ReconcileInput) => { const e = rec(input).explanation; return `${e.decision} ${e.ruleId}`; };
const withTransfer = (i: ReconcileInput, f: (t: ChainTransfer) => ChainTransfer): ReconcileInput => ({ ...i, transfers: i.transfers.map(f) });
const withRecord = (i: ReconcileInput, f: (r: ProviderPaymentRecord) => ProviderPaymentRecord): ReconcileInput => ({ ...i, providerRecords: i.providerRecords.map(f) });
const withPrice = (i: ReconcileInput, delta: bigint, token = USDT): ReconcileInput =>
  ({ ...i, invoices: i.invoices.map((x) => ({ ...x, price: { token, baseUnits: x.price!.baseUnits + delta } })) });
/** The transfer and the provider record both carry `units` (the provider agrees with the chain). */
const paid = (i: ReconcileInput, units: bigint) => withRecord(withTransfer(i, (t) => ({ ...t, amountBaseUnits: units })), (r) => ({ ...r, receivedBaseUnits: units }));

describe("[M4.exact.token_priced] an exact token payment linked by reference closes", () => {
  it("exact: matched at step 4 by the new rule, no difference, no write-off, fiat value from the recorded rate", () => {
    const i = tokenPriced();
    const r = rec(i);
    expect([r.explanation.decision, r.explanation.decidingStep, r.explanation.ruleId]).toEqual(["matched", 4, "M4.exact.token_priced"]);
    expect(r.explanation.differences).toEqual([]);
    expect(reconcile(i).writeOffs).toEqual([]);
    expect(r.ledger.balanceState).toBe("fully_credited");
    // case 1 records USDT/SGD 1.3500 (Fictional Rate Desk) at 02:00Z, before the 03:02Z transfer
    expect(r.ledger.fiatValue).toMatchObject({ status: "rated", pair: "USDT/SGD", rate: "1.3500", source: "Fictional Rate Desk" });
    expect(r.ledger.invoice.amountMinor).toBe((r.ledger.fiatValue as { amountMinor: bigint }).amountMinor);
  });
  it("no recorded rate: still matched for cash, the fiat value flagged as needing a rate (never invented)", () => {
    const i = { ...tokenPriced(), fxRates: [] };
    const r = rec(i);
    expect(verdict(i)).toBe("matched M4.exact.token_priced");
    expect(r.ledger.fiatValue).toMatchObject({ status: "needs_rate", pair: "USDT/SGD" });
    expect(r.ledger.invoice.amountMinor).toBe(0n);
    expect(r.explanation.history.some((h) => /fiat value needs a recorded rate/.test(h.detail))).toBe(true);
  });
  it("a rate recorded after the payment, older than 24 hours, or two disagreeing rates at one instant: needs a rate", () => {
    const at = (ts: string, rate = "1.3500", source = "Desk A") => ({ pair: "USDT/SGD", rate, source, timestamp: ts });
    const t = tokenPriced().transfers[0].timestamp;
    const later = new Date(Date.parse(t) + 60_000).toISOString(), old = new Date(Date.parse(t) - 25 * 3_600_000).toISOString(), near = new Date(Date.parse(t) - 60_000).toISOString();
    for (const fx of [[at(later)], [at(old)], [at(near, "1.3500"), at(near, "1.3600", "Desk B")]])
      expect(rec({ ...tokenPriced(), fxRates: fx }).ledger.fiatValue?.status).toBe("needs_rate");
    expect(rec({ ...tokenPriced(), fxRates: [at(near, "1.3500"), at(near, "1.35", "Desk B")] }).ledger.fiatValue?.status).toBe("rated");
  });
  it("a fiat-priced invoice is unchanged: no fiat value block, same rule", () => {
    const r = rec(exactNoTerms());
    expect(verdict(exactNoTerms())).toBe("matched M4.exact.no_quote_terms");
    expect(r.ledger.fiatValue).toBeUndefined();
  });
  it("input order never changes the result", () => {
    const base = JSON.stringify(rec(tokenPriced()).explanation, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const seed of [1, 7, 99]) expect(JSON.stringify(rec(shuffleInput(tokenPriced(), seed)).explanation, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(base);
  });
});

describe("any difference goes to review with a typed difference", () => {
  it("one base unit short or over: review, typed price_token_amount with the signed base units", () => {
    for (const delta of [-1n, 1n]) {
      const i = paid(tokenPriced(), tokenPriced().transfers[0].amountBaseUnits + delta);
      expect(verdict(i)).toBe("suggested_for_review M4.token_priced.amount_difference");
      const d = rec(i).explanation.differences;
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ type: "price_token_amount", ruleId: "M4.token_priced.amount_difference", token: { network: "tron", symbol: "USDT", baseUnits: delta } });
      expect(rec(i).ledger.balanceState).toBe(delta < 0n ? "short_paid" : "over_credited");
      expect(rec(i).attention?.owner).toBe("Payment Operations");
      expect(reconcile(i).writeOffs).toEqual([]);
    }
  });
  it("the price one base unit away from what was paid: review (the invoice side, same rule)", () => {
    expect(verdict(withPrice(tokenPriced(), 1n))).toBe("suggested_for_review M4.token_priced.amount_difference");
    expect(verdict(withPrice(tokenPriced(), -1n))).toBe("suggested_for_review M4.token_priced.amount_difference");
  });
  it("priced in another token (USDC on Ethereum), paid in USDT on TRON: review, typed price_token_mismatch", () => {
    const i = withPrice(tokenPriced(), 0n, USDC);
    expect(verdict(i)).toBe("suggested_for_review M4.token_priced.token_mismatch");
    const d = rec(i).explanation.differences;
    expect(d.map((x) => x.type)).toEqual(["price_token_mismatch", "price_token_amount"]);
    expect(d[0].token).toMatchObject({ network: "tron", contract: USDT_TRON, symbol: "USDT" });
  });
  it("same symbol and contract text on another network: a different token, review (never converted)", () => {
    const i = withPrice(tokenPriced(), 0n, { network: "ethereum", contract: USDT_TRON });
    expect(verdict(i)).toBe("suggested_for_review M4.token_priced.token_mismatch");
  });
  it("a lookalike contract never gets this far: the step 1 exception is kept", () => {
    const i = withTransfer(tokenPriced(), (t) => ({ ...t, tokenContract: "T_FICTIONAL_LOOKALIKE", claimedSymbol: "USDT" }));
    expect(verdict(i)).toBe("exception M1.identity.lookalike_token");
  });
});

describe("no reference, never closes: an amount equal to the price alone is not enough", () => {
  it("the exact amount to an address issued for no order: the order is never matched", () => {
    const i = withTransfer(tokenPriced(), (t) => ({ ...t, to: depositAddress(USDT, "STRAY") }));
    expect(rec(i).explanation.decision).not.toMatch(/^matched/);
    expect(verdict(i)).toBe("exception M2.reference.no_chain_transfer");
  });
  it("the provider record names another quote: exception, never matched", () => {
    const i = withRecord(tokenPriced(), (r) => ({ ...r, ref: { quoteId: "Q-OTHER" } }));
    expect(rec(i)?.explanation.decision ?? "none").not.toMatch(/^matched/);
  });
  it("each other condition removed: review, never matched", () => {
    const variants: [string, ReconcileInput][] = [
      ["recorded, not read from the chain", withTransfer(tokenPriced(), (t) => ({ ...t, source: "recorded_fixture" }))],
      ["no source", withTransfer(tokenPriced(), (t) => { const { source: _s, ...x } = t; void _s; return x; })],
      ["provider claims underpaid", withRecord(tokenPriced(), (r) => ({ ...r, statusClaim: "underpaid" }))],
      ["a second provider record for the order", { ...tokenPriced(), providerRecords: [...tokenPriced().providerRecords, { ...tokenPriced().providerRecords[0], providerPaymentId: "PP-SECOND", receivedBaseUnits: 1n, creditedMinor: 1n }] }],
      ["the quote's own amount differs from the price", { ...tokenPriced(), quotes: tokenPriced().quotes.map((q) => ({ ...q, quotedBaseUnits: q.quotedBaseUnits + 5n, unknown: ["rate", "window"] as const })) }],
      ["a refund for the order", { ...tokenPriced(), batchLines: [{ batchId: "B-R", kind: "refund", refundId: "RF-1", orderId: ORDER, amountMinor: 100n }] }],
    ];
    for (const [why, i] of variants) {
      const e = rec(i).explanation;
      expect(e.decision, why).not.toMatch(/^matched/);
      if (why !== "a second provider record for the order") expect(`${e.decision} ${e.ruleId}`, why).toBe("suggested_for_review M4.token_priced.not_exact");
    }
  });
  it("a pending (not final) transfer: not matched", () => {
    const i = withTransfer(tokenPriced(), (t) => ({ ...t, confirmations: 1 }));
    expect(rec(i).explanation.decision).not.toMatch(/^matched/);
  });
});

describe("step 5 still applies, and nothing is posted", () => {
  it("named transaction, no batch: only a proposed grouping (review)", () => {
    const i = withRecord(tokenPriced(), (r) => ({ ...r, transferRef: { network: "tron", txHash: tokenPriced().transfers[0].txHash, logIndex: tokenPriced().transfers[0].logIndex } }));
    expect(verdict(i)).toBe("suggested_for_review M5.grouping.proposed_needs_confirmation");
  });
  it("no journal proposal is made for a token-priced order (FX accounting is pending sign-off)", () => {
    const i = tokenPriced();
    expect(proposeJournals(i, reconcile(i)).filter((j) => j.evidence.orderIds.includes(ORDER))).toEqual([]);
  });
});
