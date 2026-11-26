/**
 * rc8 founder decision 1 (M4.exact.no_quote_terms): an order whose quote terms are not in the files closes as matched
 * ONLY when every condition holds: (a) linked by reference (the transfer reached a deposit address issued for the
 * order, and the one provider record naming the order names that quote or link, and that transfer); (b) the transfer
 * is a final chain fact Clearline read itself (chain_client) on the configured contract of the order's token; (c) the
 * provider's credit equals the invoice exactly, in the same currency. Each condition removed → not matched, and the
 * existing outcome is kept. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { reconcile, toFiatMinor, type ChainTransfer, type ProviderPaymentRecord, type ReconcileInput } from "@/lib/clearline/merchant";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { depositAddress, USDT } from "@/lib/clearline/merchant/fixtures/common";
import { only } from "./helpers";

const ORDER = "BK-24817";
const NO_TERMS = ["quoted_amount", "rate", "window"] as const;

/**
 * Case 1's BK-24817 alone, made exact (credited = the invoice), with no quote terms and no settlement files. The
 * provider record names the order's quote (its payment reference), not a transaction, so step 5 has nothing to group.
 */
export function exactNoTerms(): ReconcileInput {
  const base = only(case1(), [ORDER]);
  const t = base.transfers[0];
  const rec = base.providerRecords[0];
  const credited = toFiatMinor(t.amountBaseUnits, t.decimals, rec.executedRate, "SGD");
  const { batchId: _drop, transferRef: _ref, ...unbatched } = rec;
  void _drop; void _ref;
  return {
    ...base, batches: [], batchLines: [], bankLines: [],
    invoices: base.invoices.map((i) => ({ ...i, amountMinor: credited })),
    quotes: base.quotes.map((q) => ({ ...q, unknown: NO_TERMS })),
    transfers: base.transfers.map((x) => ({ ...x, source: "chain_client" as const })),
    providerRecords: [{ ...unbatched, statusClaim: "paid", receivedBaseUnits: t.amountBaseUnits, creditedMinor: credited, creditedCurrency: "SGD" }],
  };
}
const rec = (input: ReconcileInput) => reconcile(input).records.find((r) => r.orderId === ORDER)!;
const verdict = (input: ReconcileInput) => { const e = rec(input).explanation; return `${e.decision} ${e.ruleId}`; };
const withTransfer = (i: ReconcileInput, f: (t: ChainTransfer) => ChainTransfer): ReconcileInput => ({ ...i, transfers: i.transfers.map(f) });
const withRecord = (i: ReconcileInput, f: (r: ProviderPaymentRecord) => ProviderPaymentRecord): ReconcileInput => ({ ...i, providerRecords: i.providerRecords.map(f) });
const ABSTAIN = "suggested_for_review M3.quote.terms_unknown";

describe("[M4.exact.no_quote_terms] an exact payment linked by reference closes without quote terms", () => {
  it("every condition holds: matched at step 4, no difference, no write-off, the reason recorded", () => {
    const r = rec(exactNoTerms());
    expect([r.explanation.decision, r.explanation.decidingStep, r.explanation.ruleId]).toEqual(["matched", 4, "M4.exact.no_quote_terms"]);
    expect(r.explanation.differences).toEqual([]);
    expect(r.attention).toBeUndefined();
    expect(r.ledger).toMatchObject({ balanceState: "fully_credited", openBalanceMinor: 0n, customerOverpaymentMinor: 0n });
    expect(r.explanation.history.find((h) => h.ruleId === "M4.exact.no_quote_terms")?.detail).toMatch(/exactly the invoice. No quote term is needed or assumed/);
    expect(reconcile(exactNoTerms()).writeOffs).toEqual([]);
  });
  it("with the quote terms known the existing rule decides, exactly as before", () => {
    const i = exactNoTerms();
    const x = { ...i, quotes: i.quotes.map((q) => { const { unknown: _u, ...rest } = q; void _u; return { ...rest, quotedBaseUnits: i.transfers[0].amountBaseUnits }; }) };
    expect(verdict(x)).toBe("matched M4.match.no_difference");
  });
  const named = (i: ReconcileInput) => withRecord(i, (r) => ({ ...r, transferRef: { network: i.transfers[0].network, txHash: i.transfers[0].txHash, logIndex: i.transfers[0].logIndex } }));
  it("a record that names the transaction too: in a tied, bank-fed batch, matched and settled (step 5)", () => {
    const c = only(case1(), [ORDER]);
    const i = named(exactNoTerms());
    const x: ReconcileInput = { ...withRecord(i, (r) => ({ ...r, batchId: c.batches[0].batchId })), batches: c.batches, bankLines: c.bankLines,
      batchLines: c.batchLines.map((l) => ({ ...l, amountMinor: i.invoices[0].amountMinor })) };
    const b = { ...x.batches[0], grossMinor: i.invoices[0].amountMinor, feesMinor: 0n, refundsMinor: 0n, netMinor: i.invoices[0].amountMinor };
    const y = { ...x, batches: [b], bankLines: x.bankLines.map((l) => ({ ...l, amountMinor: b.netMinor })) };
    expect(y.bankLines.every((l) => l.source === "bank_feed")).toBe(true);
    expect(verdict(y)).toBe("matched M5.batch.tied_verified");
    expect(rec(y).explanation.history.some((h) => h.ruleId === "M4.exact.no_quote_terms" && h.outcome === "pass")).toBe(true);
  });
  it("a record that names the transaction but no batch: step 5 only proposes a grouping (not closed)", () => {
    expect(verdict(named(exactNoTerms()))).toBe("suggested_for_review M5.grouping.proposed_needs_confirmation");
  });
  it("step 5 still applies: in a batch that does not tie, it is an exception", () => {
    const i = exactNoTerms();
    const x: ReconcileInput = { ...withRecord(i, (r) => ({ ...r, batchId: "B-X" })), batches: [{ ...case1().batches[0], batchId: "B-X", grossMinor: 1n, feesMinor: 0n, refundsMinor: 0n, netMinor: 1n }],
      batchLines: [{ batchId: "B-X", kind: "payment", providerPaymentId: i.providerRecords[0].providerPaymentId, orderId: ORDER, amountMinor: i.invoices[0].amountMinor }] };
    expect(verdict(x)).toBe("exception M5.batch.not_tied");
  });
});

