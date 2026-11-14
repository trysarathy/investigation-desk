/**
 * Independent QA, release candidate 3 (3e66fa7). Engine-level regression tests.
 *
 * Tests named "DEFECT (...)" assert the CORRECT behaviour and FAIL on 3e66fa7; each matches a finding in
 * QA_SECURITY_REVIEW_RC3.md. Every other test passes on 3e66fa7 and pins an invariant I attacked and saw hold.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction, canResolveCase, fundingProjection, investigate, loadWorkspaceValue, listExceptions, parseWorkspaceValue, sampleWorkspace,
  scenarioIntentId, caseReportToCsv, buildCaseReport, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import { attempt, debitLine, errorCode, intent, run, sim, submitted } from "../clearline/helpers";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const assign = (ws: Workspace, kind: "case" | "exception", id: string, who = "usr_maya") =>
  run(ws, who, { type: "assign_owner", target: { kind, id }, ownerId: who }).workspace;
const evidence = (ws: Workspace, id: string) =>
  run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id }, evidence: { kind: "document_metadata", description: "Bank fee advice (fictional)" } }).workspace;

/** A provider-completed SGD 10,000.00 payout with a bank debit of `lineMinor` naming it; the debit's exception owned + evidenced. */
function overAmount(lineMinor: number, line: Record<string, unknown> = {}) {
  let { ws, id, ppid } = submitted();
  ws = sim(ws, id).workspace;
  ws = sim(ws, id).workspace;
  const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: lineMinor, reference: `NORTHLINE PAYOUT ${ppid}`, ...line }) });
  ws = r.workspace;
  const exc = ws.exceptions.find((e) => e.statementLineId === r.createdIds[0])!;
  ws = evidence(assign(ws, "exception", exc.id), exc.id);
  return { ws, id, excId: exc.id, caseId: intent(ws, id).caseId!, code: exc.explanationCode };
}
const accept = (ws: Workspace, excId: string, who = "usr_maya", extra: Partial<Extract<WorkspaceAction, { type: "resolve" }>> = { acceptDifference: true }) =>
  attempt(ws, who, { type: "resolve", target: { kind: "exception", id: excId }, note: "Bank fee accepted (fictional)", ...extra });
const approve = (ws: Workspace, excId: string, who: string, note = "Checked the fee advice") =>
  attempt(ws, who, { type: "approve_acceptance", exceptionId: excId, note });

