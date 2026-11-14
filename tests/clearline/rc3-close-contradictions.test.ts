/**
 * rc3 Priority A — close and contradiction rules (invariant 8).
 * - X-1: nothing closes a case without matching evidence (failed before the fix in exceptions.ts canResolveCase).
 * - X-2: every contradiction has an open owner — an open exception a person must act on, and "who acts" is
 *   never "nobody" while a contradiction is shown (property over a battery of adversarial flows).
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, canResolveCase, getAdapter, investigate, parseWorkspace, listExceptions, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace } from "@/lib/clearline";
import { attempt, debitLine, errorCode, intent, run, sim, signedDelivery, submitted } from "./helpers";

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
    // Re-review R-M2: acceptance is explicit. A plain resolution of the over-amount exception does not count…
    const over = listExceptions(ws, { intentId: id }).find((e) => e.explanationCode === "RC_OVERPAYMENT")!;
    const plain = resolveAll(ws, id);
    const caseId = intent(ws, id).caseId!;
    expect(canResolveCase(assign(plain, "case", caseId), caseId).code).toBe("EVIDENCE_OUTSTANDING");
    // …the person accepts the SGD 0.50 difference explicitly (resolve with acceptDifference: true).
    ws = assign(ws, "exception", over.id);
    ws = evidence(ws, over.id);
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: over.id }, note: "Bank fee of SGD 0.50 added on top; confirmed with the bank", acceptDifference: true }).workspace;
    expect(ws.exceptions.find((e) => e.id === over.id)!.resolution!.acceptedDifference).toMatchObject({ differenceMinor: 50, currency: "SGD" });
    ws = assign(ws, "case", caseId);
    // Before the fix: EVIDENCE_OUTSTANDING forever (no action can allocate the line).
    const check = canResolveCase(ws, caseId);
    expect(check).toMatchObject({ allowed: true, code: "RESOLVABLE" });
    // (value change, R-M2: the reason no longer says "evidenced by"; it names the line, the person and the accepted amount)
    expect(check.reason).toMatch(/bank debit .* carries this payment's reference but was not matched; usr_maya accepted the SGD 0\.50 over-amount/);
    expect(check.reason).not.toMatch(/evidenced by/);
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

describe("re-review R-M2: only a small over-amount on a debit that matches the payment, explicitly accepted by a person, lets the case close", () => {
  const completed = () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    return { ws, id, ppid };
  };
  const lineException = (ws: Workspace, id: string) => ws.exceptions.filter((e) => e.intentId === id && e.statementLineId).at(-1)!;
  const tryAccept = (ws: Workspace, excId: string) => {
    ws = assign(ws, "exception", excId);
    ws = evidence(ws, excId);
    return { ws, r: attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "Accept", acceptDifference: true }) };
  };
  const accepted = () => {
    let { ws, id, ppid } = completed();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, amountMinor: 1_000_050 }) }).workspace;
    const exc = lineException(ws, id);
    const t = tryAccept(ws, exc.id);
    if (!t.r.ok) throw new Error(t.r.error.message);
    ws = t.r.value.workspace;
    const caseId = intent(ws, id).caseId!;
    ws = assign(ws, "case", caseId);
    expect(canResolveCase(ws, caseId).code).toBe("RESOLVABLE");
    return { ws, id, caseId, excId: exc.id };
  };

  const bad: [string, Record<string, unknown>, string][] = [
    ["USD 0.01 (other currency)", { currency: "USD", accountRef: "BANK-USD-TEST", amountMinor: 1 }, "RC_CURRENCY_MISMATCH"],
    ["SGD 9,999,999.00 (far above the payout)", { amountMinor: 999_999_900 }, "RC_OVERPAYMENT"],
    ["value date 2025-01-01 (outside the window)", { valueDate: "2025-01-01" }, "RC_OUTSIDE_TIME_WINDOW"],
    // (value change, second re-review R2-M2: "1% + 0.01" is no longer refused outright — it needs a second
    //  person's approval; covered by "R2-M2 (c)" below. Above 50% stays refused:)
    ["SGD 15,000.01 (50% + 0.01 over)", { amountMinor: 1_500_001 }, "RC_OVERPAYMENT"],
  ];
  for (const [what, line, code] of bad)
    it(`refused: ${what} — cannot be accepted, and a plain resolution ("not ours") never lets the case close`, () => {
      let { ws, id, ppid } = completed();
      ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, ...line }) }).workspace;
      const exc = lineException(ws, id);
      expect(exc.explanationCode).toBe(code);
      const t = tryAccept(ws, exc.id);
      expect(errorCode(t.r)).toBe("precondition_failed");
      expect(!t.r.ok && t.r.error.message).toMatch(/^DIFFERENCE_NOT_ACCEPTABLE: /);
      // Before the fix: resolving with any note let the case close ("The payment is evidenced by bank line …").
      ws = run(t.ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "This line is not ours; recall requested" }).workspace;
      const caseId = intent(ws, id).caseId!;
      ws = assign(ws, "case", caseId);
      expect(canResolveCase(ws, caseId).code).toBe("EVIDENCE_OUTSTANDING");
    });

  it("boundary: exactly 1% over (SGD 10,100.00 on SGD 10,000.00) can be accepted", () => {
    let { ws, id, ppid } = completed();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, amountMinor: 1_010_000 }) }).workspace;
    const t = tryAccept(ws, lineException(ws, id).id);
    expect(t.r.ok).toBe(true);
  });

  it("stored data: the acceptance stops counting if the line no longer names the payout, became a credit, changed currency, or was 'accepted' by the system", () => {
    const base = accepted();
    const tamper = (f: (w: Workspace) => void) => {
      const w = JSON.parse(serializeWorkspace(base.ws)) as Workspace;
      f(w);
      return canResolveCase(w, base.caseId).code;
    };
    const lineOf = (w: Workspace) => w.statementLines.find((l) => l.id === w.exceptions.find((e) => e.id === base.excId)!.statementLineId)!;
    expect(tamper(() => {})).toBe("RESOLVABLE");
    expect(tamper((w) => { lineOf(w).reference = "PAYOUT SOMETHING-ELSE"; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tamper((w) => { lineOf(w).direction = "credit"; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tamper((w) => { lineOf(w).currency = "USD"; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tamper((w) => { w.exceptions.find((e) => e.id === base.excId)!.resolution!.actorId = "system"; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tamper((w) => { delete w.exceptions.find((e) => e.id === base.excId)!.resolution!.acceptedDifference; })).toBe("EVIDENCE_OUTSTANDING");
    // each rule on its own (other checks kept satisfied):
    const exc = (w: Workspace) => w.exceptions.find((e) => e.id === base.excId)!;
    expect(tamper((w) => { lineOf(w).currency = "USD"; exc(w).resolution!.acceptedDifference!.currency = "USD"; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tamper((w) => { lineOf(w).valueDate = "2025-01-01"; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tamper((w) => { exc(w).explanationCode = "RC_DUPLICATE_SUSPECTED"; })).toBe("EVIDENCE_OUTSTANDING");
  });

  it("acceptDifference is refused on a case target and validated as a boolean", () => {
    const { ws, caseId } = accepted();
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "x", acceptDifference: true }))).toBe("invalid_field");
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "x", acceptDifference: "yes" as unknown as boolean }))).toBe("invalid_field");
  });
});

describe("second re-review R2-M2: legitimate success cases can close — explicitly, bounded, and with maker ≠ checker above 1%", () => {
  const completedPayout = (amountMinor = 1_000_000) => {
    let { ws, id, ppid } = submitted({ amountMinor });
    ws = sim(sim(ws, id).workspace, id).workspace;
    return { ws, id, ppid };
  };
  const withLine = (amountMinor: number, line: Record<string, unknown>) => {
    let { ws, id, ppid } = completedPayout(amountMinor);
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, amountMinor, ...line }) }).workspace;
    const exc = ws.exceptions.filter((e) => e.intentId === id && e.statementLineId).at(-1)!;
    ws = assign(ws, "exception", exc.id);
    ws = evidence(ws, exc.id);
    return { ws, id, exc, caseId: intent(ws, id).caseId! };
  };
  const resolveWith = (ws: Workspace, excId: string, flags: { acceptDifference?: boolean; acceptLateDate?: boolean }, actor = "usr_maya") =>
    attempt(ws, actor, { type: "resolve", target: { kind: "exception", id: excId }, note: "Confirmed with the bank (fictional)", ...flags });
  const closeCheck = (ws: Workspace, caseId: string) => canResolveCase(assign(ws, "case", caseId), caseId);

  it("(a) exact amount, late value date (10+ days after submission): acceptLateDate by one staff person lets the case close, with honest wording", () => {
    const { ws, exc, caseId } = withLine(1_000_000, { valueDate: "2026-11-30" });
    expect(exc.explanationCode).toBe("RC_OUTSIDE_TIME_WINDOW");
    // Before the fix: no way to accept it — EVIDENCE_OUTSTANDING forever.
    expect(errorCode(resolveWith(ws, exc.id, { acceptDifference: true }))).toBe("precondition_failed"); // wrong flag: there is no over-amount
    const r = resolveWith(ws, exc.id, { acceptLateDate: true });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.workspace.exceptions.find((e) => e.id === exc.id)!.resolution!.acceptedDifference).toMatchObject({ differenceMinor: 0, lateValueDate: "2026-11-30" });
    const check = closeCheck(r.value.workspace, caseId);
    expect(check).toMatchObject({ allowed: true, code: "RESOLVABLE" });
    expect(check.reason).toMatch(/accepted the late value date \(2026-11-30\); amount and currency match the payment exactly/);
  });
  it("(a) bounds: a late date more than 60 days after submission, or before submission, is never acceptable; a plain resolution never counts", () => {
    for (const valueDate of ["2027-02-01", "2025-01-01"]) {
      const { ws, exc, caseId } = withLine(1_000_000, { valueDate });
      const r = resolveWith(ws, exc.id, { acceptLateDate: true });
      expect(!r.ok && r.error.message).toMatch(/^DIFFERENCE_NOT_ACCEPTABLE: /);
      expect(closeCheck(run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Plain" }).workspace, caseId).code).toBe("EVIDENCE_OUTSTANDING");
    }
  });
  it("(c) SGD 100.00 payout debited SGD 115.00 (a fixed 15.00 charge, 15%): accepted by one person, then the case says it needs a second person's approval; the same person cannot approve; a different staff person can", () => {
    const { ws: w0, exc, caseId } = withLine(10_000, { amountMinor: 11_500 });
    expect(exc.explanationCode).toBe("RC_OVERPAYMENT");
    const r = resolveWith(w0, exc.id, { acceptDifference: true });
    if (!r.ok) throw new Error(r.error.message); // before the fix: DIFFERENCE_NOT_ACCEPTABLE
    let ws = r.value.workspace;
    expect(ws.exceptions.find((e) => e.id === exc.id)!.resolution!.acceptedDifference).toMatchObject({ differenceMinor: 1_500, secondApproval: { required: true } });
    const blocked = closeCheck(ws, caseId);
    expect(blocked.code).toBe("SECOND_APPROVAL_REQUIRED");
    expect(blocked.reason).toMatch(/needs a second person's approval/);
    expect(errorCode(attempt(ws, "usr_maya", { type: "approve_acceptance", exceptionId: exc.id, note: "Self-approve" }))).toBe("maker_checker_violation");
    expect(errorCode(attempt(ws, "usr_alex", { type: "approve_acceptance", exceptionId: exc.id, note: "Viewer" }))).toBe("unauthorized_actor");
    ws = run(ws, "usr_sam", { type: "approve_acceptance", exceptionId: exc.id, note: "Bank tariff confirms the SGD 15.00 charge (fictional)" }).workspace;
    const ok = closeCheck(ws, caseId);
    expect(ok).toMatchObject({ allowed: true, code: "RESOLVABLE" });
    expect(ok.reason).toMatch(/usr_maya accepted the SGD 15\.00 over-amount, and usr_sam approved the acceptance/);
    expect(errorCode(attempt(ws, "usr_daniel", { type: "approve_acceptance", exceptionId: exc.id, note: "Again" }))).toBe("invalid_transition");
  });
  it("(c) late AND over 1% needs both flags and the second approval; at most 1% has nothing to approve", () => {
    const { ws, exc, caseId } = withLine(10_000, { amountMinor: 11_500, valueDate: "2026-11-30" });
    expect(errorCode(resolveWith(ws, exc.id, { acceptDifference: true }))).toBe("precondition_failed");
    const r = resolveWith(ws, exc.id, { acceptDifference: true, acceptLateDate: true });
    if (!r.ok) throw new Error(r.error.message);
    expect(closeCheck(r.value.workspace, caseId).code).toBe("SECOND_APPROVAL_REQUIRED");
    const small = withLine(1_000_000, { amountMinor: 1_000_050 });
    const s2 = resolveWith(small.ws, small.exc.id, { acceptDifference: true });
    if (!s2.ok) throw new Error(s2.error.message);
    expect(errorCode(attempt(s2.value.workspace, "usr_sam", { type: "approve_acceptance", exceptionId: small.exc.id, note: "n/a" }))).toBe("invalid_transition");
  });
  it("(d) currency mismatch: never acceptable; the case says why (no FX evidence) and what would be needed", () => {
    const { ws, exc, caseId } = withLine(1_000_000, { currency: "USD", accountRef: "BANK-USD-TEST" });
    expect(exc.explanationCode).toBe("RC_CURRENCY_MISMATCH");
    const r = resolveWith(ws, exc.id, { acceptDifference: true });
    expect(!r.ok && r.error.message).toMatch(/no FX evidence/);
    const plain = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Bank used the wrong account" }).workspace;
    const check = closeCheck(plain, caseId);
    expect(check.code).toBe("EVIDENCE_OUTSTANDING");
    expect(check.reason).toMatch(/is in USD, not SGD: it cannot be accepted, because the sandbox holds no FX evidence .* Obtain the SGD statement line instead\./);
  });
  it("R2-m1: the EVIDENCE_OUTSTANDING text describes the explicit acceptance rule (not 'a person must resolve')", () => {
    let { ws, id, ppid } = completedPayout();
    const d1 = signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.completed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d1 }).workspace;
    const d2 = signedDelivery(ws, "prv_northline", { id: `${ppid}-E9`, type: "payout.completed", provider_payment_id: ppid, sequence: 9, occurred_at: ws.asOf, reason: "timeout" });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d2 }).workspace;
    const dup = listExceptions(ws, { intentId: id, category: "duplicate_event" })[0];
    ws = assign(ws, "exception", dup.id);
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: dup.id }, note: "First payload is authoritative" }).workspace;
    const caseId = intent(ws, id).caseId!;
    const check = canResolveCase(assign(ws, "case", caseId), caseId);
    expect(check.code).toBe("EVIDENCE_OUTSTANDING");
    // Before the fix: "… or a person must resolve, with evidence, the exception on a bank line …" (stale since R-M2).
    expect(check.reason).not.toMatch(/a person must resolve, with evidence/);
    expect(check.reason).toMatch(/explicitly accepts a bank debit .*acceptDifference.*acceptLateDate/);
  });
  it("R2-m2: a provider settlement report's over-amount is never acceptable, even explicitly", () => {
    let { ws, id, ppid } = completedPayout();
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, amountMinor: 1_000_050 }) }).workspace;
    const exc = ws.exceptions.filter((e) => e.intentId === id && e.statementLineId).at(-1)!;
    expect(exc.explanationCode).toBe("RC_OVERPAYMENT");
    ws = assign(ws, "exception", exc.id);
    ws = evidence(ws, exc.id);
    const r = resolveWith(ws, exc.id, { acceptDifference: true });
    expect(!r.ok && r.error.message).toMatch(/^DIFFERENCE_NOT_ACCEPTABLE: Only an outgoing bank-statement debit/);
  });
  it("close-time re-check on stored data: an above-1% acceptance missing its approval record, or approved by the same person, never closes the case", () => {
    const { ws: w0, exc, caseId } = withLine(10_000, { amountMinor: 11_500 });
    let ws = (resolveWith(w0, exc.id, { acceptDifference: true }) as { ok: true; value: { workspace: Workspace } }).value.workspace;
    ws = run(ws, "usr_sam", { type: "approve_acceptance", exceptionId: exc.id, note: "Checked (fictional)" }).workspace;
    ws = assign(ws, "case", caseId);
    expect(canResolveCase(ws, caseId).code).toBe("RESOLVABLE");
    // canResolveCase directly on the tampered object: the close-time re-check must refuse on its own
    // (parse refuses some of these too — see the next test — but the console calls canResolveCase on the state it holds).
    const tampered = (f: (e: Workspace["exceptions"][number]) => void) => {
      const w = JSON.parse(serializeWorkspace(ws)) as Workspace;
      f(w.exceptions.find((e) => e.id === exc.id)!);
      return canResolveCase(w, caseId).code;
    };
    expect(tampered((e) => { delete e.resolution!.acceptedDifference!.secondApproval; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tampered((e) => { e.resolution!.acceptedDifference!.secondApproval!.approvedBy = e.resolution!.actorId; })).toBe("EVIDENCE_OUTSTANDING");
    expect(tampered((e) => { e.resolution!.acceptedDifference!.secondApproval!.approvedBy = "usr_alex"; })).toBe("EVIDENCE_OUTSTANDING"); // a viewer
  });
  it("R2-m2: parse refuses a forged acceptance (difference that does not match the line, or self-approval)", () => {
    const { ws: w0, exc } = withLine(10_000, { amountMinor: 11_500 });
    let ws = (resolveWith(w0, exc.id, { acceptDifference: true }) as { ok: true; value: { workspace: Workspace } }).value.workspace;
    ws = run(ws, "usr_sam", { type: "approve_acceptance", exceptionId: exc.id, note: "Checked (fictional)" }).workspace;
    const forge = (f: (e: Workspace["exceptions"][number]) => void) => {
      const w = JSON.parse(serializeWorkspace(ws)) as Workspace;
      f(w.exceptions.find((e) => e.id === exc.id)!);
      const r = parseWorkspace(serializeWorkspace(w));
      return r.ok ? "accepted" : r.error.field;
    };
    expect(forge(() => {})).toBe("accepted");
    expect(forge((e) => { e.resolution!.acceptedDifference!.differenceMinor = 49; })).toMatch(/acceptedDifference\.differenceMinor$/);
    expect(forge((e) => { e.resolution!.acceptedDifference!.secondApproval!.approvedBy = e.resolution!.actorId; })).toMatch(/secondApproval\.approvedBy$/);
    expect(forge((e) => { e.resolution!.acceptedDifference!.lateValueDate = "2026-12-01"; })).toMatch(/lateValueDate$/);
  });
});
