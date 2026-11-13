/**
 * Code review v2 (CODE_REVIEW_V2.md, c498da6): M1–M3, m1–m4 and engine nits.
 * Fictional sandbox data only.
 */
import { describe, expect, it } from "vitest";
import {
  CODE_LABELS,
  RECONCILIATION_CODE_GROUP,
  TERMINAL_FOR_SETTLEMENT_REPORT,
  describeCode,
  describeStatus,
  fundingProjection,
  investigate,
  listExceptions,
  parseWorkspace,
  sampleWorkspace,
  scenarioIntentId,
  serializeWorkspace,
  type InvestigationView,
  type Workspace,
} from "@/lib/clearline";
import { debitLine, intent, run, signedDelivery, sim, submitted } from "./helpers";

const st = (ws: Workspace, id: string) => intent(ws, id).status;
const providerReport = (ppid: string, o: Record<string, unknown> = {}) =>
  debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, ...o });
const ingest = (ws: Workspace, line: ReturnType<typeof debitLine>) => run(ws, "usr_maya", { type: "ingest_statement_line", line });
const completedPayout = () => {
  const s = submitted();
  return { ...s, ws: sim(sim(s.ws, s.id).workspace, s.id).workspace };
};
const webhook = (ws: Workspace, ppid: string, type: string, seq: number, providerId = "prv_northline") =>
  run(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, providerId, { id: `${ppid}-E${seq}`, type, provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) }).workspace;
const view = (ws: Workspace, id: string): InvestigationView => {
  const v = investigate(ws, id);
  if (!v.ok) throw new Error("investigate failed");
  return v.value;
};
const openCodes = (ws: Workspace, id: string) => ws.exceptions.filter((e) => e.intentId === id && e.status !== "resolved").map((e) => e.explanationCode);
/** Resolve an exception the way a person does: owner, attached document, note. */
function resolveByPerson(ws: Workspace, excId: string): Workspace {
  ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: excId }, ownerId: "usr_maya" }).workspace;
  ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: excId }, evidence: { kind: "document_metadata", description: "Provider explanation (fictional)" } }).workspace;
  return run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "Explained by the provider (fictional)" }).workspace;
}

