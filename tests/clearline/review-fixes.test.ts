/**
 * Regression tests for docs/release/CODE_REVIEW.md (review of 6fb9433). Each test reproduces a
 * reviewer probe (P1–P13) or finding and asserts the corrected behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_TOKENS, applyAction, computeLiquidity, emptyWorkspace, fundingProjection, getAdapter, investigate, listExceptions,
  parseWorkspace, sampleWorkspace, serializeWorkspace, verifySandboxWebhook, sandboxWebhookSecret, signSandboxWebhook, type Workspace,
} from "@/lib/clearline";
import { attempt, baseInput, created, debitLine, errorCode, intent, later, run, sim, signedDelivery, submitted } from "./helpers";

const tok = ALLOWLISTED_TOKENS[0];
const obs = (intentId: string, o: Record<string, unknown> = {}) => ({
  intentId, chainId: tok.chainId, network: tok.network, tokenContract: tok.contract, tokenSymbol: tok.symbol,
  txHash: "0x" + "a".repeat(64), toAddress: "0x" + "b".repeat(40), amountMinor: 5, blockNumber: 1, confirmations: 12, ...o,
});
const st = (ws: Workspace, id: string) => intent(ws, id).status;
const usdcSubmitted = (ws0?: Workspace, ref?: string) =>
  submitted({ amountMinor: 50_000_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "PH", sandboxOutcome: "chain_delay", ...(ref ? { beneficiaryRef: ref } : {}) }, "prv_tidewater", ws0);
/** A correct observation for a USDC payout: expected wallet and quoted amount (6 decimals). */
const goodObs = (ws: Workspace, id: string, o: Record<string, unknown> = {}) => {
  const i = intent(ws, id);
  const q = ws.quotes.find((x) => x.id === i.selectedQuoteId)!;
  return obs(id, { toAddress: getAdapter("prv_tidewater")!.expectedWallet!(i), amountMinor: q.estimatedRecipientMinor, ...o });
};

describe("B1 chain evidence applies only to the matching stablecoin payout", () => {
  it("P1: a chain observation never touches a fiat payout", () => {
    const { ws, id } = submitted();
    const r = attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: obs(id) });
    expect(errorCode(r)).toBe("precondition_failed");
    expect(st(ws, id)).toMatchObject({ settlement: "none", reconciliation: "pending" });
  });
  it("rejects an observation before submission; accepts one after submission", () => {
    let { ws, id } = created({ amountMinor: 50_000_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "PH" });
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: obs(id) }))).toBe("precondition_failed");
    const s = usdcSubmitted();
    ws = run(s.ws, "usr_maya", { type: "advance_clock", to: s.ws.asOf }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, s.id) }))).toBe("ok");
  });
  it("wrong wallet or wrong amount raises contradictory_evidence and does not verify", () => {
    const { ws, id } = usdcSubmitted();
    const wrongWallet = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, id, { toAddress: "0x" + "c".repeat(40) }) });
    expect(wrongWallet.outcome).toBe("contradictory_exception_raised");
    expect(st(wrongWallet.workspace, id).settlement).not.toBe("verified");
    expect(listExceptions(wrongWallet.workspace, { intentId: id, category: "contradictory_evidence" })[0].explanationCode).toBe("CH_WALLET_NOT_BENEFICIARY");
    const wrongAmount = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, id, { amountMinor: 1 }) });
    expect(wrongAmount.outcome).toBe("contradictory_exception_raised");
    expect(st(wrongAmount.workspace, id).reconciliation).not.toBe("matched");
  });
  it("finality alone sets settlement; reconciliation is matched only by an allocation with the provider-reported tx hash", () => {
    let { ws, id } = usdcSubmitted();
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, id) }).workspace;
    expect(st(ws, id)).toMatchObject({ settlement: "verified", settlementScope: "onchain_transfer", reconciliation: "pending" });
    expect(ws.allocations).toHaveLength(0);
    // the sandbox flow: provider reports completion with the tx hash, then confirmations reach finality
    let s = usdcSubmitted();
    for (let i = 0; i < 5; i++) s = { ...s, ws: sim(s.ws, s.id).workspace };
    expect(st(s.ws, s.id)).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    expect(s.ws.allocations.find((a) => a.target.kind === "payment" && a.target.intentId === s.id)?.evidenceKind).toBe("chain_observation");
  });
});

