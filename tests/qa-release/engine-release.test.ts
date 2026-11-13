/**
 * QA + security release review, 13 Nov 2026 (qa-security-engineer role, independent reviewer).
 * Target: release/clearline-unified-20261113 @ 6fb9433, engine src/lib/clearline/**.
 *
 * Convention: a test named "DEFECT …" is expected to FAIL until the defect is fixed (it asserts the
 * correct behaviour). Every other test asserts an attack or edge case the engine resisted at review.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_TOKENS, BASE_SEPOLIA_CHAIN_ID, FINALITY_THRESHOLD, computeLiquidity, emptyWorkspace, exportCaseReport,
  fundingProjection, getAdapter, parseAmount, sampleWorkspace, type ChainObservationInput, type Workspace,
} from "@/lib/clearline";
import { sha256Hex } from "@/lib/clearline/sha256";
import { attempt, baseInput, created, debitLine, errorCode, intent, run, signedDelivery, sim, submitted } from "../clearline/helpers";

const MAYA = "usr_maya";
const DANIEL = "usr_daniel";
const PRIYA = "usr_priya";

const scenario = (ws: Workspace, key: string) => ws.intents.find((i) => i.scenario === key)!;
const ppidOf = (ws: Workspace, intentId: string) => ws.instructions.find((x) => x.id === intent(ws, intentId).instructionId)!.providerPaymentId!;
const maxSeq = (ws: Workspace, intentId: string) => ws.providerEvents.filter((e) => e.intentId === intentId).reduce((m, e) => Math.max(m, e.sequence), 0);

function obs(ws: Workspace, intentId: string, o: Partial<ChainObservationInput> = {}): ChainObservationInput {
  const t = ALLOWLISTED_TOKENS[0];
  const i = intent(ws, intentId);
  const q = ws.quotes.find((x) => x.id === i.selectedQuoteId);
  return {
    intentId, chainId: t.chainId, network: t.network, tokenContract: t.contract, tokenSymbol: t.symbol,
    txHash: "0x" + "ab".repeat(32), toAddress: "0x" + sha256Hex("synthetic-wallet:" + i.beneficiaryRef).slice(0, 40), // the beneficiary's synthetic wallet, as the adapter derives it
    amountMinor: q?.estimatedRecipientMinor ?? 1, blockNumber: 18_000_100, confirmations: FINALITY_THRESHOLD, ...o,
  };
}
const usdc = { sourceCurrency: "USDC" as const, destinationCurrency: "USDC" as const, amountMinor: 6_427_830_000, destinationCountry: "SG" };

// ------------------------------------------------------------------------------------------------
describe("amounts and currencies", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e16, Number.MAX_SAFE_INTEGER + 2, "100", null])("rejects amountMinor %s", (amountMinor) => {
    const r = attempt(emptyWorkspace(), MAYA, { type: "create_intent", input: baseInput({ amountMinor: amountMinor as number }) });
    expect(errorCode(r)).toBe("invalid_amount");
  });
  it.each(["BTC", "usd", "__proto__", "constructor", "toString", "", "USDT"])("rejects currency %j", (c) => {
    const r = attempt(emptyWorkspace(), MAYA, { type: "create_intent", input: baseInput({ sourceCurrency: c as never }) });
    expect(errorCode(r)).toBe("invalid_currency");
    const r2 = attempt(emptyWorkspace(), MAYA, { type: "create_intent", input: baseInput({ destinationCurrency: c as never }) });
    expect(errorCode(r2)).toBe("invalid_currency");
  });
  it.each([["0", "SGD"], ["-5", "SGD"], ["1e5", "SGD"], ["1.001", "SGD"], ["0.0000001", "USDC"], ["", "SGD"], [" ", "SGD"], ["1,000.00", "SGD"], ["9999999999999999", "SGD"]])("parseAmount rejects %j %s", (t, c) => {
    expect(parseAmount(t, c as never).ok).toBe(false);
  });
  it("parseAmount is exact for 6-decimal USDC and 2-decimal SGD (no float drift)", () => {
    expect(parseAmount("0.29", "SGD")).toEqual({ ok: true, value: 29 });
    expect(parseAmount("6427.830000", "USDC")).toEqual({ ok: true, value: 6_427_830_000 });
  });
  it("a statement line with an unsupported currency or a zero amount is refused", () => {
    const ws = sampleWorkspace();
    expect(errorCode(attempt(ws, MAYA, { type: "ingest_statement_line", line: debitLine({ currency: "BTC" }) as never }))).toBe("invalid_currency");
    expect(errorCode(attempt(ws, MAYA, { type: "ingest_statement_line", line: debitLine({ amountMinor: 0 }) as never }))).toBe("invalid_amount");
  });
});

// ------------------------------------------------------------------------------------------------
describe("duplicate intents and idempotency", () => {
  it("same key + same body replays the original intent and creates nothing", () => {
    const input = baseInput();
    const a = run(emptyWorkspace(), MAYA, { type: "create_intent", input });
    const b = run(a.workspace, MAYA, { type: "create_intent", input: { ...input } });
    expect(b.outcome).toBe("idempotent_replay");
    expect(b.createdIds).toEqual(a.createdIds);
    expect(b.workspace.intents).toHaveLength(1);
  });
  it("same key + different body is an idempotency_conflict", () => {
    const input = baseInput();
    const a = run(emptyWorkspace(), MAYA, { type: "create_intent", input });
    expect(errorCode(attempt(a.workspace, MAYA, { type: "create_intent", input: { ...input, amountMinor: input.amountMinor + 1 } }))).toBe("idempotency_conflict");
  });
  it("a second active intent with the same internal reference is refused", () => {
    const { ws } = created({ internalReference: "INV-DUP-1" });
    expect(errorCode(attempt(ws, MAYA, { type: "create_intent", input: baseInput({ internalReference: "INV-DUP-1" }) }))).toBe("invalid_field");
  });
  it("DEFECT (Low) an idempotency key equal to an Object.prototype name is wrongly treated as already used", () => {
    // KEY_RE allows "constructor"/"__proto__"; ws.idempotency[key] then reads Object.prototype members.
    const r = attempt(emptyWorkspace(), MAYA, { type: "create_intent", input: baseInput({ idempotencyKey: "constructor" }) });
    expect(errorCode(r)).toBe("ok");
  });
  it("DEFECT (Medium) two correction intents for the same returned payout are both accepted (double re-payment)", () => {
    let ws = sampleWorkspace();
    const returned = scenario(ws, "s2_returned");
    const corr = (k: string) => baseInput({ internalReference: returned.internalReference, amountMinor: returned.amountMinor, sourceCurrency: "USD", destinationCurrency: "SGD", destinationCountry: "SG", idempotencyKey: k, correctsIntentId: returned.id });
    ws = run(ws, MAYA, { type: "create_intent", input: corr("qa-corr-0001") }).workspace;
    const second = attempt(ws, MAYA, { type: "create_intent", input: corr("qa-corr-0002") });
    expect(errorCode(second)).not.toBe("ok");
  });
});

// ------------------------------------------------------------------------------------------------
describe("roles, maker/checker and invalid state transitions", () => {
  it("unknown actor, viewer and wrong roles are refused", () => {
    const ws = emptyWorkspace();
    expect(errorCode(attempt(ws, "usr_nobody", { type: "create_intent", input: baseInput() }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, "usr_alex", { type: "create_intent", input: baseInput() }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, PRIYA, { type: "create_intent", input: baseInput() }))).toBe("unauthorized_actor");
  });
  it("the maker cannot approve their own instruction; an operator cannot approve at all; a second approval is refused", () => {
    let { ws, id } = created();
    ws = run(ws, MAYA, { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.eligible)!;
    const c = run(ws, MAYA, { type: "choose_route", intentId: id, quoteId: q.id });
    const ins = c.createdIds[0];
    expect(errorCode(attempt(c.workspace, MAYA, { type: "approve_instruction", instructionId: ins }))).not.toBe("ok");
    expect(errorCode(attempt(c.workspace, "usr_sam", { type: "approve_instruction", instructionId: ins }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(c.workspace, MAYA, { type: "submit_instruction", instructionId: ins }))).toBe("invalid_transition");
    const ok = run(c.workspace, DANIEL, { type: "approve_instruction", instructionId: ins });
    expect(errorCode(attempt(ok.workspace, DANIEL, { type: "approve_instruction", instructionId: ins }))).toBe("invalid_transition");
  });
  it("a submitted payout cannot be cancelled; a route cannot be chosen before quotes; time cannot run backwards", () => {
    const s = submitted();
    expect(errorCode(attempt(s.ws, MAYA, { type: "cancel_intent", intentId: s.id, reason: "changed mind" }))).toBe("invalid_transition");
    const c = created();
    expect(errorCode(attempt(c.ws, MAYA, { type: "choose_route", intentId: c.id, quoteId: "qt_x" }))).toBe("invalid_transition");
    expect(errorCode(attempt(c.ws, MAYA, { type: "request_quotes", intentId: c.id }, "2020-01-01T00:00:00Z"))).toBe("invalid_field");
  });
  it("an expired quote cannot be approved", () => {
    let { ws, id } = created();
    ws = run(ws, MAYA, { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.eligible)!;
    const c = run(ws, MAYA, { type: "choose_route", intentId: id, quoteId: q.id });
    const late = new Date(Date.parse(q.expiresAt) + 60_000).toISOString();
    expect(errorCode(attempt(c.workspace, DANIEL, { type: "approve_instruction", instructionId: c.createdIds[0] }, late))).toBe("quote_expired");
  });
  it("the preparer of a funding advance cannot approve it", () => {
    const ws = sampleWorkspace();
    const s1 = scenario(ws, "s1_success");
    const r = run(ws, MAYA, { type: "create_advance", input: { intentId: s1.id, customerRef: "CUST-QA", customerName: "QA Customer", supplierName: "QA Supplier", invoiceRef: "INV-QA-1", dueDate: "2026-12-01", repaymentReference: "RPY-QA-0001" } });
    expect(errorCode(attempt(r.workspace, MAYA, { type: "decide_advance", advanceId: r.createdIds[0], outcome: "approve", reason: "self" }))).not.toBe("ok");
  });
});

// ------------------------------------------------------------------------------------------------
describe("provider webhooks", () => {
  const setup = () => {
    let s = submitted();
    const ws = s.ws;
    return { ...s, ws };
  };
  it("bad signature, wrong provider's secret, stale timestamp and malformed header are rejected and change nothing", () => {
    const s = setup();
    const payload = { id: `${s.ppid}-E2`, type: "payout.completed", provider_payment_id: s.ppid, sequence: 2, occurred_at: s.ws.asOf };
    const raw = JSON.stringify(payload);
    const now = Math.floor(Date.parse(s.ws.asOf) / 1000);
    const deliveries = [
      { providerId: "prv_northline", rawBody: raw, signatureHeader: getAdapter("prv_harbour")!.signWebhook(raw, now) },
      { providerId: "prv_northline", rawBody: raw, signatureHeader: getAdapter("prv_northline")!.signWebhook(raw, now - 3600) },
      { providerId: "prv_northline", rawBody: raw, signatureHeader: "t=1,v1=zz" },
      { providerId: "prv_northline", rawBody: raw.replace("payout.completed", "payout.returned"), signatureHeader: getAdapter("prv_northline")!.signWebhook(raw, now) },
    ];
    for (const d of deliveries) {
      const r = run(s.ws, MAYA, { type: "ingest_webhook", delivery: d });
      expect(r.outcome).toBe("rejected_signature");
      expect(intent(r.workspace, s.id).status.execution).toBe("submitted");
    }
  });
  it("a webhook for another provider's payment id is not applied", () => {
    const s = setup();
    const r = run(s.ws, MAYA, { type: "ingest_webhook", delivery: signedDelivery(s.ws, "prv_harbour", { id: "X-1", type: "payout.completed", provider_payment_id: s.ppid, sequence: 5, occurred_at: s.ws.asOf }) });
    expect(r.outcome).toBe("rejected_unknown_payment");
    expect(intent(r.workspace, s.id).status.execution).toBe("submitted");
  });
  it("duplicate delivery is ignored; same id with a different payload raises duplicate_event", () => {
    const s = setup();
    const p = { id: `${s.ppid}-E2`, type: "payout.in_transit", provider_payment_id: s.ppid, sequence: 2, occurred_at: s.ws.asOf };
    const a = run(s.ws, MAYA, { type: "ingest_webhook", delivery: signedDelivery(s.ws, "prv_northline", p) });
    const b = run(a.workspace, MAYA, { type: "ingest_webhook", delivery: signedDelivery(a.workspace, "prv_northline", p) });
    expect(b.outcome).toBe("duplicate_ignored");
    const c = run(b.workspace, MAYA, { type: "ingest_webhook", delivery: signedDelivery(b.workspace, "prv_northline", { ...p, type: "payout.completed" }) });
    expect(c.outcome).toBe("duplicate_ignored");
    expect(intent(c.workspace, s.id).status.execution).toBe("in_transit");
    expect(c.workspace.exceptions.some((e) => e.category === "duplicate_event" && e.intentId === s.id)).toBe(true);
  });
  it("out-of-order: a late in_transit after completed does not regress state; contradictory amount raises an exception", () => {
    const s = setup();
    const done = run(s.ws, MAYA, { type: "ingest_webhook", delivery: signedDelivery(s.ws, "prv_northline", { id: `${s.ppid}-E3`, type: "payout.completed", provider_payment_id: s.ppid, sequence: 3, occurred_at: s.ws.asOf }) });
    const late = run(done.workspace, MAYA, { type: "ingest_webhook", delivery: signedDelivery(done.workspace, "prv_northline", { id: `${s.ppid}-E2`, type: "payout.in_transit", provider_payment_id: s.ppid, sequence: 2, occurred_at: s.ws.asOf }) });
    expect(late.outcome).toBe("stored_late_no_regression");
    expect(intent(late.workspace, s.id).status.execution).toBe("provider_reported_completed");
    expect(intent(late.workspace, s.id).status.settlement).not.toBe("verified");
    const s2 = setup();
    const contra = run(s2.ws, MAYA, { type: "ingest_webhook", delivery: signedDelivery(s2.ws, "prv_northline", { id: `${s2.ppid}-E9`, type: "payout.completed", provider_payment_id: s2.ppid, sequence: 9, occurred_at: s2.ws.asOf, amount_minor: 1, currency: "SGD" }) });
    expect(contra.outcome).toBe("contradictory_exception_raised");
    expect(intent(contra.workspace, s2.id).status.execution).toBe("submitted");
  });
  it("a failed event after completion is a contradiction, not a state change", () => {
    const s = setup();
    const done = run(s.ws, MAYA, { type: "ingest_webhook", delivery: signedDelivery(s.ws, "prv_northline", { id: `${s.ppid}-E3`, type: "payout.completed", provider_payment_id: s.ppid, sequence: 3, occurred_at: s.ws.asOf }) });
    const fail = run(done.workspace, MAYA, { type: "ingest_webhook", delivery: signedDelivery(done.workspace, "prv_northline", { id: `${s.ppid}-E4`, type: "payout.failed", provider_payment_id: s.ppid, sequence: 4, occurred_at: s.ws.asOf }) });
    expect(fail.outcome).toBe("contradictory_exception_raised");
    expect(intent(fail.workspace, s.id).status.execution).toBe("provider_reported_completed");
  });
  it("an oversized webhook body is refused", () => {
    const s = setup();
    expect(errorCode(attempt(s.ws, MAYA, { type: "ingest_webhook", delivery: { providerId: "prv_northline", rawBody: "x".repeat(16_001), signatureHeader: "t=1,v1=" + "0".repeat(64) } }))).toBe("invalid_field");
  });
});

// ------------------------------------------------------------------------------------------------
describe("compliance hold is never auto-released", () => {
  const held = () => {
    const ws = sampleWorkspace();
    const i = scenario(ws, "s3_hold");
    const hold = ws.holds.find((h) => h.intentId === i.id)!;
    return { ws, id: i.id, hold, ppid: ppidOf(ws, i.id), providerId: hold.providerId };
  };
  it("partner release alone does not release; a reviewer release alone does not release", () => {
    const h = held();
    const docs = run(h.ws, MAYA, { type: "submit_hold_documents", holdId: h.hold.id, documents: ["Supporting commercial invoice"] }).workspace;
    const partner = run(docs, MAYA, { type: "ingest_webhook", delivery: signedDelivery(docs, h.providerId, { id: `${h.ppid}-E50`, type: "payout.hold_released", provider_payment_id: h.ppid, sequence: maxSeq(docs, h.id) + 1, occurred_at: docs.asOf }) });
    expect(intent(partner.workspace, h.id).status.execution).toBe("on_hold");
    expect(partner.workspace.holds.find((x) => x.id === h.hold.id)!.status).toBe("partner_release_reported");
    const reviewerOnly = run(docs, PRIYA, { type: "record_hold_decision", holdId: h.hold.id, decision: "release", reason: "Docs fine" });
    expect(intent(reviewerOnly.workspace, h.id).status.execution).toBe("on_hold");
  });
  it("only the assigned compliance reviewer may decide; operators and approvers may not", () => {
    const h = held();
    for (const who of [MAYA, DANIEL, "usr_alex"])
      expect(errorCode(attempt(h.ws, who, { type: "record_hold_decision", holdId: h.hold.id, decision: "release", reason: "x" }))).toBe("unauthorized_actor");
  });
  it("the hold exception cannot be resolved while the hold is undecided", () => {
    const h = held();
    const exc = h.ws.exceptions.find((e) => e.intentId === h.id && e.category === "compliance_hold")!;
    expect(errorCode(attempt(h.ws, PRIYA, { type: "resolve", target: { kind: "exception", id: exc.id }, note: "close it" }))).toBe("resolution_not_permitted");
  });
  it("advancing the clock does not release a hold", () => {
    const h = held();
    const r = run(h.ws, MAYA, { type: "advance_clock", to: "2026-12-31T00:00:00.000Z" });
    expect(intent(r.workspace, h.id).status.execution).toBe("on_hold");
  });
  it("DEFECT (High) a signed provider payout.in_transit moves an on-hold payout to in_transit with no reviewer decision", () => {
    const h = held();
    const r = run(h.ws, MAYA, { type: "ingest_webhook", delivery: signedDelivery(h.ws, h.providerId, { id: `${h.ppid}-E60`, type: "payout.in_transit", provider_payment_id: h.ppid, sequence: maxSeq(h.ws, h.id) + 1, occurred_at: h.ws.asOf }) });
    expect(r.workspace.holds.find((x) => x.id === h.hold.id)!.status).not.toBe("released");
    // Execution must not leave on_hold while the hold has no human decision.
    expect(intent(r.workspace, h.id).status.execution).toBe("on_hold");
  });
});

// ------------------------------------------------------------------------------------------------
describe("reconciliation", () => {
  const completed = () => {
    let s = submitted();
    let ws = sim(s.ws, s.id).workspace;
    ws = sim(ws, s.id).workspace;
    return { ...s, ws };
  };
  it("amount-only match never allocates", () => {
    const s = completed();
    const r = run(s.ws, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: "SUPPLIER PAYMENT" }) });
    expect(r.outcome).toBe("exception_raised");
    expect(r.workspace.allocations).toHaveLength(0);
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_AMOUNT_ONLY_CANDIDATES");
    expect(intent(r.workspace, s.id).status.reconciliation).not.toBe("matched");
  });
  it("missing reference, currency mismatch and overpayment are not allocated", () => {
    const s = completed();
    const noRef = run(s.ws, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: "", amountMinor: 999 }) });
    expect(noRef.workspace.exceptions.at(-1)!.category).toBe("missing_payment_reference");
    const fx = run(s.ws, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: s.ppid, currency: "USD" }) });
    expect(fx.workspace.allocations).toHaveLength(0);
    expect(fx.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_CURRENCY_MISMATCH");
    const over = run(s.ws, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: s.ppid, amountMinor: 1_000_001 }) });
    expect(over.workspace.allocations).toHaveLength(0);
  });
  it("a reference naming two payments is ambiguous and not allocated", () => {
    const a = completed();
    const b = submitted({}, "prv_northline", a.ws);
    const r = run(b.ws, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: `${a.ppid} ${b.ppid}` }) });
    expect(r.workspace.allocations).toHaveLength(0);
    expect(r.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_AMBIGUOUS_REFERENCE");
  });
  it("the same line twice is refused; a re-keyed duplicate is flagged, not allocated twice", () => {
    const s = completed();
    const line = debitLine({ reference: s.ppid });
    const a = run(s.ws, MAYA, { type: "ingest_statement_line", line });
    expect(a.outcome).toBe("allocated");
    expect(errorCode(attempt(a.workspace, MAYA, { type: "ingest_statement_line", line }))).toBe("duplicate_statement_line");
    const b = run(a.workspace, MAYA, { type: "ingest_statement_line", line: { ...line, lineId: line.lineId + "-B" } });
    expect(b.outcome).toBe("exception_raised");
    expect(b.workspace.allocations).toHaveLength(1);
  });
  it("partial then remainder reaches matched only on the full amount", () => {
    const s = completed();
    const a = run(s.ws, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: s.ppid, amountMinor: 400_000 }) });
    expect(intent(a.workspace, s.id).status.reconciliation).toBe("partially_matched");
    expect(intent(a.workspace, s.id).status.settlement).not.toBe("verified");
    const b = run(a.workspace, MAYA, { type: "ingest_statement_line", line: debitLine({ reference: s.ppid, amountMinor: 600_000 }) });
    expect(intent(b.workspace, s.id).status.reconciliation).toBe("matched");
  });
});

// ------------------------------------------------------------------------------------------------
describe("repayments (funding projection)", () => {
  const credit = (o: Record<string, unknown>) => ({ lineId: `RP-${Math.random().toString(36).slice(2, 8)}`, source: "bank_statement" as const, accountRef: "BANK-SGD-OPS", direction: "credit" as const, kind: "payment" as const, amountMinor: 1_000_000, currency: "SGD" as const, reference: "RPY-SEABRIGHT-0001", counterparty: "SEABRIGHT TRADING", valueDate: "2026-11-13", ...o });
  const out = (ws: Workspace) => fundingProjection(ws).rows[0].outstanding.amountMinor;
  it("partial repayment by reference reduces outstanding; remainder repays; overpayment is not allocated", () => {
    const ws = sampleWorkspace();
    expect(out(ws)).toBe(2_000_000);
    const a = run(ws, MAYA, { type: "ingest_statement_line", line: credit({}) });
    expect(out(a.workspace)).toBe(1_000_000);
    const over = run(a.workspace, MAYA, { type: "ingest_statement_line", line: credit({ amountMinor: 1_000_001, valueDate: "2026-11-14" }) });
    expect(out(over.workspace)).toBe(1_000_000);
    const rest = run(a.workspace, MAYA, { type: "ingest_statement_line", line: credit({ valueDate: "2026-11-14", counterparty: "SEABRIGHT TRADING PTE" }) });
    expect(out(rest.workspace)).toBe(0);
    expect(fundingProjection(rest.workspace).rows[0].state).toBe("repaid");
  });
  it("a duplicate repayment (re-keyed same line) is not counted twice", () => {
    const ws = sampleWorkspace();
    const a = run(ws, MAYA, { type: "ingest_statement_line", line: credit({ lineId: "RP-DUP-A" }) });
    const b = run(a.workspace, MAYA, { type: "ingest_statement_line", line: credit({ lineId: "RP-DUP-B" }) });
    expect(out(b.workspace)).toBe(1_000_000);
  });
  it("currency mismatch, missing reference and amount-equal-to-outstanding without reference are not allocated", () => {
    const ws = sampleWorkspace();
    for (const o of [{ currency: "USD" }, { reference: "" }, { reference: "THANKS", amountMinor: 2_000_000 }]) {
      const r = run(ws, MAYA, { type: "ingest_statement_line", line: credit(o) });
      expect(r.outcome).toBe("exception_raised");
      expect(out(r.workspace)).toBe(2_000_000);
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe("liquidity", () => {
  it("stale snapshots are excluded and restricted/safeguarded amounts are subtracted", () => {
    const ws = sampleWorkspace();
    const v = computeLiquidity(ws);
    expect(v.staleExcluded).toContain("liq_harbour_usd");
    expect(v.currentUsableByCurrency.USD ?? 0).toBe(0);
    const row = v.rows.find((r) => r.id === "liq_harbour_sgd")!;
    expect(row.usableMinor).toBe(row.eligibleMinor - row.restrictedMinor - row.safeguardedMinor - row.committedPayoutsMinor - row.bufferMinor);
  });
  it("an advance covered only by a stale balance raises funding_shortfall and cannot be approved", () => {
    // USD: the only USD balance in the sample (liq_harbour_usd) is stale.
    const c = created({ sourceCurrency: "USD", destinationCurrency: "SGD", destinationCountry: "SG", amountMinor: 100_000 }, sampleWorkspace());
    let ws = c.ws;
    const r = run(ws, MAYA, { type: "create_advance", input: { intentId: c.id, customerRef: "CUST-QA2", customerName: "QA Customer", supplierName: "QA Supplier", invoiceRef: "INV-QA-2", dueDate: "2026-12-01", repaymentReference: "RPY-QA-0002" } });
    ws = r.workspace;
    expect(ws.exceptions.some((e) => e.category === "funding_shortfall" && e.advanceId === r.createdIds[0])).toBe(true);
    expect(errorCode(attempt(ws, DANIEL, { type: "decide_advance", advanceId: r.createdIds[0], outcome: "approve", reason: "ok" }))).toBe("precondition_failed");
  });
});

// ------------------------------------------------------------------------------------------------
describe("chain evidence (synthetic Base Sepolia)", () => {
  const inTransitUsdc = (ws0?: Workspace, key?: string) => {
    const s = submitted({ ...usdc, ...(key ? { idempotencyKey: key } : {}) }, "prv_tidewater", ws0);
    return { ...s, ws: sim(s.ws, s.id).workspace };
  };
  it("unsupported network / token contract / symbol is never counted", () => {
    const s = inTransitUsdc();
    for (const o of [{ chainId: 8453, network: "base" }, { tokenContract: "0x" + "11".repeat(20) }, { tokenSymbol: "USDT" }, { chainId: BASE_SEPOLIA_CHAIN_ID + 1 }]) {
      const r = run(s.ws, MAYA, { type: "ingest_chain_observation", observation: obs(s.ws, s.id, o) });
      expect(r.outcome).toBe("exception_raised");
      expect(intent(r.workspace, s.id).status.settlement).not.toBe("verified");
      expect(r.workspace.exceptions.at(-1)!.category).toBe("unsupported_token_or_network");
    }
  });
  it("below the finality threshold is pending, not verified; a confirmation drop is a contradiction", () => {
    const s = inTransitUsdc();
    const a = run(s.ws, MAYA, { type: "ingest_chain_observation", observation: obs(s.ws, s.id, { confirmations: FINALITY_THRESHOLD - 1 }) });
    expect(intent(a.workspace, s.id).status.settlement).toBe("pending_finality");
    const b = run(a.workspace, MAYA, { type: "ingest_chain_observation", observation: obs(a.workspace, s.id, { confirmations: 2 }) });
    expect(b.outcome).toBe("contradictory_exception_raised");
    expect(intent(b.workspace, s.id).status.settlement).toBe("contradicted");
  });
  it("an on-chain amount different from the quote is a contradiction", () => {
    const s = inTransitUsdc();
    const r = run(s.ws, MAYA, { type: "ingest_chain_observation", observation: obs(s.ws, s.id, { amountMinor: 1 }) });
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, s.id).status.settlement).not.toBe("verified");
    expect(r.workspace.exceptions.some((e) => e.intentId === s.id && e.category === "contradictory_evidence")).toBe(true);
  });
  it("malformed tx hash / address / negative confirmations are refused", () => {
    const s = inTransitUsdc();
    for (const o of [{ txHash: "0x12" }, { toAddress: "0xZZ" }, { confirmations: -1 }, { amountMinor: 0 }])
      expect(errorCode(attempt(s.ws, MAYA, { type: "ingest_chain_observation", observation: obs(s.ws, s.id, o) }))).toBe("invalid_field");
  });
  it("DEFECT (High) one on-chain transfer (same txHash) is counted as verified settlement for two different payments", () => {
    const a = inTransitUsdc(undefined, "qa-chain-a-0001");
    const b = inTransitUsdc(a.ws, "qa-chain-b-0001");
    let ws = run(b.ws, MAYA, { type: "ingest_chain_observation", observation: obs(b.ws, a.id) }).workspace;
    expect(intent(ws, a.id).status.settlement).toBe("verified");
    ws = run(ws, MAYA, { type: "ingest_chain_observation", observation: obs(ws, b.id) }).workspace; // same txHash
    expect(intent(ws, b.id).status.settlement).not.toBe("verified");
  });
  it("DEFECT (High) a chain transfer of any amount marks a non-stablecoin, never-submitted payment verified and matched", () => {
    const { ws, id } = created(); // SGD→PHP, status created, no route chosen
    const r = attempt(ws, MAYA, { type: "ingest_chain_observation", observation: obs(ws, id, { amountMinor: 1 }) });
    // A typed refusal is a correct fix; so is recording it without counting it.
    if (r.ok) {
      expect(intent(r.value.workspace, id).status.settlement).not.toBe("verified");
      expect(intent(r.value.workspace, id).status.reconciliation).not.toBe("matched");
    }
  });
  it("DEFECT (Medium) a transfer to a wallet that is not the beneficiary's is still counted as verified", () => {
    const s = inTransitUsdc();
    const r = run(s.ws, MAYA, { type: "ingest_chain_observation", observation: obs(s.ws, s.id, { toAddress: "0x" + "ee".repeat(20) }) });
    expect(intent(r.workspace, s.id).status.settlement).not.toBe("verified");
  });
});

// ------------------------------------------------------------------------------------------------
describe("exported case reports", () => {
  it("markup in notes is refused at input", () => {
    const ws = sampleWorkspace();
    const c = ws.cases[0];
    expect(errorCode(attempt(ws, MAYA, { type: "add_note", target: { kind: "case", id: c.id }, text: "<img src=x onerror=alert(1)>" }))).toBe("invalid_field");
    expect(errorCode(attempt(ws, MAYA, { type: "create_intent", input: baseInput({ beneficiaryName: "<script>alert(1)</script>" }) }))).toBe("invalid_field");
  });
  it("DEFECT (Low) a note containing a newline can forge a status line in the exported text report", () => {
    const ws = sampleWorkspace();
    const c = ws.cases.find((x) => x.intentId)!;
    const r = run(ws, MAYA, { type: "add_note", target: { kind: "case", id: c.id }, text: "ok\nSTATUS  execution=provider_reported_completed  settlement=verified (bank_statement)  reconciliation=matched" });
    const rep = exportCaseReport(r.workspace, c.id);
    expect(rep.ok).toBe(true);
    const statusLines = rep.ok ? rep.value.text.split("\n").filter((l) => l.startsWith("STATUS")) : [];
    expect(statusLines).toHaveLength(1);
  });
});