// -------------------------------------------------------------------------------------------------
describe("QA rc3: findings (each fails on 3e66fa7)", () => {
  it("DEFECT (Medium) M1: reopening an exception resolved with an accepted difference leaves a workspace the engine itself refuses to load", () => {
    const s = overAmount(1_005_000); // 0.5 % over: one staff person may accept
    let ws = accept(s.ws, s.excId).ok ? (accept(s.ws, s.excId) as { ok: true; value: { workspace: Workspace } }).value.workspace : s.ws;
    expect(ws.exceptions.find((e) => e.id === s.excId)!.status).toBe("resolved");
    const reopened = attempt(ws, "usr_maya", { type: "reopen", target: { kind: "exception", id: s.excId }, reason: "Fee advice was for another payment" });
    expect(reopened.ok).toBe(true); // the engine accepts the reopen …
    ws = (reopened as { ok: true; value: { workspace: Workspace } }).value.workspace;
    // … and then refuses its own output: every next action (and every page load) fails with
    // "exceptions[n].resolution.acceptedDifference: must belong to a resolved … exception".
    const load = loadWorkspaceValue(clone(ws));
    expect(load.ok, load.ok ? "" : load.error.message).toBe(true);
    const next = attempt(ws, "usr_maya", { type: "add_note", target: { kind: "exception", id: s.excId }, text: "Looking again" });
    expect(errorCode(next)).toBe("ok");
  });

  it("DEFECT (Medium) M1b: the same after a second person approved an above-1% acceptance", () => {
    const s = overAmount(1_050_000); // 5 %
    let ws = (accept(s.ws, s.excId) as { ok: true; value: { workspace: Workspace } }).value.workspace;
    ws = (approve(ws, s.excId, "usr_sam") as { ok: true; value: { workspace: Workspace } }).value.workspace;
    const r = attempt(ws, "usr_daniel", { type: "reopen", target: { kind: "exception", id: s.excId }, reason: "Wrong advice" });
    expect(r.ok).toBe(true);
    const load = loadWorkspaceValue(clone((r as { ok: true; value: { workspace: Workspace } }).value.workspace));
    expect(load.ok, load.ok ? "" : load.error.message).toBe(true);
  });

  it("DEFECT (Low) L1: a stored/posted workspace claiming verified + matched with only pending-finality chain evidence loads unchanged and its case closes", () => {
    const ws = clone(sampleWorkspace());
    const id = scenarioIntentId(ws, "s4_chain")!;
    const i = ws.intents.find((x) => x.id === id)!;
    i.status.settlement = "verified";
    i.status.reconciliation = "matched";
    const c = ws.cases.find((x) => x.id === i.caseId)!;
    c.ownerId = "usr_maya";
    for (const eid of c.exceptionIds) Object.assign(ws.exceptions.find((x) => x.id === eid)!, { status: "resolved", ownerId: "usr_maya", resolution: { at: ws.asOf, actorId: "usr_maya", note: "forged" } });
    expect(ws.chainObservations.filter((o) => o.intentId === id).map((o) => o.status)).toEqual(["pending_finality"]);
    // Correct: refused on load, or downgraded to what the evidence supports (pending_finality / pending).
    const load = loadWorkspaceValue(clone(ws));
    const loaded = load.ok ? load.value.workspace.intents.find((x) => x.id === id)!.status : undefined;
    expect(!load.ok || loaded!.settlement !== "verified").toBe(true);
    expect(canResolveCase(ws, c.id).allowed).toBe(false);
  });

  it("DEFECT (Low) L2: crossCheck accepts a hold 'released' on an operator's decision, a viewer as funding checker and an unknown instruction checker", () => {
    const base = sampleWorkspace();
    const holdForged = clone(base);
    const h = holdForged.holds[0];
    h.status = "released";
    h.decisions.push({ at: holdForged.asOf, actorId: "usr_maya", decision: "release", reason: "forged by an operator" } as never);
    expect(parseWorkspaceValue(clone(holdForged)).ok).toBe(false);

    const fundForged = clone(base);
    fundForged.fundingDecisions[0].checkerId = "usr_alex"; // viewer
    expect(parseWorkspaceValue(clone(fundForged)).ok).toBe(false);

    const insForged = clone(base);
    insForged.instructions[0].checkerId = "usr_nobody";
    expect(parseWorkspaceValue(clone(insForged)).ok).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
describe("QA rc3: approve_acceptance and the acceptance policy (hold on 3e66fa7)", () => {
  it("an above-1% over-amount needs a DIFFERENT staff person; the accepter, a viewer, an unknown id and a repeat are refused", () => {
    const s = overAmount(1_050_000);
    const r = accept(s.ws, s.excId);
    expect(r.ok).toBe(true);
    let ws = (r as { ok: true; value: { workspace: Workspace } }).value.workspace;
    ws = assign(ws, "case", s.caseId);
    expect(canResolveCase(ws, s.caseId).code).toBe("SECOND_APPROVAL_REQUIRED");
    expect(errorCode(approve(ws, s.excId, "usr_maya"))).toBe("maker_checker_violation");
    expect(errorCode(approve(ws, s.excId, "usr_alex"))).toBe("unauthorized_actor");
    expect(errorCode(approve(ws, s.excId, "USR_SAM"))).toBe("unauthorized_actor");
    expect(errorCode(approve(ws, s.excId, "usr_sam", "  "))).toBe("invalid_field");
    const ok = approve(ws, s.excId, "usr_sam");
    expect(ok.ok).toBe(true);
    ws = (ok as { ok: true; value: { workspace: Workspace } }).value.workspace;
    expect(errorCode(approve(ws, s.excId, "usr_daniel"))).toBe("invalid_transition");
    expect(canResolveCase(ws, s.caseId)).toMatchObject({ allowed: true });
    // Accepting never upgrades evidence.
    expect(intent(ws, s.id).status.settlement).toBe("none");
  });

  it("a ≤1% acceptance needs no second approval, and approve_acceptance on it is refused", () => {
    const s = overAmount(1_005_000);
    const ws = (accept(s.ws, s.excId) as { ok: true; value: { workspace: Workspace } }).value.workspace;
    expect(errorCode(approve(ws, s.excId, "usr_sam"))).toBe("invalid_transition");
    expect(canResolveCase(assign(ws, "case", s.caseId), s.caseId).allowed).toBe(true);
  });

  it("over 50%, provider reports, credits, before-submission and >60-day-late lines are never acceptable", () => {
    expect(accept(overAmount(1_600_000).ws, overAmount(1_600_000).excId).ok).toBe(false);
    const pr = overAmount(1_005_000, { source: "provider_settlement_report", accountRef: "NL-REPORT" });
    expect(accept(pr.ws, pr.excId).ok).toBe(false);
    const early = overAmount(1_000_000, { valueDate: "2026-10-01" });
    expect(accept(early.ws, early.excId, "usr_maya", { acceptLateDate: true }).ok).toBe(false);
    const far = overAmount(1_000_000, { valueDate: "2027-03-01" });
    expect(accept(far.ws, far.excId, "usr_maya", { acceptLateDate: true }).ok).toBe(false);
    const fx = overAmount(1_000_000, { currency: "USD" });
    expect(accept(fx.ws, fx.excId).ok || accept(fx.ws, fx.excId, "usr_maya", { acceptLateDate: true }).ok).toBe(false);
  });

  it("a forged approval naming the accepter is refused on load; stripping secondApproval does not let the case close", () => {
    const s = overAmount(1_050_000);
    const ws = (accept(s.ws, s.excId) as { ok: true; value: { workspace: Workspace } }).value.workspace;
    const self = clone(ws);
    self.exceptions.find((e) => e.id === s.excId)!.resolution!.acceptedDifference!.secondApproval = { required: true, approvedBy: "usr_maya", approvedAt: ws.asOf };
    expect(parseWorkspaceValue(self).ok).toBe(false);
    const stripped = clone(ws);
    delete stripped.exceptions.find((e) => e.id === s.excId)!.resolution!.acceptedDifference!.secondApproval;
    const loaded = parseWorkspaceValue(stripped);
    expect(loaded.ok).toBe(true);
    const w2 = assign((loaded as { ok: true; value: Workspace }).value, "case", s.caseId);
    expect(canResolveCase(w2, s.caseId).allowed).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
describe("QA rc3: financial invariants (hold on 3e66fa7)", () => {
  it("money is exact: fractional, unsafe, string and non-positive amounts are refused", () => {
    for (const amountMinor of [1.5, 0.1 + 0.2, 2 ** 53, -1, 0, Number.NaN, "1000"] as unknown[]) {
      const r = applyAction(sampleWorkspace(), { type: "create_intent", input: { internalReference: "INV-QA3-M", amountMinor, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-QA3", beneficiaryName: "QA (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20", idempotencyKey: "qa3-money-key" } as never }, { actorId: "usr_maya", at: sampleWorkspace().asOf });
      expect(r.ok, String(amountMinor)).toBe(false);
    }
  });

  it("three truths: provider completion alone is not verified; a provider settlement report is observed only", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(intent(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "none", reconciliation: "pending" });
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "NL-REPORT", reference: ppid }) }).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "observed", settlementScope: "provider_report", reconciliation: "pending" });
  });

  it("no allocation by amount alone; two same-amount payouts keep both candidates; a second referenced debit is not double-allocated", () => {
    const a = submitted({ amountMinor: 1_000_000 });
    const b = submitted({ amountMinor: 1_000_000 }, "prv_northline", a.ws);
    let r = run(b.ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: "NORTHLINE PAYOUT" }) });
    expect(r.workspace.statementLines.find((l) => l.id === r.createdIds[0])!.allocationIds).toEqual([]);
    expect(r.workspace.exceptions.find((e) => e.statementLineId === r.createdIds[0])!.candidates.length).toBe(2);
    r = run(r.workspace, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `NORTHLINE PAYOUT ${b.ppid}` }) });
    r = run(r.workspace, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `NORTHLINE PAYOUT ${b.ppid}` }) });
    const sum = r.workspace.allocations.filter((x) => x.target.kind === "payment" && x.target.intentId === b.id).reduce((t, x) => t + x.amountMinor, 0);
    expect(sum).toBe(1_000_000);
  });

  it("stablecoin: wrong chain, counterfeit contract and lower-case symbol are not counted; a reorg after finality is not verified", () => {
    const ws0 = sampleWorkspace();
    const id = scenarioIntentId(ws0, "s4_chain")!;
    const o = ws0.chainObservations.find((x) => x.intentId === id)!;
    const obs = { intentId: id, chainId: o.chainId, network: o.network, tokenContract: o.tokenContract, tokenSymbol: o.tokenSymbol, txHash: o.txHash, toAddress: o.toAddress, amountMinor: o.amountMinor, blockNumber: o.blockNumber, confirmations: 100 };
    for (const bad of [{ chainId: 1, network: "ethereum" }, { tokenContract: "0x" + "de".repeat(20) }, { tokenSymbol: "usdc" }]) {
      const r = run(ws0, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, txHash: "0x" + "9a".repeat(32), ...bad } });
      expect(intent(r.workspace, id).status.settlement).not.toBe("verified");
    }
    const fin = run(ws0, "usr_maya", { type: "ingest_chain_observation", observation: obs }).workspace;
    expect(intent(fin, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    const reorg = run(fin, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, blockNumber: o.blockNumber + 1, confirmations: 1 } }).workspace;
    expect(intent(reorg, id).status.settlement).not.toBe("verified");
    expect(intent(reorg, id).status.reconciliation).not.toBe("matched");
  });

  it("chain evidence never settles a fiat payout", () => {
    let { ws, id } = submitted();
    ws = sim(ws, id).workspace;
    const r = attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: { intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: "0x5a4d00000000000000000000000000000000c1ea", tokenSymbol: "USDC", txHash: "0x" + "ab".repeat(32), toAddress: "0x" + "11".repeat(20), amountMinor: 1_000_000, blockNumber: 1, confirmations: 99 } });
    expect(r.ok ? intent(r.value.workspace, id).status.settlement : "refused").not.toBe("verified");
  });

  it("returned payout: net zero on the statement, beneficiary unpaid, never verified", () => {
    const ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s2_returned")!;
    const v = investigate(ws, id);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.status.settlement).not.toBe("verified");
    expect(v.value.returnPosition).toMatchObject({ netMovementZero: true, beneficiaryPaid: false, code: "RT_NET_ZERO" });
  });

  it("funding 50,000 / 30,000 / 20,000: an unrelated SGD 20,000 credit, a USD credit and a superstring reference never close it", () => {
    const ws0 = sampleWorkspace();
    const row0 = fundingProjection(ws0).rows[0];
    expect([row0.principal.amountMinor, row0.repaid.amountMinor, row0.outstanding.amountMinor]).toEqual([5_000_000, 3_000_000, 2_000_000]);
    const credit = (o: Record<string, unknown>) => ({ lineId: `CR-${Math.random().toString(36).slice(2, 8)}`, source: "bank_statement" as const, accountRef: "BANK-SGD", direction: "credit" as const, kind: "payment" as const, amountMinor: 2_000_000, currency: "SGD" as const, reference: "SEABRIGHT", counterparty: "Seabright Trading (fictional)", valueDate: "2026-11-14", ...o });
    for (const o of [{}, { currency: "USD", reference: "RPY-SEABRIGHT-0001" }, { reference: "XRPY-SEABRIGHT-00012" }]) {
      const w = run(ws0, "usr_maya", { type: "ingest_statement_line", line: credit(o) as never }).workspace;
      expect(fundingProjection(w).rows[0].state, JSON.stringify(o)).toBe("partly_repaid");
    }
    const ok = run(ws0, "usr_maya", { type: "ingest_statement_line", line: credit({ reference: "RPY-SEABRIGHT-0001" }) as never }).workspace;
    expect(fundingProjection(ok).rows[0].state).toBe("repaid");
  });

  it("holds never auto-release; only the assigned compliance reviewer decides", () => {
    const ws0 = sampleWorkspace();
    const late = run(ws0, "usr_maya", { type: "advance_clock", to: "2027-12-31T00:00:00Z" }).workspace;
    expect(late.holds[0].status).not.toBe("released");
    for (const who of ["usr_maya", "usr_sam", "usr_daniel", "usr_alex"])
      expect(attempt(ws0, who, { type: "record_hold_decision", holdId: ws0.holds[0].id, decision: "release", reason: "x" }).ok).toBe(false);
  });

  it("CSV export of a case report neutralises a formula-like beneficiary name (the one formula-leading text the inputs accept)", () => {
    let { ws, id, ppid } = submitted({ beneficiaryName: "+cmd|' /C calc'!A0 (fictional)".replace(/[|'!/]/g, " ") });
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: 1_050_000, reference: `NORTHLINE PAYOUT ${ppid}` }) }).workspace;
    const caseId = intent(ws, id).caseId!;
    const report = buildCaseReport(ws, caseId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const csv = caseReportToCsv(report.value);
    const hits = csv.split("\r\n").filter((l) => l.includes("cmd"));
    expect(hits.length).toBeGreaterThan(0);
    for (const l of hits) expect(l).not.toMatch(/(^|,)"?\+cmd/);
    for (const l of hits) expect(l).toMatch(/'\+cmd/);
  });
});

void listExceptions;