describe("B2 one transaction hash is linked to at most one payout", () => {
  it("P2: reusing a tx hash for a second payout raises an exception and changes neither", () => {
    const a = usdcSubmitted(undefined, "BEN-A-001");
    const b = usdcSubmitted(a.ws, "BEN-B-002");
    let ws = run(b.ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(b.ws, a.id, { confirmations: 1 }) }).workspace;
    const before = st(ws, a.id);
    const r = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, b.id, { confirmations: 12 }) });
    expect(r.outcome).toBe("contradictory_exception_raised");
    ws = r.workspace;
    expect(st(ws, b.id).settlement).toBe("none");
    expect(st(ws, a.id)).toEqual(before);
    const e = listExceptions(ws, { category: "contradictory_evidence" }).find((x) => x.explanationCode === "CH_TX_ALREADY_LINKED")!;
    expect(e.candidates.sort()).toEqual([a.id, b.id].sort());
    expect(ws.chainObservations.filter((o) => o.txHash === "0x" + "a".repeat(64)).map((o) => o.intentId)).toEqual([a.id]);
  });
});

describe("M1 provider settlement report is provider-reported only", () => {
  it("P3: report alone never matches; a later bank line allocates and verifies", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    let r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid }) });
    expect(st(r.workspace, id)).toMatchObject({ settlement: "observed", settlementScope: "provider_report", reconciliation: "pending" });
    expect(r.workspace.allocations).toHaveLength(0);
    r = run(r.workspace, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ppid }) });
    expect(r.outcome).toBe("allocated");
    expect(st(r.workspace, id)).toMatchObject({ settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" });
    const v = investigate(r.workspace, id);
    expect(v.ok && v.value.explanationCodes).not.toContain("UK_ONLY_PROVIDER_SETTLEMENT_REPORT");
  });
});

describe("M2 return lines are checked", () => {
  it("P5: over-amount and duplicate return lines are not allocated; a provider return un-matches", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ppid }) }).workspace;
    expect(st(ws, id).reconciliation).toBe("matched");
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: ppid + "-E9", type: "payout.returned", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    expect(st(ws, id).reconciliation).toBe("exception");
    const over = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", kind: "return", reference: ppid, amountMinor: 9_999_999 }) });
    expect(over.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_OVERPAYMENT");
    const ok1 = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", kind: "return", reference: ppid }) });
    expect(ok1.outcome).toBe("allocated");
    const dup = run(ok1.workspace, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", kind: "return", reference: ppid }) });
    expect(dup.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_DUPLICATE_SUSPECTED");
    expect(dup.workspace.allocations.filter((a) => a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))).toHaveLength(1);
    const cur = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", kind: "return", reference: ppid, currency: "USD" }) });
    expect(cur.workspace.exceptions.at(-1)!.explanationCode).toBe("RC_CURRENCY_MISMATCH");
  });
});

describe("M3 contradicted settlement needs a person", () => {
  it("P8: a later final observation does not overwrite contradicted; resolving with evidence recomputes", () => {
    let { ws, id } = usdcSubmitted();
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, id, { confirmations: 8 }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, id, { confirmations: 3 }) }).workspace;
    expect(st(ws, id).settlement).toBe("contradicted");
    const r = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: goodObs(ws, id, { confirmations: 12 }) });
    expect(r.outcome).toBe("recorded_no_state_change");
    ws = r.workspace;
    expect(st(ws, id)).toMatchObject({ settlement: "contradicted" });
    const e = listExceptions(ws, { intentId: id, category: "contradictory_evidence" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    // m3: a plain note does not resolve a contradiction
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "note", description: "Looks fine" } }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "ok" }))).toBe("resolution_not_permitted");
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Explorer export showing 12 confirmations (synthetic)", documentName: "explorer.csv" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Reorg settled; final at 12" }).workspace;
    expect(st(ws, id).settlement).toBe("verified");
  });
});