/** A payout on a partner hold (Harbour sandbox), with the sample's reviewer set up. */
function heldPayout() {
  const s = submitted({ sandboxOutcome: "hold", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
  const ws = sim(sim(s.ws, s.id).workspace, s.id).workspace;
  expect(st(ws, s.id).execution).toBe("on_hold");
  const holdId = ws.holds.find((h) => h.intentId === s.id)!.id;
  return { ...s, ws: run(ws, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace, holdId };
}
const rejectHold = (ws: Workspace, holdId: string) => run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "reject", reason: "Not proceeding (fictional)" }).workspace;
const reportFor = (ws: Workspace, id: string, ppid: string, accountRef = "prv_northline:settlement") =>
  providerReport(ppid, { amountMinor: intent(ws, id).amountMinor, currency: intent(ws, id).sourceCurrency, accountRef });

function expectTerminalContradiction(ws: Workspace, id: string) {
  const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" }).filter((e) => e.explanationCode === "RC_REPORT_ON_TERMINAL_PAYOUT");
  expect(exc).toHaveLength(1);
  expect(exc[0].status).toBe("open");
  expect(view(ws, id).contradictions.map((c) => c.code)).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
  const line = ws.statementLines.find((l) => l.id === exc[0].statementLineId)!;
  expect(line.explanationCodes).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
  expect(line.allocationIds).toHaveLength(0);
  expect(st(ws, id).settlement).not.toBe("observed");
  expect(st(ws, id).settlement).not.toBe("verified");
  expect(st(ws, id).settlementScope).not.toBe("provider_report");
  return exc[0];
}

// ---------------------------------------------------------------------------------------------
// M1: F1 is order-independent
// ---------------------------------------------------------------------------------------------

describe("review v2 M1: F1 holds in both orders", () => {
  it("M1 failed: report BEFORE payout.failed raises RC_REPORT_ON_TERMINAL_PAYOUT and ends in the same state as report AFTER", () => {
    const s = submitted();
    const transit = webhook(s.ws, s.ppid, "payout.in_transit", 2);
    // report first
    let before = ingest(transit, providerReport(s.ppid)).workspace;
    expect(st(before, s.id)).toMatchObject({ settlement: "observed", settlementScope: "provider_report" });
    before = webhook(before, s.ppid, "payout.failed", 3);
    const e1 = expectTerminalContradiction(before, s.id);
    expect(e1.explanation).toMatch(/recorded before the payout became "failed"/);
    expect(st(before, s.id)).toMatchObject({ execution: "failed", settlement: "none", settlementScope: "none", reconciliation: "exception" });
    // the evidence item of the original report is reused, not duplicated
    expect(before.evidence.filter((e) => e.intentId === s.id && e.kind === "provider_settlement_report")).toHaveLength(1);
    // failure first
    const after = ingest(webhook(transit, s.ppid, "payout.failed", 3), providerReport(s.ppid)).workspace;
    expectTerminalContradiction(after, s.id);
    expect(st(before, s.id)).toEqual(st(after, s.id));
    expect(openCodes(before, s.id).sort()).toEqual(openCodes(after, s.id).sort());
  });

  it("M1 returned: report BEFORE payout.returned raises RC_REPORT_ON_TERMINAL_PAYOUT and ends in the same state as report AFTER", () => {
    const s = completedPayout();
    let before = ingest(s.ws, providerReport(s.ppid)).workspace;
    expect(st(before, s.id).settlement).toBe("observed");
    before = webhook(before, s.ppid, "payout.returned", 9);
    expectTerminalContradiction(before, s.id);
    expect(st(before, s.id)).toMatchObject({ execution: "returned", settlement: "none", settlementScope: "none", reconciliation: "exception" });
    const after = ingest(webhook(s.ws, s.ppid, "payout.returned", 9), providerReport(s.ppid)).workspace;
    expectTerminalContradiction(after, s.id);
    expect(st(before, s.id)).toEqual(st(after, s.id));
    expect(openCodes(before, s.id).sort()).toEqual(openCodes(after, s.id).sort());
  });

  it("M1 cancelled: a report on a held payout, then the reviewer declines (→ cancelled), raises RC_REPORT_ON_TERMINAL_PAYOUT; and after cancellation too", () => {
    const h = heldPayout();
    // report first (m2 flags it while on hold), then cancelled by the reviewer's decline
    let before = ingest(h.ws, reportFor(h.ws, h.id, h.ppid, "prv_harbour:settlement")).workspace;
    expect(openCodes(before, h.id)).toContain("RC_REPORT_ON_HELD_PAYOUT");
    before = rejectHold(before, h.holdId);
    expect(st(before, h.id).execution).toBe("cancelled");
    expectTerminalContradiction(before, h.id);
    // cancelled first, then the report
    const c = rejectHold(h.ws, h.holdId);
    const after = ingest(c, reportFor(c, h.id, h.ppid, "prv_harbour:settlement"));
    expect(after.outcome).toBe("contradictory_exception_raised");
    expectTerminalContradiction(after.workspace, h.id);
    expect(st(before, h.id).settlement).toBe(st(after.workspace, h.id).settlement);
    expect(st(before, h.id).settlementScope).toBe(st(after.workspace, h.id).settlementScope);
  });

  for (const state of TERMINAL_FOR_SETTLEMENT_REPORT) {
    it(`M1 ${state} (stored data): a terminal payout carrying an earlier, unflagged provider report is still shown as a contradiction and not counted`, () => {
      // expired (and cancelled after submission) cannot be reached through the engine once a report
      // can link, so the report-before order is checked on stored data, where the rule is derived.
      const s = completedPayout();
      const w = JSON.parse(serializeWorkspace(ingest(s.ws, providerReport(s.ppid)).workspace)) as Workspace;
      intent(w, s.id).status.execution = state;
      const parsed = parseWorkspace(serializeWorkspace(w));
      expect(parsed.ok).toBe(true);
      const v = view(w, s.id);
      expect(v.contradictions.map((c) => c.code)).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
      expect(v.explanationCodes).toContain("RC_REPORT_ON_TERMINAL_PAYOUT");
    });
    it(`M1 ${state} (report after): F1 still raises the contradiction`, () => {
      const s = state === "returned" ? completedPayout() : submitted();
      let ws = s.ws;
      if (state === "failed") ws = webhook(ws, s.ppid, "payout.failed", 9);
      else if (state === "returned") ws = webhook(ws, s.ppid, "payout.returned", 9);
      else {
        ws = JSON.parse(serializeWorkspace(ws)) as Workspace;
        intent(ws, s.id).status.execution = state;
      }
      const r = ingest(ws, providerReport(s.ppid));
      expect(r.outcome).toBe("contradictory_exception_raised");
      expectTerminalContradiction(r.workspace, s.id);
    });
  }

  it("M1: a bank debit matched BEFORE payout.failed is contradicted, as in the debit-after order", () => {
    const s = submitted();
    const transit = webhook(s.ws, s.ppid, "payout.in_transit", 2);
    const before = webhook(ingest(transit, debitLine({ reference: s.ppid })).workspace, s.ppid, "payout.failed", 3);
    const after = ingest(webhook(transit, s.ppid, "payout.failed", 3), debitLine({ reference: s.ppid })).workspace;
    for (const ws of [before, after]) {
      expect(st(ws, s.id).settlement).toBe("contradicted");
      expect(openCodes(ws, s.id)).toContain("RC_DEBIT_FOR_FAILED_PAYOUT");
    }
  });

  it("F1 doc claim (ENGINE_API CHANGE 5): the contradiction sets reconciliation to exception, allocates nothing and keeps settlement", () => {
    const s = submitted();
    const failed = webhook(s.ws, s.ppid, "payout.failed", 9);
    expect(st(failed, s.id).reconciliation).not.toBe("exception");
    const r = ingest(failed, providerReport(s.ppid));
    expect(st(r.workspace, s.id)).toMatchObject({ reconciliation: "exception", settlement: st(failed, s.id).settlement });
    expect(r.workspace.allocations).toHaveLength(failed.allocations.length);
    expect(RECONCILIATION_CODE_GROUP.RC_REPORT_ON_TERMINAL_PAYOUT).toBe("contradiction");
  });
});

// ---------------------------------------------------------------------------------------------
// M2: a returned payout is never "verified" success
// ---------------------------------------------------------------------------------------------

describe("review v2 M2: returned payout never verified", () => {
  it("M2: a bank-verified payout followed by payout.returned has settlement contradicted, basis none and no verified claim", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, debitLine({ reference: ppid })).workspace;
    expect(st(ws, id).settlement).toBe("verified");
    ws = webhook(ws, ppid, "payout.returned", 9);
    expect(st(ws, id)).toMatchObject({ execution: "returned", settlement: "contradicted", reconciliation: "exception" });
    expect(describeCode("RC_REPORT_ON_TERMINAL_PAYOUT")).toBeTruthy();
    const v = view(ws, id);
    expect(v.outstanding.map((o) => o.code)).toContain("OS_RETURN_NOT_YET_RECEIVED");
  });

  it("M2: the sample's bank-verified s5 payout, after a signed payout.returned, never yields verified_settlement", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s5_funding")!;
    expect(st(ws, id).settlement).toBe("verified");
    expect(fundingProjection(ws).rows.find((r) => r.intentId === id)!.supplierPaidBasis).toBe("verified_settlement");
    const instr = ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!;
    ws = webhook(ws, instr.providerPaymentId!, "payout.returned", 99, instr.providerId);
    const s = st(ws, id);
    expect(s.execution).toBe("returned");
    expect(s.settlement).not.toBe("verified");
    expect(s.settlement).toBe("contradicted");
    const row = fundingProjection(ws).rows.find((r) => r.intentId === id)!;
    expect(row.supplierPaidBasis).toBe("none");
    expect(row.supplierPayout).toMatchObject({ execution: "returned", settlement: "contradicted" });
    // the console's green "Supplier paid — verified" chip renders only for basis verified_settlement
    expect(JSON.stringify(fundingProjection(ws))).not.toMatch(/verified_settlement/);
  });

  it("M2: the basis is none for every terminal execution even when stored settlement says verified", () => {
    const ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s5_funding")!;
    for (const state of TERMINAL_FOR_SETTLEMENT_REPORT) {
      const w = JSON.parse(serializeWorkspace(ws)) as Workspace;
      intent(w, id).status.execution = state;
      expect(intent(w, id).status.settlement).toBe("verified");
      expect(fundingProjection(w).rows.find((r) => r.intentId === id)!.supplierPaidBasis).toBe("none");
    }
  });

  it("M2: while the return is open the recompute keeps settlement contradicted; once a person resolves it, none (N2 kept)", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, debitLine({ reference: ppid })).workspace;
    ws = webhook(ws, ppid, "payout.returned", 9);
    // resolving an unrelated exception triggers the recompute; the open return keeps it contradicted
    ws = ingest(ws, debitLine({ reference: "UNKNOWN-REF-1", amountMinor: 1234 })).workspace;
    const other = ws.exceptions.at(-1)!;
    ws = resolveByPerson(ws, other.id);
    expect(st(ws, id).settlement).toBe("contradicted");
    const ret = listExceptions(ws, { intentId: id, category: "returned_payout" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: ret.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: ret.id }, evidence: { kind: "funds_returned_confirmation", description: "Bank confirms funds back (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: ret.id }, note: "Return confirmed" }).workspace;
    expect(st(ws, id)).toMatchObject({ execution: "returned", settlement: "none", settlementScope: "none" });
  });
});

