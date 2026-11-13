/**
 * rc3 Priority A — close and contradiction rules (invariant 8).
 * - X-1: nothing closes a case without matching evidence (failed before the fix in exceptions.ts canResolveCase).
 * - X-2: every contradiction has an open owner — an open exception a person must act on, and "who acts" is
 *   never "nobody" while a contradiction is shown (property over a battery of adversarial flows).
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, canResolveCase, getAdapter, investigate, listExceptions, sampleWorkspace, scenarioIntentId, type Workspace } from "@/lib/clearline";
import { debitLine, intent, run, sim, signedDelivery, submitted } from "./helpers";

const assign = (ws: Workspace, kind: "case" | "exception", id: string) => run(ws, "usr_maya", { type: "assign_owner", target: { kind, id }, ownerId: "usr_maya" }).workspace;
const evidence = (ws: Workspace, id: string) => run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id }, evidence: { kind: "document_metadata", description: "Supporting document (fictional)" } }).workspace;

describe("rc3 X-1: a case closes only on matching evidence", () => {
  it("a provider-completed payout with no statement evidence cannot close its case; a matched bank line lets it close", () => {
    let { ws, id, ppid } = submitted();
    // a duplicate-payload event opens a case with a low-severity exception that a note can resolve
    ws = sim(ws, id).workspace; // in_transit
    const d1 = signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.completed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d1 }).workspace;
    const d2 = signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.completed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "timeout" });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d2 }).workspace;
    const exc = listExceptions(ws, { intentId: id, category: "duplicate_event" })[0];
    ws = assign(ws, "exception", exc.id);
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Provider confirmed the first payload is authoritative" }).workspace;
    const caseId = intent(ws, id).caseId!;
    ws = assign(ws, "case", caseId);
    expect(intent(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "none" });
    // Before the fix: RESOLVABLE — the case closed on the provider's completion claim alone.
    expect(canResolveCase(ws, caseId).code).toBe("EVIDENCE_OUTSTANDING");
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `NORTHLINE PAYOUT ${ppid}` }) });
    expect(intent(r.workspace, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    expect(canResolveCase(r.workspace, caseId)).toMatchObject({ allowed: true, code: "RESOLVABLE" });
  });

  it("the funding case stays open while SGD 20,000.00 is outstanding, even with every exception resolved", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s5_funding")!;
    const caseId = intent(ws, id).caseId!;
    for (const e of listExceptions(ws, { status: "unresolved" }).filter((x) => x.caseId === caseId)) {
      ws = assign(ws, "exception", e.id);
      ws = evidence(ws, e.id);
      ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Receipt reviewed; it is not the customer's repayment" }).workspace;
    }
    ws = assign(ws, "case", caseId);
    // Before the fix: RESOLVABLE while the customer still owed SGD 20,000.00.
    expect(canResolveCase(ws, caseId).code).toBe("OUTSTANDING_REMAINS");
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "RC3-RPY-2", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 2_000_000, currency: "SGD", reference: "RPY-SEABRIGHT-0001 FINAL", counterparty: "SEABRIGHT TRADING", valueDate: "2026-11-13" } });
    expect(r.outcome).toBe("allocated");
    expect(canResolveCase(r.workspace, caseId)).toMatchObject({ allowed: true });
  });
});

/** Adversarial flows: each returns a workspace with at least one contradiction. */
function battery(): [string, Workspace][] {
  const out: [string, Workspace][] = [];
  const sample = sampleWorkspace();
  out.push(["sample", sample]);
  for (const s of ["s1_success", "s2_returned", "s4_chain", "s5_funding"] as const) {
    const id = scenarioIntentId(sample, s)!;
    out.push([`${s} contradictory provider event`, sim(sample, id, "contradictory").workspace]);
  }
  // s4 reorg after finality
  {
    let ws = sim(sample, scenarioIntentId(sample, "s4_chain")!).workspace;
    const o = ws.chainObservations[0];
    const { id: _a, observedAt: _b, updatedAt: _c, finalityThreshold: _d, status: _e, label: _f, ...input } = o;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...input, confirmations: 1 } }).workspace;
    out.push(["s4 reorg", ws]);
  }
  // returned → resolved → late debit (final check C2)
  {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    const exc = listExceptions(ws, { intentId: id, category: "returned_payout" })[0];
    ws = assign(ws, "exception", exc.id);
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "funds_returned_confirmation", description: "Funds back (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Funds back" }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `NORTHLINE PAYOUT ${ppid}` }) }).workspace;
    out.push(["returned, resolved, late debit", ws]);
  }
  // provider report then failed; debit then failed
  for (const src of ["provider_settlement_report", "bank_statement"] as const) {
    let { ws, id, ppid } = submitted();
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: src, reference: `PAYOUT ${ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, "prv_northline", { id: `${ppid}-E7`, type: "payout.failed", provider_payment_id: ppid, sequence: 7, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
    out.push([`${src} then failed`, ws]);
  }
  // reversal contradicting completion; same id different payload
  {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", kind: "reversal", reference: `REVERSAL ${ppid}` }) }).workspace;
    out.push(["reversal on completed", ws]);
  }
  return out;
}

describe("rc3 X-2: every contradiction has an open owner", () => {
  it("for every payout in every flow, a shown contradiction (or contradicted settlement) has an open exception and someone who acts", () => {
    let checked = 0;
    for (const [name, ws] of battery()) {
      for (const i of ws.intents) {
        const v = investigate(ws, i.id);
        if (!v.ok) continue;
        if (!v.value.contradictions.length && i.status.settlement !== "contradicted") continue;
        checked++;
        const open = v.value.exceptions.filter((e) => e.status !== "resolved");
        expect(`${name} ${i.id}: open=${open.length}`).not.toBe(`${name} ${i.id}: open=0`);
        expect(`${name} ${i.id}: ${v.value.whoActs.code}`).not.toBe(`${name} ${i.id}: WA_NONE`);
        expect(v.value.nextActions.map((n) => n.code)).not.toContain("NA_NONE");
      }
    }
    expect(checked).toBeGreaterThanOrEqual(9);
  });

  it("resolving every open exception that a person may resolve never leaves a contradicted settlement without an open item", () => {
    for (const [name, ws0] of battery()) {
      let ws = ws0;
      for (let pass = 0; pass < 3; pass++)
        for (const e of listExceptions(ws, { status: "unresolved" })) {
          if (e.category === "compliance_hold" || e.category === "pending_finality" || e.category === "provider_timeout" || e.category === "overdue_advance" || e.category === "funding_shortfall") continue;
          if (e.category === "returned_payout") continue; // needs a correction or confirmation (covered above)
          ws = assign(ws, "exception", e.id);
          ws = evidence(ws, e.id);
          ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Reviewed with evidence" }).workspace;
        }
      for (const i of ws.intents) {
        if (i.status.settlement !== "contradicted") continue;
        const open = listExceptions(ws, { status: "unresolved", intentId: i.id });
        expect(`${name} ${i.id}: open=${open.length}`).not.toBe(`${name} ${i.id}: open=0`);
      }
    }
  });
});

describe("review M-2: an evidenced success case can close after a person accepts a disagreeing bank line", () => {
  const completed = () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    return { ws, id, ppid };
  };
  const resolveAll = (ws: Workspace, id: string) => {
    for (const e of listExceptions(ws, { intentId: id, status: "unresolved" })) {
      ws = assign(ws, "exception", e.id);
      ws = evidence(ws, e.id);
      ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: e.id }, note: "Bank fee of SGD 0.50 added on top; confirmed with the bank" }).workspace;
    }
    return ws;
  };
  it("bank debits SGD 10,000.50 for a SGD 10,000.00 payout → RC_OVERPAYMENT → person resolves with evidence → the case can close", () => {
    let { ws, id, ppid } = completed();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, amountMinor: 1_000_050 }) }).workspace;
    expect(listExceptions(ws, { intentId: id }).map((e) => e.explanationCode)).toContain("RC_OVERPAYMENT");
    ws = resolveAll(ws, id);
    const caseId = intent(ws, id).caseId!;
    ws = assign(ws, "case", caseId);
    // Before the fix: EVIDENCE_OUTSTANDING forever (no action can allocate the line).
    const check = canResolveCase(ws, caseId);
    expect(check).toMatchObject({ allowed: true, code: "RESOLVABLE" });
    expect(check.reason).toMatch(/RC_OVERPAYMENT/);
    expect(run(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "Paid; fee accepted" }).workspace.cases.find((c) => c.id === caseId)!.status).toBe("resolved");
  });
  it("still blocked: the same over-amount line from a provider settlement report (not independent evidence)", () => {
    let { ws, id, ppid } = completed();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, amountMinor: 1_000_050 }) }).workspace;
    ws = resolveAll(ws, id);
    const caseId = intent(ws, id).caseId!;
    ws = assign(ws, "case", caseId);
    expect(canResolveCase(ws, caseId).code).toBe("EVIDENCE_OUTSTANDING");
  });
  it("still blocked: a debit with no reference that only matches on amount (it names no payout), even once resolved", () => {
    let { ws, id, ppid } = completed();
    // open the payout's case with a duplicate-payload event (resolvable with a note)
    const d1 = signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.completed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d1 }).workspace;
    const d2 = signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.completed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "timeout" });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d2 }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: "", amountMinor: 1_000_000 }) }).workspace;
    const amountOnly = ws.exceptions.at(-1)!;
    expect(amountOnly.explanationCode).toBe("RC_AMOUNT_ONLY_CANDIDATES");
    expect(amountOnly.candidates).toContain(id);
    ws = assign(ws, "exception", amountOnly.id);
    ws = evidence(ws, amountOnly.id);
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: amountOnly.id }, note: "Looks like ours" }).workspace;
    ws = resolveAll(ws, id);
    const caseId = intent(ws, id).caseId!;
    ws = assign(ws, "case", caseId);
    expect(canResolveCase(ws, caseId).code).toBe("EVIDENCE_OUTSTANDING");
  });
});

describe("review m-5: X-1 needs reconciliation matched as well as verified settlement", () => {
  it("a final chain transfer the provider never named (verified, reconciliation pending) cannot close the case", () => {
    let { ws, id } = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");
    ws = sim(ws, id).workspace; // in_transit
    const i = intent(ws, id);
    const obs = { intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC", txHash: "0x" + "77".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(i), amountMinor: ws.quotes.find((q) => q.id === i.selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 9, confirmations: 3 };
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obs }).workspace; // pending_finality → exception + case
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations: 12 } }).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", reconciliation: "pending" });
    const pf = listExceptions(ws, { intentId: id, category: "pending_finality" })[0];
    ws = assign(ws, "exception", pf.id);
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: pf.id }, note: "Final" }).workspace;
    const caseId = intent(ws, id).caseId!;
    ws = assign(ws, "case", caseId);
    expect(canResolveCase(ws, caseId).code).toBe("EVIDENCE_OUTSTANDING");
  });
});