describe("(a) linked by reference — removed → not matched", () => {
  it("a second provider record names the order (several candidates)", () => {
    const i = exactNoTerms();
    const dup = { ...i.providerRecords[0], providerPaymentId: "PP-DUP" };
    expect(verdict({ ...i, providerRecords: [...i.providerRecords, dup] })).toBe(ABSTAIN);
  });
  it("the transfer reached a payment link's address but the record names only the quote", () => {
    const i = exactNoTerms();
    const addr = depositAddress(USDT, "LINK-24817");
    const x: ReconcileInput = { ...withTransfer(i, (t) => ({ ...t, to: addr })),
      paymentLinks: [{ linkId: "PL-24817", orderId: ORDER, quoteId: i.quotes[0].quoteId, kind: "full", token: USDT, depositAddress: addr, requestedBaseUnits: 1n, createdAt: i.quotes[0].createdAt, expiresAt: i.quotes[0].expiresAt }] };
    expect(verdict(x)).toBe(ABSTAIN);
  });
  it("the same record naming that payment link closes (the link is the order's own reference)", () => {
    const i = exactNoTerms();
    const addr = depositAddress(USDT, "LINK-24817");
    const x: ReconcileInput = { ...withRecord(withTransfer(i, (t) => ({ ...t, to: addr })), (r) => ({ ...r, ref: { linkId: "PL-24817" } })),
      paymentLinks: [{ linkId: "PL-24817", orderId: ORDER, quoteId: i.quotes[0].quoteId, kind: "full", token: USDT, depositAddress: addr, requestedBaseUnits: 0n, requestedUnknown: true, createdAt: i.quotes[0].createdAt, expiresAt: i.quotes[0].expiresAt, windowUnknown: true }] };
    expect(verdict(x)).toBe("matched M4.exact.no_quote_terms");
  });
  it("the exact amount arrives at an address not issued for the order (amount only): never matched", () => {
    const x = withTransfer(exactNoTerms(), (t) => ({ ...t, to: depositAddress(USDT, "NOT-ISSUED") }));
    expect(verdict(x)).toBe("exception M2.reference.no_chain_transfer");
    expect(reconcile(x).exceptions.some((e) => e.ruleId === "M2.reference.unattributed")).toBe(true);
  });
  it("the record names another transaction", () => {
    const i = exactNoTerms();
    const x = withRecord(i, (r) => ({ ...r, transferRef: { network: i.transfers[0].network, txHash: "f".repeat(64), logIndex: 0 } }));
    expect(verdict(x)).toBe("exception M3.provider.no_record");
  });
  it("the record names another order's quote", () => {
    expect(verdict(withRecord(exactNoTerms(), (r) => ({ ...r, ref: { quoteId: "Q-OTHER" } })))).toBe("exception M3.provider.no_record");
  });
});