// ---------------------------------------------------------------------------------------------
// M3: outstanding vs resolved amount differences
// ---------------------------------------------------------------------------------------------

describe("review v2 M3: investigate separates outstanding and resolved amount differences", () => {
  it("M3: 2,500 + 7,500 bank lines → fully matched; no outstanding difference, no RC_PARTIAL_AMOUNT; history kept", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 250_000 })).workspace;
    let v = view(ws, id);
    expect(v.amountDifferences).toHaveLength(1);
    expect(v.amountDifferences[0]).toMatchObject({ code: "RC_PARTIAL_AMOUNT", differenceMinor: 750_000, outstanding: true });
    expect(v.resolvedAmountDifferences).toHaveLength(0);
    expect(v.explanationCodes).toContain("RC_PARTIAL_AMOUNT");
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 750_000 })).workspace;
    expect(st(ws, id)).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    v = view(ws, id);
    expect(v.outstanding).toEqual([]);
    expect(v.amountDifferences).toEqual([]);
    expect(v.explanationCodes).not.toContain("RC_PARTIAL_AMOUNT");
    expect(v.resolvedAmountDifferences).toHaveLength(1);
    expect(v.resolvedAmountDifferences[0]).toMatchObject({ code: "RC_PARTIAL_AMOUNT", expectedMinor: 1_000_000, reportedMinor: 250_000, differenceMinor: 750_000, currency: "SGD", source: "bank_statement", outstanding: false });
    expect(typeof v.resolvedAmountDifferences[0].requiredNextAction).toBe("string");
  });

  it("M3: a short provider report is outstanding while its exception is open and history once a person resolves it", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, providerReport(ppid, { amountMinor: 400_000 })).workspace;
    let v = view(ws, id);
    expect(v.amountDifferences.map((d) => [d.code, d.outstanding])).toEqual([["RC_UNDER_AMOUNT_REPORT", true]]);
    const e = listExceptions(ws, { intentId: id }).find((x) => x.explanationCode === "RC_UNDER_AMOUNT_REPORT")!;
    ws = resolveByPerson(ws, e.id);
    v = view(ws, id);
    expect(v.amountDifferences).toEqual([]);
    expect(v.explanationCodes).not.toContain("RC_UNDER_AMOUNT_REPORT");
    expect(v.resolvedAmountDifferences.map((d) => [d.code, d.differenceMinor, d.outstanding])).toEqual([["RC_UNDER_AMOUNT_REPORT", 600_000, false]]);
  });

  it("M3: a bank partial on a payout that is then returned is no longer an outstanding difference (the return is)", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 250_000 })).workspace;
    ws = webhook(ws, ppid, "payout.returned", 9);
    const v = view(ws, id);
    expect(v.amountDifferences).toEqual([]);
    expect(v.resolvedAmountDifferences).toHaveLength(1);
    expect(v.outstanding.map((o) => o.code)).toContain("OS_RETURN_NOT_YET_RECEIVED");
  });
});