describe("M4/M5 time handling", () => {
  it("P7: offset timestamps are normalised to UTC instants", () => {
    let { ws, id } = submitted();
    const at1 = new Date(Date.parse(ws.asOf) + 3600_000);
    const sg = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19) + "+08:00";
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id, injection: "timeout" }, sg(at1)).workspace;
    const exc = ws.exceptions.at(-1)!;
    expect(exc.createdAt).toBe(at1.toISOString());
    expect(ws.asOf).toBe(at1.toISOString());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, new Date(at1.getTime() + 2 * 3600_000).toISOString()).workspace;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    expect(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "provider answered" }).ok).toBe(true);
  });
  it("overdue uses the organisation's calendar day (Asia/Singapore), not UTC", () => {
    let ws = sampleWorkspace(); // obligation due 2026-11-20
    ws = run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-20T15:59:00Z" }).workspace; // 23:59 SGT on the 20th
    expect(fundingProjection(ws).rows[0].state).not.toBe("overdue");
    ws = run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-20T16:00:00Z" }).workspace; // 00:00 SGT on the 21st
    expect(fundingProjection(ws).rows[0].state).toBe("overdue");
    expect(listExceptions(ws, { category: "overdue_advance" })).toHaveLength(1);
  });
  it("execution-date expiry at a month end uses the organisation's date", () => {
    const { ws, id } = created({ requestedExecutionDate: "2026-11-30" });
    // 2026-11-30T20:00Z is already 2026-12-01 04:00 SGT
    expect(st(run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-30T15:59:00Z" }).workspace, id).execution).toBe("created");
    expect(st(run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-30T20:00:00Z" }).workspace, id).execution).toBe("expired");
  });
  it("exception due dates are organisation calendar dates", () => {
    // 2026-11-13T17:00Z = 2026-11-14 01:00 SGT; high severity → due 2026-11-15
    let { ws, id } = submitted({ sandboxOutcome: "return" });
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, "2026-11-13T17:00:00Z").workspace;
    expect(listExceptions(ws, { intentId: id, category: "returned_payout" })[0].dueDate).toBe("2026-11-15");
  });
});

describe("M6 malformed input never throws", () => {
  it("P6: malformed webhook payloads and chain observations are rejected with typed errors", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(ws, id).workspace;
    for (const rd of [5, "ab", { x: 1 }, [1, 2]]) {
      const r = attempt(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: ppid + "-E3" + JSON.stringify(rd), type: "payout.on_hold", provider_payment_id: ppid, sequence: 3, occurred_at: ws.asOf, requested_documents: rd }) });
      expect(errorCode(r)).toBe("invalid_field");
    }
    const reasonObj = attempt(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: "x1", type: "payout.failed", provider_payment_id: ppid, sequence: 4, occurred_at: ws.asOf, reason: { a: 1 } }) });
    expect(errorCode(reasonObj)).toBe("invalid_field");
    const badTime = attempt(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: "x2", type: "payout.failed", provider_payment_id: ppid, sequence: 4, occurred_at: "yesterday" }) });
    expect(errorCode(badTime)).toBe("invalid_field");
    // a malformed body with a BAD signature is still recorded as rejected_signature, never applied
    const tampered = { providerId: "prv_northline", rawBody: "{not json", signatureHeader: "t=1,v1=" + "0".repeat(64) };
    expect(run(ws, "usr_maya", { type: "ingest_webhook", delivery: tampered }).outcome).toBe("rejected_signature");
    const s = usdcSubmitted();
    for (const o of [{ tokenContract: undefined }, { chainId: "84532" }, { network: 5 }, { tokenSymbol: null }, { intentId: undefined }])
      expect(errorCode(attempt(s.ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...goodObs(s.ws, s.id), ...o } as never }))).toBe("invalid_field");
    expect(errorCode(attempt(s.ws, "usr_maya", { type: "ingest_chain_observation", observation: null as never }))).toBe("invalid_field");
    expect(errorCode(attempt(s.ws, "usr_maya", null as never))).toBe("invalid_field");
    expect(errorCode(attempt(s.ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "x" } as never }))).toBe("invalid_field");
  });
});