describe("(b) a final chain fact on the verified configured contract — removed → not matched", () => {
  for (const source of ["recorded_fixture", "seed_fictional", undefined] as const) {
    it(`the transfer is ${source ?? "not marked"} (not read by Clearline's chain client)`, () => {
      const x = withTransfer(exactNoTerms(), (t) => { const { source: _s, ...rest } = t; void _s; return source ? { ...rest, source } : rest; });
      expect(verdict(x)).toBe(ABSTAIN);
      expect(rec(x).explanation.history.find((h) => h.ruleId === "M4.exact.no_quote_terms")?.detail).toMatch(/not a fact Clearline read from the chain/);
    });
  }
  it("not final", () => expect(verdict(withTransfer(exactNoTerms(), (t) => ({ ...t, confirmations: 1 })))).toBe("suggested_for_review M1.finality.pending"));
  it("a look-alike contract with the same symbol", () =>
    expect(verdict(withTransfer(exactNoTerms(), (t) => ({ ...t, tokenContract: "TLookAlikeContract1111111111111111", claimedSymbol: "USDT" })))).toBe("exception M1.identity.lookalike_token"));
  it("chain data unavailable for the deposit address", () => {
    const i = exactNoTerms();
    expect(verdict({ ...i, chainUnavailable: [{ network: "tron", address: i.quotes[0].depositAddress, source: "chain_client", reason: "timeout", at: "2026-11-24T04:00:00.000Z" }] })).toBe("exception M1.chain.unavailable");
  });
  it("the network is disabled", () => {
    const i = exactNoTerms();
    expect(verdict({ ...i, networks: i.networks.map((n) => (n.network === "tron" ? { ...n, enabled: false } : n)) })).toBe("exception M1.identity.network_disabled");
  });
  it("two transfers reached the address (ambiguous candidates)", () => {
    const i = exactNoTerms();
    expect(verdict({ ...i, transfers: [...i.transfers, { ...i.transfers[0], logIndex: 1 }] })).toBe(ABSTAIN);
  });
  it("one of two transfers is still pending", () => {
    const i = exactNoTerms();
    expect(verdict({ ...i, transfers: [...i.transfers, { ...i.transfers[0], txHash: "a".repeat(64), confirmations: 2 }] })).toBe(ABSTAIN);
  });
  it("the record names the transaction without a log index and two of its transfers reach the address", () => {
    const i = exactNoTerms();
    const x = { ...withRecord(i, (r) => ({ ...r, transferRef: { network: i.transfers[0].network, txHash: i.transfers[0].txHash, logIndex: 0 }, logIndexUnknown: true as const })), transfers: [...i.transfers, { ...i.transfers[0], logIndex: 5 }] };
    expect(verdict(x)).toBe("exception M3.provider.transfer_ambiguous");
  });
});

describe("(c) credited equals the invoice exactly, same currency — removed → not matched", () => {
  for (const delta of [1n, -1n, 100n, -2_500n]) {
    it(`the invoice differs by ${delta} minor unit(s): the existing outcome (abstain), never matched_with_difference`, () => {
      const i = exactNoTerms();
      const x = { ...i, invoices: i.invoices.map((v) => ({ ...v, amountMinor: v.amountMinor + delta })) };
      expect(verdict(x)).toBe(ABSTAIN);
      expect(reconcile(x).writeOffs).toEqual([]);
    });
  }
  it("the credited currency differs", () => expect(verdict(withRecord(exactNoTerms(), (r) => ({ ...r, creditedCurrency: "USD" })))).toBe(ABSTAIN));
  it("the credited currency is not given", () => expect(verdict(withRecord(exactNoTerms(), (r) => { const { creditedCurrency: _c, ...rest } = r; void _c; return rest; }))).toBe(ABSTAIN));
  it("the provider's credit is not received × executed rate: the existing exception", () =>
    expect(verdict(withRecord(exactNoTerms(), (r) => ({ ...r, creditedMinor: r.creditedMinor + 1n })))).toBe("exception M4.tolerance.unexplained"));
});

describe("refunds, partials, over- and underpayments keep their existing outcome", () => {
  for (const claim of ["overpaid", "underpaid", "partially_paid", "re_quoted"] as const)
    it(`provider claims ${claim}`, () => expect(verdict(withRecord(exactNoTerms(), (r) => ({ ...r, statusClaim: claim })))).toBe(ABSTAIN));
  it("a refund line for the order", () => {
    const i = exactNoTerms();
    expect(verdict({ ...i, batchLines: [{ batchId: "B-R", kind: "refund", refundId: "RF-1", orderId: ORDER, amountMinor: 1n }] })).toBe(ABSTAIN);
  });
  it("a balance payment link (part payment)", () => {
    const i = exactNoTerms();
    const x: ReconcileInput = { ...i, paymentLinks: [{ linkId: "PL-B", orderId: ORDER, quoteId: i.quotes[0].quoteId, kind: "balance", token: USDT, depositAddress: depositAddress(USDT, "BAL"), requestedBaseUnits: 1n, createdAt: i.quotes[0].createdAt, expiresAt: i.quotes[0].expiresAt }] };
    expect(rec(x).explanation.decision).not.toBe("matched");
  });
  it("a void invoice", () => expect(verdict({ ...exactNoTerms(), invoices: exactNoTerms().invoices.map((v) => ({ ...v, status: "void" as const })) })).toBe(ABSTAIN));
});