// ---------------------------------------------------------------------------------------------
// Minors
// ---------------------------------------------------------------------------------------------

describe("review v2 minors", () => {
  it("m1: a resolved short provider report never becomes settlement evidence", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, providerReport(ppid, { amountMinor: 400_000 })).workspace;
    const e = listExceptions(ws, { intentId: id }).find((x) => x.explanationCode === "RC_UNDER_AMOUNT_REPORT")!;
    ws = resolveByPerson(ws, e.id);
    expect(st(ws, id)).toMatchObject({ settlement: "none", settlementScope: "none" });
  });

  it("m1: an agreeing provider report still counts (provider-reported) after an unrelated exception is resolved", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, providerReport(ppid)).workspace;
    ws = ingest(ws, providerReport(ppid, { currency: "USD", lineId: "L-USD" })).workspace;
    const e = ws.exceptions.at(-1)!;
    expect(e.explanationCode).toBe("RC_CURRENCY_MISMATCH");
    ws = resolveByPerson(ws, e.id);
    expect(st(ws, id)).toMatchObject({ settlement: "observed", settlementScope: "provider_report" });
  });

  it("m2: a provider settlement report on an on_hold payout is recorded and flagged, never settlement observed", () => {
    const ws0 = sampleWorkspace();
    const id = scenarioIntentId(ws0, "s3_hold")!;
    const i = intent(ws0, id);
    const ppid = ws0.instructions.find((x) => x.id === i.instructionId)!.providerPaymentId!;
    const before = { ...i.status };
    const r = ingest(ws0, providerReport(ppid, { accountRef: "prv_harbour:settlement", amountMinor: i.amountMinor, currency: i.sourceCurrency, valueDate: ws0.asOf.slice(0, 10) }));
    expect(r.outcome).toBe("contradictory_exception_raised");
    const s = st(r.workspace, id);
    expect(s.execution).toBe("on_hold");
    expect(s.settlement).toBe(before.settlement);
    expect(s.settlement).not.toBe("observed");
    const exc = r.workspace.exceptions.at(-1)!;
    expect(exc).toMatchObject({ category: "contradictory_evidence", explanationCode: "RC_REPORT_ON_HELD_PAYOUT", intentId: id, status: "open" });
    expect(r.workspace.evidence.filter((e) => e.intentId === id && e.kind === "provider_settlement_report")).toHaveLength(1);
    expect(r.workspace.statementLines.at(-1)!.explanationCodes).toContain("RC_REPORT_ON_HELD_PAYOUT");
    expect(view(r.workspace, id).contradictions.map((c) => c.code)).toContain("RC_REPORT_ON_HELD_PAYOUT");
    expect(RECONCILIATION_CODE_GROUP.RC_REPORT_ON_HELD_PAYOUT).toBe("contradiction");
    expect(CODE_LABELS.RC_REPORT_ON_HELD_PAYOUT).toBeTruthy();
  });

  it("m3: the same short provider report three times gives one exception; a different amount is still its own", () => {
    let { ws, id, ppid } = completedPayout();
    ws = ingest(ws, providerReport(ppid, { amountMinor: 400_000, lineId: "R-A" })).workspace;
    const r2 = ingest(ws, providerReport(ppid, { amountMinor: 400_000, lineId: "R-B" }));
    expect(r2.outcome).toBe("duplicate_report_linked");
    ws = ingest(r2.workspace, providerReport(ppid, { amountMinor: 400_000, lineId: "R-C" })).workspace;
    const under = ws.exceptions.filter((e) => e.intentId === id && e.explanationCode === "RC_UNDER_AMOUNT_REPORT");
    expect(under).toHaveLength(1);
    expect(under[0].history.filter((h) => h.action === "recurred")).toHaveLength(2);
    expect(under[0].supportingEvidenceIds).toHaveLength(3);
    for (const lid of ["R-B", "R-C"]) expect(ws.statementLines.find((l) => l.lineId === lid)!.explanationCodes).toContain("RC_DUPLICATE_SUSPECTED");
    expect(view(ws, id).amountDifferences).toHaveLength(1);
    expect(st(ws, id).settlement).toBe("none");
    ws = ingest(ws, providerReport(ppid, { amountMinor: 600_000, lineId: "R-D" })).workspace;
    expect(ws.exceptions.filter((e) => e.intentId === id && e.explanationCode === "RC_UNDER_AMOUNT_REPORT")).toHaveLength(2);
  });

  it("m4: parseWorkspace rejects a difference whose currency, line id, source or amount disagrees with its line", () => {
    const { ws, ppid } = completedPayout();
    const text = serializeWorkspace(ingest(ws, providerReport(ppid, { amountMinor: 400_000 })).workspace);
    expect(parseWorkspace(text).ok).toBe(true);
    const cases: [string, (o: { statementLines: Record<string, Record<string, unknown>>[]; exceptions: Record<string, Record<string, unknown>>[] }) => void, RegExp][] = [
      ["line currency", (o) => { o.statementLines.at(-1)!.amountDifference.currency = "PHP"; }, /^statementLines\[\d+\]\.amountDifference\.currency$/],
      ["line id", (o) => { o.statementLines.at(-1)!.amountDifference.statementLineId = "nope"; }, /^statementLines\[\d+\]\.amountDifference\.statementLineId$/],
      ["line source", (o) => { o.statementLines.at(-1)!.amountDifference.source = "bank_statement"; }, /^statementLines\[\d+\]\.amountDifference\.source$/],
      ["exception currency", (o) => { o.exceptions.at(-1)!.amountDifference.currency = "USD"; }, /^exceptions\[\d+\]\.amountDifference\.currency$/],
      ["exception line id", (o) => { o.exceptions.at(-1)!.amountDifference.statementLineId = "stl_other"; }, /^exceptions\[\d+\]\.amountDifference\.statementLineId$/],
      ["exception reported amount", (o) => { const d = o.exceptions.at(-1)!.amountDifference; d.reportedMinor = 300_000; d.differenceMinor = 700_000; }, /^exceptions\[\d+\]\.amountDifference\.reportedMinor$/],
    ];
    for (const [name, mutate, field] of cases) {
      const o = JSON.parse(text);
      mutate(o);
      const r = parseWorkspace(JSON.stringify(o));
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error.field, name).toMatch(field);
    }
  });

  it("nit: one terminal list — TERMINAL_FOR_SETTLEMENT_REPORT is exactly failed, cancelled, expired, returned", () => {
    expect([...TERMINAL_FOR_SETTLEMENT_REPORT].sort()).toEqual(["cancelled", "expired", "failed", "returned"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Re-review N1: a debit matched AFTER the payout became terminal is never "verified"
// ---------------------------------------------------------------------------------------------

describe("re-review N1: debit after a terminal status", () => {
  it("N1 returned: return-then-debit is contradicted (never verified) and ends exactly like debit-then-return", () => {
    const s = completedPayout();
    const r = ingest(webhook(s.ws, s.ppid, "payout.returned", 9), debitLine({ reference: s.ppid, lineId: "D-1" }));
    expect(r.outcome).toBe("allocated");
    const after = r.workspace;
    expect(st(after, s.id)).toEqual({ execution: "returned", settlement: "contradicted", settlementScope: "bank_statement", reconciliation: "exception" });
    expect(describeStatus(st(after, s.id)).settlement).not.toMatch(/verified/i);
    const before = webhook(ingest(s.ws, debitLine({ reference: s.ppid, lineId: "D-1" })).workspace, s.ppid, "payout.returned", 9);
    expect(st(after, s.id)).toEqual(st(before, s.id));
    expect(openCodes(after, s.id).sort()).toEqual(openCodes(before, s.id).sort());
    // the debit is recorded as evidence on the open return exception
    const ret = listExceptions(after, { intentId: s.id, category: "returned_payout" })[0];
    expect(ret.supportingEvidenceIds.some((e) => after.evidence.find((x) => x.id === e)?.kind === "bank_statement_line")).toBe(true);
    expect(fundingProjection(after).rows).toHaveLength(0);
  });

  it("N1 returned: a partial debit after the return is also contradicted, as in the other order", () => {
    const s = completedPayout();
    const after = ingest(webhook(s.ws, s.ppid, "payout.returned", 9), debitLine({ reference: s.ppid, amountMinor: 250_000, lineId: "D-P" })).workspace;
    const before = webhook(ingest(s.ws, debitLine({ reference: s.ppid, amountMinor: 250_000, lineId: "D-P" })).workspace, s.ppid, "payout.returned", 9);
    expect(st(after, s.id).settlement).toBe("contradicted");
    expect(st(after, s.id)).toEqual(st(before, s.id));
  });

  it("N1 returned: once a person resolves the return, the recompute gives none (never verified)", () => {
    const s = completedPayout();
    let ws = ingest(webhook(s.ws, s.ppid, "payout.returned", 9), debitLine({ reference: s.ppid })).workspace;
    const ret = listExceptions(ws, { intentId: s.id, category: "returned_payout" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: ret.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: ret.id }, evidence: { kind: "funds_returned_confirmation", description: "Bank confirms funds back (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: ret.id }, note: "Return confirmed" }).workspace;
    expect(st(ws, s.id)).toMatchObject({ execution: "returned", settlement: "none", settlementScope: "none" });
  });

  it("N1 cancelled: debit after the reviewer declines a held payout is contradicted with RC_DEBIT_FOR_TERMINAL_PAYOUT, in both orders", () => {
    const h = heldPayout();
    const after = ingest(rejectHold(h.ws, h.holdId), debitLine({ reference: h.ppid, lineId: "D-C" }));
    expect(after.outcome).toBe("allocated");
    const before = rejectHold(ingest(h.ws, debitLine({ reference: h.ppid, lineId: "D-C" })).workspace, h.holdId);
    for (const ws of [after.workspace, before]) {
      expect(st(ws, h.id)).toMatchObject({ execution: "cancelled", settlement: "contradicted", settlementScope: "bank_statement", reconciliation: "exception" });
      expect(openCodes(ws, h.id)).toContain("RC_DEBIT_FOR_TERMINAL_PAYOUT");
    }
    expect(st(after.workspace, h.id)).toEqual(st(before, h.id));
    expect(openCodes(after.workspace, h.id).sort()).toEqual(openCodes(before, h.id).sort());
    expect(CODE_LABELS.RC_DEBIT_FOR_TERMINAL_PAYOUT).toBeTruthy();
  });

  it("N1 failed: debit after failure still raises RC_DEBIT_FOR_FAILED_PAYOUT (unchanged) and equals the other order", () => {
    const s = submitted();
    const after = ingest(webhook(s.ws, s.ppid, "payout.failed", 3), debitLine({ reference: s.ppid, lineId: "D-F" })).workspace;
    const before = webhook(ingest(s.ws, debitLine({ reference: s.ppid, lineId: "D-F" })).workspace, s.ppid, "payout.failed", 3);
    expect(st(after, s.id)).toMatchObject({ execution: "failed", settlement: "contradicted" });
    expect(st(after, s.id)).toEqual(st(before, s.id));
    expect(openCodes(after, s.id).filter((c) => c === "RC_DEBIT_FOR_FAILED_PAYOUT")).toHaveLength(1);
  });

  it("N1 expired (stored data): a debit for an expired payout is contradicted with RC_DEBIT_FOR_TERMINAL_PAYOUT", () => {
    const s = submitted();
    const w = JSON.parse(serializeWorkspace(s.ws)) as Workspace;
    intent(w, s.id).status.execution = "expired";
    const r = ingest(w, debitLine({ reference: s.ppid }));
    expect(r.outcome).toBe("allocated");
    expect(st(r.workspace, s.id)).toMatchObject({ execution: "expired", settlement: "contradicted", settlementScope: "bank_statement" });
    expect(openCodes(r.workspace, s.id)).toContain("RC_DEBIT_FOR_TERMINAL_PAYOUT");
  });

  it("N1 on_hold (decision): a debit while held is the payout debit, not a contradiction; same result whichever came first", () => {
    // A hold is not an outcome: the payout may still proceed, and the bank debit really evidences the
    // payout leaving the account (scope bank_statement, never a beneficiary credit). Not terminal, so
    // not contradicted — and the result does not depend on the order.
    const h = heldPayout();
    const after = ingest(h.ws, debitLine({ reference: h.ppid, lineId: "D-H" })).workspace;
    const s0 = submitted({ sandboxOutcome: "hold", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
    const before = sim(sim(ingest(s0.ws, debitLine({ reference: s0.ppid, lineId: "D-H" })).workspace, s0.id).workspace, s0.id).workspace;
    expect(st(after, h.id)).toMatchObject({ execution: "on_hold", settlement: "verified", settlementScope: "bank_statement" });
    expect(st(before, s0.id)).toMatchObject({ execution: "on_hold", settlement: "verified", settlementScope: "bank_statement" });
    expect(TERMINAL_FOR_SETTLEMENT_REPORT).not.toContain("on_hold");
  });
});

// ---------------------------------------------------------------------------------------------
// Final check C1/C2
// ---------------------------------------------------------------------------------------------

describe("final check C1: a held payout with a matched debit is never 'supplier paid'", () => {
  function heldWithAdvance() {
    const h = heldPayout();
    const a = run(h.ws, "usr_maya", { type: "create_advance", input: { intentId: h.id, customerRef: "CUST-C1", customerName: "C1 Customer (fictional)", supplierName: "Test Supplier (fictional)", invoiceRef: "INV-C1-0001", dueDate: "2026-12-20", repaymentReference: "RPY-C1-000001" } });
    const advanceId = a.createdIds[0];
    const ws = run(a.workspace, "usr_daniel", { type: "decide_advance", advanceId, outcome: "approve", reason: "Within limit (fictional review)." }).workspace;
    return { ...h, ws, advanceId };
  }
  it("C1: on_hold + verified bank debit → settlement stays verified, basis none, hold exposed on the funding row and in the investigation", () => {
    const h = heldWithAdvance();
    const ws = ingest(h.ws, debitLine({ reference: h.ppid })).workspace;
    expect(st(ws, h.id)).toMatchObject({ execution: "on_hold", settlement: "verified", settlementScope: "bank_statement" });
    const row = fundingProjection(ws).rows.find((r) => r.advanceId === h.advanceId)!;
    expect(row.supplierPaidBasis).toBe("none");
    expect(row.supplierPayout).toMatchObject({ execution: "on_hold", settlement: "verified", onHold: true, hold: { id: h.holdId } });
    expect(row.state).not.toBe("supplier_paid");
    const v = view(ws, h.id);
    expect(v.unknowns.map((u) => u.code)).toContain("UK_DEBITED_FUNDS_HELD_BY_PARTNER");
    expect(CODE_LABELS.UK_DEBITED_FUNDS_HELD_BY_PARTNER).toBeTruthy();
  });
  it("C1: once the reviewer releases the hold (→ in_transit), the verified debit is the basis again and the hold is no longer exposed", () => {
    const h = heldWithAdvance();
    let ws = ingest(h.ws, debitLine({ reference: h.ppid })).workspace;
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId: h.holdId, documents: ["Supporting commercial invoice"] }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId: h.holdId, decision: "release", reason: "Documents reviewed (fictional)" }).workspace;
    ws = sim(ws, h.id).workspace;
    expect(st(ws, h.id).execution).toBe("in_transit");
    const row = fundingProjection(ws).rows.find((r) => r.advanceId === h.advanceId)!;
    expect(row.supplierPayout.onHold).toBe(false);
    expect(row.supplierPayout.hold).toBeUndefined();
    expect(row.supplierPaidBasis).toBe("verified_settlement");
    expect(view(ws, h.id).unknowns.map((u) => u.code)).not.toContain("UK_DEBITED_FUNDS_HELD_BY_PARTNER");
  });
});

describe("final check C2: a late debit after the return was resolved always has an open item", () => {
  it("C2: return → person resolves → debit: contradicted WITH an open RC_DEBIT_FOR_TERMINAL_PAYOUT exception; resolving it gives none", () => {
    const s = completedPayout();
    let ws = webhook(s.ws, s.ppid, "payout.returned", 9);
    const ret = listExceptions(ws, { intentId: s.id, category: "returned_payout" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: ret.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: ret.id }, evidence: { kind: "funds_returned_confirmation", description: "Bank confirms funds back (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: ret.id }, note: "Return confirmed" }).workspace;
    expect(st(ws, s.id).settlement).toBe("none");
    const r = ingest(ws, debitLine({ reference: s.ppid, lineId: "D-LATE" }));
    expect(r.outcome).toBe("allocated");
    ws = r.workspace;
    expect(st(ws, s.id)).toMatchObject({ execution: "returned", settlement: "contradicted", settlementScope: "bank_statement" });
    const open = listExceptions(ws, { intentId: s.id, status: "unresolved" });
    expect(open.map((e) => e.explanationCode)).toEqual(["RC_DEBIT_FOR_TERMINAL_PAYOUT"]);
    expect(open[0].category).toBe("contradictory_evidence");
    const v = view(ws, s.id);
    expect(v.contradictions.map((c) => c.code)).toContain("RC_DEBIT_FOR_TERMINAL_PAYOUT");
    expect(v.whoActs.code).not.toBe("WA_NONE");
    ws = resolveByPerson(ws, open[0].id);
    expect(st(ws, s.id)).toMatchObject({ execution: "returned", settlement: "none", settlementScope: "none" });
  });
});