describe("M7 on_hold payouts end only through the reviewer", () => {
  it("P11: an operator cannot cancel a held or awaiting-information payout", () => {
    let { ws, id } = submitted({ sandboxOutcome: "hold", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(st(ws, id).execution).toBe("on_hold");
    expect(errorCode(attempt(ws, "usr_maya", { type: "cancel_intent", intentId: id, reason: "changed mind" }))).toBe("invalid_transition");
    expect(errorCode(attempt(ws, "usr_daniel", { type: "cancel_intent", intentId: id, reason: "changed mind" }))).toBe("invalid_transition");
  });
});

describe("M8 / m2 invalid clocks are never treated as fresh", () => {
  it("P12: computeLiquidity with an invalid instant treats every balance as stale", () => {
    const bad = computeLiquidity(sampleWorkspace(), "garbage");
    expect(bad.currentUsableByCurrency).toEqual({});
    expect(bad.rows.every((r) => r.stale)).toBe(true);
  });
  it("verifySandboxWebhook rejects a NaN or missing clock", () => {
    const secret = sandboxWebhookSecret("prv_northline");
    const h = signSandboxWebhook("{}", secret, 1_794_500_000);
    expect(verifySandboxWebhook("{}", h, secret, NaN).valid).toBe(false);
    expect(verifySandboxWebhook("{}", h, secret, undefined as never).valid).toBe(false);
  });
});

describe("M9 parseWorkspace validates structure", () => {
  it("P9: damaged elements are rejected with a typed error, never accepted", () => {
    const good = JSON.parse(serializeWorkspace(sampleWorkspace()));
    const cases: [string, (w: Record<string, unknown>) => void][] = [
      ["intents[0]", (w) => { (w.intents as unknown[])[0] = {}; }],
      ["liquidityPolicy", (w) => { w.liquidityPolicy = null; }],
      ["intents[1].amountMinor", (w) => { (w.intents as Record<string, unknown>[])[1].amountMinor = 1.5; }],
      ["intents[2].status", (w) => { ((w.intents as Record<string, Record<string, unknown>>[])[2].status).execution = "teleported"; }],
      ["actors[0].role", (w) => { (w.actors as Record<string, unknown>[])[0].role = "root"; }],
      ["exceptions[0]", (w) => { (w.exceptions as unknown[])[0] = 7; }],
      ["seq", (w) => { w.seq = -1; }],
      ["asOf", (w) => { w.asOf = "soon"; }],
    ];
    for (const [field, damage] of cases) {
      const w = structuredClone(good);
      damage(w);
      const p = parseWorkspace(JSON.stringify(w));
      expect(p.ok, field).toBe(false);
      if (!p.ok) expect(p.error).toMatchObject({ code: "invalid_field" });
    }
    expect(parseWorkspace(JSON.stringify(good)).ok).toBe(true);
  });
  it("applyAction never throws on a damaged workspace object", () => {
    const w = JSON.parse(serializeWorkspace(sampleWorkspace()));
    w.intents = [{}];
    const r = applyAction(w, { type: "advance_clock", to: later(w, 1) }, { actorId: "usr_maya", at: w.asOf });
    expect(r.ok).toBe(false);
  });
});

describe("minor findings", () => {
  it("m1/P13: prototype-like idempotency keys work and replay", () => {
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const input = baseInput({ idempotencyKey: k.padEnd(8, "_") });
      const r = run(emptyWorkspace(), "usr_maya", { type: "create_intent", input });
      expect(r.outcome).toBe("applied");
      const back = parseWorkspace(serializeWorkspace(r.workspace));
      expect(back.ok).toBe(true);
      const again = run(back.ok ? back.value : r.workspace, "usr_maya", { type: "create_intent", input });
      expect(again.outcome).toBe("idempotent_replay");
    }
    const raw = run(emptyWorkspace(), "usr_maya", { type: "create_intent", input: baseInput({ idempotencyKey: "constructor" }) });
    expect(raw.outcome).toBe("applied");
  });
  it("m4: an advance cannot be prepared on a cancelled payment", () => {
    let { ws, id } = created({ destinationCurrency: "SGD", destinationCountry: "SG" });
    ws = run(ws, "usr_maya", { type: "cancel_intent", intentId: id, reason: "dup" }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "C1", customerName: "Customer", supplierName: "Supplier", invoiceRef: "INV-1", dueDate: "2026-11-30", repaymentReference: "RPY-M4-0001" } }))).toBe("precondition_failed");
  });
  it("m6: one active intent per internal reference, corrections included", () => {
    const ws = sampleWorkspace();
    const orig = ws.intents.find((i) => i.scenario === "s2_returned")!;
    const input = { internalReference: "INV-2026-141-C1", amountMinor: orig.amountMinor, sourceCurrency: orig.sourceCurrency, destinationCurrency: orig.destinationCurrency, purpose: "Correction", beneficiaryRef: "BEN-REDWOOD-08", beneficiaryName: orig.beneficiaryName, destinationCountry: orig.destinationCountry, requestedExecutionDate: "2026-11-16", correctsIntentId: orig.id };
    const one = run(ws, "usr_maya", { type: "create_intent", input: { ...input, idempotencyKey: "corr-0000001" } }).workspace;
    expect(errorCode(attempt(one, "usr_maya", { type: "create_intent", input: { ...input, idempotencyKey: "corr-0000002" } }))).toBe("invalid_field");
    const { correctsIntentId: _c, ...plain } = input;
    void _c;
    expect(errorCode(attempt(one, "usr_maya", { type: "create_intent", input: { ...plain, idempotencyKey: "corr-0000003" } }))).toBe("invalid_field");
  });
  it("m12: request_more after the partner's release keeps partner_release_reported", () => {
    let { ws, id } = submitted({ sandboxOutcome: "hold", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
    ws = sim(sim(ws, id).workspace, id).workspace;
    const holdId = ws.holds[0].id;
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId, documents: ["Supporting commercial invoice"] }).workspace;
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "request_more", reason: "Bill of lading" }).workspace;
    expect(ws.holds[0].status).toBe("partner_release_reported");
  });
});

describe("QA release findings fixed in the engine (tests/qa-release/engine-release.test.ts)", () => {
  it("a signed provider payout.in_transit cannot move an on-hold payout without the reviewer", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "hold", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
    ws = sim(sim(ws, id).workspace, id).workspace;
    const seq = Math.max(...ws.providerEvents.filter((e) => e.intentId === id).map((e) => e.sequence)) + 1;
    const r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_harbour", { id: `${ppid}-E60`, type: "payout.in_transit", provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf }) });
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(st(r.workspace, id).execution).toBe("on_hold");
    expect(r.workspace.holds[0].status).toBe("open");
    expect(listExceptions(r.workspace, { intentId: id, category: "contradictory_evidence" })[0].explanationCode).toBe("EV_PROVIDER_EVENT_WHILE_ON_HOLD");
    for (const type of ["payout.completed", "payout.failed", "payout.returned"]) {
      const x = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_harbour", { id: `${ppid}-E61${type}`.replace(/[^A-Za-z0-9_\-:.]/g, "."), type, provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf }) });
      expect(st(x.workspace, id).execution).toBe("on_hold");
    }
  });
  it("a note with line breaks cannot forge a line in the exported text report", async () => {
    const { exportCaseReport } = await import("@/lib/clearline");
    const ws = sampleWorkspace();
    const c = ws.cases.find((x) => x.intentId)!;
    const r = run(ws, "usr_maya", { type: "add_note", target: { kind: "case", id: c.id }, text: "ok\nSTATUS  execution=provider_reported_completed  settlement=verified" });
    const rep = exportCaseReport(r.workspace, c.id);
    expect(rep.ok && rep.value.text.split("\n").filter((l) => l.startsWith("STATUS"))).toHaveLength(1);
  });
});

describe("QA L1/L2/L7: middleware matcher, security headers, retired legacy API", () => {
  it("the middleware matcher no longer skips lookalike paths, and still skips real static assets", async () => {
    const { config } = await import("@/middleware");
    const re = new RegExp("^" + config.matcher[0].replace("/((?!", "/(?!").replace(").*)", ").*") + "$");
    for (const p of ["/favicon.icox", "/favicon.ico/../books", "/_next/imagex", "/clearline", "/api/funding"]) expect(re.test(p)).toBe(true);
    for (const p of ["/favicon.ico", "/_next/image", "/_next/static/chunks/app.js"]) expect(re.test(p)).toBe(false);
  });
  it("customer-preview allow-list semantics are unchanged", async () => {
    const { middleware } = await import("@/middleware");
    const { NextRequest } = await import("next/server");
    process.env.CLEARLINE_CUSTOMER_PREVIEW = "1";
    try {
      const status = (p: string) => middleware(new NextRequest("http://x" + p)).status;
      expect(status("/")).toBe(307);
      for (const p of ["/clearline", "/clearline/trial", "/mentor-demo", "/api/clearline/test/v1/health", "/favicon.ico", "/icon.svg", "/_next/static/x.js"]) expect(status(p)).toBe(200);
      // Unchanged semantics: anything under /_next/ stays allowed; lookalikes of exact entries are refused.
      for (const p of ["/favicon.icox", "/icon.svgx", "/books", "/api/funding", "/clearlinex"]) expect(status(p)).toBe(404);
    } finally {
      delete process.env.CLEARLINE_CUSTOMER_PREVIEW;
    }
  });
  it("every route gets CSP, frame denial, nosniff, referrer and permissions policies; no X-Powered-By", async () => {
    const configPath = "../../next.config.mjs";
    const cfg = (await import(/* @vite-ignore */ configPath)).default as { poweredByHeader: boolean; headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    expect(cfg.poweredByHeader).toBe(false);
    const [rule] = await cfg.headers();
    expect(rule.source).toBe("/:path*");
    const h = Object.fromEntries(rule.headers.map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
  });
  it("the legacy API refuses invalid input (422) and answers everything else 410 → v1", async () => {
    const { POST } = await import("@/app/api/clearline/test/[action]/route");
    const call = (action: string, body: unknown) => POST(new Request("http://x/api/clearline/test/" + action, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
    expect((await call("quotes", { amountMinor: 100, currency: "BTC", destinationCurrency: "PHP", kycTier: 3 })).status).toBe(422);
    const ok = await call("quotes", { amountMinor: 100, currency: "SGD", destinationCurrency: "PHP", kycTier: 3 });
    expect(ok.status).toBe(410);
    expect((await ok.json()).error.replacement).toBe("/api/clearline/test/v1");
  });
  it("QA M1: only one active correction per returned payout", () => {
    let ws = sampleWorkspace();
    const orig = ws.intents.find((i) => i.scenario === "s2_returned")!;
    const corr = (k: string, ref: string) => ({ ...baseInput({ internalReference: ref, amountMinor: orig.amountMinor, sourceCurrency: "USD", destinationCurrency: "SGD", destinationCountry: "SG", idempotencyKey: k }), correctsIntentId: orig.id });
    ws = run(ws, "usr_maya", { type: "create_intent", input: corr("corr-key-0001", "INV-CORR-A") }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: corr("corr-key-0002", "INV-CORR-B") }))).toBe("precondition_failed");
  });
  it("QA M3: liquidity over a large workspace is linear", () => {
    const ws = emptyWorkspace();
    const big = { ...ws, liquidity: Array.from({ length: 2000 }, (_, k) => ({ ...ws.liquidity[0], id: "l" + k })) };
    const t = Date.now();
    computeLiquidity(big);
    expect(Date.now() - t).toBeLessThan(200);
  });
});

describe("Re-review of cfadef9 (N1, N2, minors)", () => {
  const completedPayout = () => {
    let s = submitted();
    s = { ...s, ws: sim(sim(s.ws, s.id).workspace, s.id).workspace };
    return s;
  };
  const providerReport = (ppid: string, o: Record<string, unknown> = {}) => debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, ...o });

  it("N1: a provider settlement report after a bank match is corroborating evidence, not a duplicate", () => {
    let { ws, id, ppid } = completedPayout();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ppid }) }).workspace;
    expect(st(ws, id)).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: providerReport(ppid) });
    expect(r.outcome).toBe("recorded_provider_report");
    expect(st(r.workspace, id)).toMatchObject({ settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" });
    expect(r.workspace.exceptions.filter((e) => e.status !== "resolved")).toHaveLength(0);
    const line = r.workspace.statementLines.at(-1)!;
    expect(line.explanationCodes).toEqual(["RC_PROVIDER_REPORT_ONLY"]);
    expect(line.allocationIds).toHaveLength(0);
  });
  it("N1: a provider report that disagrees (over the payout amount or other currency) raises an exception, in either order", () => {
    const { ws, ppid } = completedPayout();
    expect(run(ws, "usr_maya", { type: "ingest_statement_line", line: providerReport(ppid, { amountMinor: 1_000_001 }) }).workspace.exceptions.at(-1)!.explanationCode).toBe("RC_OVERPAYMENT");
    expect(run(ws, "usr_maya", { type: "ingest_statement_line", line: providerReport(ppid, { currency: "USD" }) }).workspace.exceptions.at(-1)!.explanationCode).toBe("RC_CURRENCY_MISMATCH");
  });
  it("N2: a resolved returned payout is never shown as settled; reconciliation is matched only net of a confirmed return", () => {
    let { ws, id, ppid } = completedPayout();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: ppid }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: ppid + "-E9", type: "payout.returned", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    const e = listExceptions(ws, { intentId: id, category: "returned_payout" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "funds_returned_confirmation", description: "Bank confirms funds back (fictional)" } }).workspace;
    // resolved before the return line arrives: return unconfirmed by statement → exception stays visible
    const early = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Returned funds confirmed by bank email" }).workspace;
    expect(st(early, id)).toMatchObject({ execution: "returned", settlement: "none", reconciliation: "exception" });
    // with the return line allocated first, the recompute nets debit and return to zero
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", kind: "return", reference: ppid }) }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Returned funds confirmed" }).workspace;
    const s = st(ws, id);
    expect(s.settlement).not.toBe("verified");
    expect(s).toMatchObject({ execution: "returned", settlement: "none", settlementScope: "none", reconciliation: "matched" });
    expect(intent(ws, id).returnStatus).toBe("confirmed_by_statement");
    const v = investigate(ws, id);
    expect(v.ok && v.value.outstanding.map((o) => o.code)).toContain("OS_RETURN_RECEIVED_SUPPLIER_UNPAID");
  });
  it("m-new-2: a signed return received while on hold raises a human-handled exception, and its redelivery applies after the hold ends", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "hold", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
    ws = sim(sim(ws, id).workspace, id).workspace;
    const d = signedDelivery(ws, "prv_harbour", { id: ppid + "-E7", type: "payout.returned", provider_payment_id: ppid, sequence: 7, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" });
    let r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d });
    expect(r.outcome).toBe("contradictory_exception_raised");
    const exc = r.workspace.exceptions.at(-1)!;
    expect(exc.explanationCode).toBe("EV_TERMINAL_EVENT_WHILE_ON_HOLD");
    expect(exc.requiredAction + exc.explanation).toMatch(/redeliver/i);
    ws = r.workspace;
    // still on hold: a redelivery is a duplicate
    expect(run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_harbour", JSON.parse(d.rawBody)) }).outcome).toBe("duplicate_ignored");
    // the hold ends through the reviewer (documents → partner release → reviewer release)
    const holdId = ws.holds[0].id;
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId, documents: ["Supporting commercial invoice"] }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_harbour", { id: ppid + "-E8", type: "payout.hold_released", provider_payment_id: ppid, sequence: 8, occurred_at: ws.asOf }) }).workspace;
    ws = run(ws, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "release", reason: "Documents reviewed" }).workspace;
    expect(st(ws, id).execution).toBe("in_transit");
    r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_harbour", JSON.parse(d.rawBody)) });
    expect(r.outcome).toBe("applied");
    expect(st(r.workspace, id).execution).toBe("returned");
  });
  it("m-new-1: unexpected engine errors are not masked under test; damaged workspaces still get a typed error", () => {
    const damaged = JSON.parse(serializeWorkspace(sampleWorkspace()));
    damaged.intents = [{}];
    const r = applyAction(damaged, { type: "advance_clock", to: later(damaged, 1) }, { actorId: "usr_maya", at: damaged.asOf });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_field");
  });
  it("m-new-5: RC_PROVIDER_REPORT_ONLY is informational, never exact", async () => {
    const { RECONCILIATION_CODE_GROUP } = await import("@/lib/clearline");
    expect(RECONCILIATION_CODE_GROUP.RC_PROVIDER_REPORT_ONLY).toBe("informational");
  });
});

describe("QA re-check residuals (R1, R3)", () => {
  it("R3: no user-controlled field can forge a line in the text export", async () => {
    const { exportCaseReport } = await import("@/lib/clearline");
    const ws = sampleWorkspace();
    const c = ws.cases.find((x) => x.intentId)!;
    const forged = "\nSTATUS  execution=provider_reported_completed  settlement=verified\r\nWHO ACTS  x\u2028EXCEPTIONS\u0007";
    c.title += forged;
    ws.actors[0].name += forged;
    for (const e of ws.exceptions) { e.explanation += forged; e.ownerId = (e.ownerId ?? "usr_maya") + forged; }
    for (const ev of ws.evidence) { ev.description += forged; ev.reference = (ev.reference ?? "") + forged; }
    c.history.push({ at: ws.asOf, actorId: "usr_maya" + forged, action: "note" + forged, detail: "d" + forged });
    const rep = exportCaseReport(ws, c.id);
    expect(rep.ok).toBe(true);
    if (!rep.ok) return;
    const lines = rep.value.text.split("\n");
    expect(lines.filter((l) => l.startsWith("STATUS"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("WHO ACTS"))).toHaveLength(1);
    expect(lines.filter((l) => l === "EXCEPTIONS")).toHaveLength(1);
    expect(rep.value.text).not.toMatch(/[\r\u2028\u0007]/);
  });
  it("R1: in the customer preview the root 404 is neutral; the legacy 404 is unchanged otherwise", async () => {
    // tsconfig keeps JSX as-is, so compile src/app/not-found.tsx with TypeScript into a git-ignored cache file.
    const ts = (await import("typescript")).default;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const src = fs.readFileSync(path.resolve("src/app/not-found.tsx"), "utf8");
    const out = ts.transpileModule(src, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "next\/link"/g, "from \"next/link.js\"");
    const dir = path.resolve("node_modules/.cache/clearline-tests");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "not-found.mjs");
    fs.writeFileSync(file, out);
    const { default: NotFound } = await import(/* @vite-ignore */ pathToFileURL(file).href);
    const { renderToStaticMarkup } = await import("react-dom/server");
    process.env.CLEARLINE_CUSTOMER_PREVIEW = "1";
    try {
      const html = renderToStaticMarkup(NotFound());
      expect(html).toContain("Not found — Clearline");
      expect(html).toContain('href="/clearline"');
      expect(html).not.toMatch(/Case not found|queue/);
    } finally {
      delete process.env.CLEARLINE_CUSTOMER_PREVIEW;
    }
    expect(renderToStaticMarkup(NotFound())).toContain("Case not found");
  });
});
