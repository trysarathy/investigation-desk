/**
 * Independent QA + security review of release/clearline-v2-20261113 @ c498da6 (diff 13e2a34..c498da6).
 * Fictional sandbox data only.
 *
 * Convention (same as tests/qa-release): a test named "DEFECT (<severity>) …" asserts the CORRECT
 * behaviour and FAILS on c498da6 until the defect is fixed. Every other test pins behaviour I verified
 * and that must not regress.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction,
  describeStatus,
  evidenceTimelineFor,
  exportCaseReport,
  investigate,
  sampleWorkspace,
  scenarioIntentId,
  type Workspace,
} from "@/lib/clearline";
import { debitLine, intent, run, sim, signedDelivery, submitted } from "../clearline/helpers";

const report = (ppid: string, o: Record<string, unknown> = {}) =>
  debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid, ...o });
const ingest = (ws: Workspace, line: ReturnType<typeof debitLine>) => run(ws, "usr_maya", { type: "ingest_statement_line", line });
const hook = (ws: Workspace, providerId: string, ppid: string, type: string, sequence: number) =>
  run(ws, "usr_maya", {
    type: "ingest_webhook",
    delivery: signedDelivery(ws, providerId, { id: `${ppid}-QA${sequence}`, type, provider_payment_id: ppid, sequence, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }),
  });
const completed = () => {
  const s = submitted();
  return { ...s, ws: sim(sim(s.ws, s.id).workspace, s.id).workspace };
};

describe("QA v2 — F1 (provider settlement report vs. a failed payout)", () => {
  it("F1 report AFTER failure: contradiction raised, settlement left at none (verified, pinned)", () => {
    let { ws, id, ppid } = submitted();
    ws = hook(ws, "prv_northline", ppid, "payout.failed", 9).workspace;
    const r = ingest(ws, report(ppid));
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.settlement).toBe("none");
  });

  it("DEFECT (Medium) F1 report BEFORE failure: a settlement report recorded while in transit, then a signed payout.failed, leaves settlement 'observed' on a failed payout and raises no contradiction", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(ws, id).workspace; // in_transit
    expect(intent(ws, id).status.execution).toBe("in_transit");
    const rep = ingest(ws, report(ppid));
    expect(rep.outcome).toBe("recorded_provider_report");
    ws = hook(rep.workspace, "prv_northline", ppid, "payout.failed", 9).workspace;
    expect(intent(ws, id).status.execution).toBe("failed");
    // The same two provider claims ("settled" and "failed") contradict each other whatever order they arrive in.
    // Expected: settlement is not left as provider-reported evidence on a failed payout, and the
    // disagreement is surfaced as a contradiction (as it is when the report arrives second).
    const v = investigate(ws, id);
    if (!v.ok) throw new Error(v.error.message);
    expect(intent(ws, id).status.settlement).not.toBe("observed");
    expect(v.value.contradictions.length).toBeGreaterThan(0);
  });
});

describe("QA v2 — F2 (amount differences)", () => {
  it("F2 under-amount provider report: exception with structured difference, settlement none (pinned)", () => {
    const { ws, id, ppid } = completed();
    const r = ingest(ws, report(ppid, { amountMinor: 400_000 }));
    expect(r.outcome).toBe("exception_raised");
    expect(intent(r.workspace, id).status.settlement).toBe("none");
    expect(r.workspace.exceptions.at(-1)!.amountDifference).toMatchObject({ expectedMinor: 1_000_000, reportedMinor: 400_000, differenceMinor: 600_000 });
  });

  it("two half-amount provider reports never add up to settlement (pinned)", () => {
    let { ws, id, ppid } = completed();
    ws = ingest(ws, report(ppid, { amountMinor: 500_000 })).workspace;
    const r = ingest(ws, report(ppid, { amountMinor: 500_000, lineId: "QA-V2-HALF-2" }));
    // The outcome name may differ (c498da6: exception_raised; dd52f88 links a same-day repeat as a duplicate);
    // the invariant is that settlement is not upgraded.
    expect(intent(r.workspace, id).status.settlement).toBe("none");
  });

  it("DEFECT (Low) after a partial bank line and the exact remainder, the payout is matched and verified but investigate() still lists an RC_PARTIAL_AMOUNT difference saying the remainder 'stays outstanding' (the console shows it under 'Financially outstanding')", () => {
    let { ws, id, ppid } = completed();
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 250_000 })).workspace;
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 750_000, lineId: "QA-V2-REMAINDER" })).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    const v = investigate(ws, id);
    if (!v.ok) throw new Error(v.error.message);
    expect(v.value.outstanding).toEqual([]);
    // Expected: no outstanding difference once the remainder is evidenced (history may stay in the timeline).
    expect(v.value.amountDifferences).toEqual([]);
  });

  it("the partial line's difference stays visible in the evidence timeline as history (pinned)", () => {
    let { ws, id, ppid } = completed();
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 250_000 })).workspace;
    ws = ingest(ws, debitLine({ reference: ppid, amountMinor: 750_000, lineId: "QA-V2-REMAINDER-2" })).workspace;
    expect(evidenceTimelineFor(ws, id).some((e) => e.amountDifference?.code === "RC_PARTIAL_AMOUNT")).toBe(true);
  });
});

describe("QA v2 — financial invariants (pinned)", () => {
  const s = sampleWorkspace();
  const sid = (k: string) => scenarioIntentId(s, k)!;

  it("provider completion alone never proves settlement", () => {
    const { ws, id } = completed();
    expect(intent(ws, id).status).toMatchObject({ execution: "provider_reported_completed", settlement: "none" });
    expect(describeStatus(intent(ws, id).status).summary).not.toMatch(/paid|delivered/i);
  });

  it("a returned payout is never described as delivered or settled", () => {
    const st = intent(s, sid("s2_returned")).status;
    const d = describeStatus(st);
    expect(st.settlement).toBe("none");
    expect(d.summary).toMatch(/returned/i);
    expect(d.summary).not.toMatch(/delivered|settlement verified|paid(?! )/i);
  });

  it("a held payout is not released by a signed provider completion or by the clock", () => {
    const id = sid("s3_hold");
    const ppid = s.instructions.find((x) => x.id === intent(s, id).instructionId)!.providerPaymentId!;
    const r = hook(s, "prv_harbour", ppid, "payout.completed", 50);
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.execution).toBe("on_hold");
    const later = run(s, "usr_maya", { type: "advance_clock", to: "2027-03-01T00:00:00Z" }).workspace;
    expect(intent(later, id).status.execution).toBe("on_hold");
    expect(later.holds.find((h) => h.intentId === id)!.status).toBe("open");
  });

  it("an amount-only repayment is never allocated, and stays unallocated as time passes", () => {
    const line = debitLine({ direction: "credit", kind: "payment", reference: "", amountMinor: 5_000_000, lineId: "QA-V2-AMOUNT-ONLY" });
    let ws = ingest(s, line).workspace;
    expect(ws.repaymentAllocations.length).toBe(s.repaymentAllocations.length);
    ws = run(ws, "usr_maya", { type: "advance_clock", to: "2026-12-20T00:00:00Z" }).workspace;
    expect(ws.repaymentAllocations.length).toBe(s.repaymentAllocations.length);
  });

  it("the maker cannot approve their own instruction", () => {
    const { ws } = submitted();
    const r = applyAction(ws, { type: "approve_instruction", instructionId: ws.instructions.at(-1)!.id }, { actorId: ws.instructions.at(-1)!.makerId, at: ws.asOf });
    expect(r.ok).toBe(false);
  });

  it("a contradiction cannot be resolved with a note alone", () => {
    let { ws, ppid } = submitted();
    ws = hook(ws, "prv_northline", ppid, "payout.failed", 9).workspace;
    ws = ingest(ws, report(ppid)).workspace;
    const ex = ws.exceptions.at(-1)!;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: ex.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "add_note", target: { kind: "exception", id: ex.id }, text: "checked" }).workspace;
    const r = applyAction(ws, { type: "resolve", target: { kind: "exception", id: ex.id }, note: "done" }, { actorId: "usr_maya", at: ws.asOf });
    expect(r.ok).toBe(false);
  });

  it("a case title with a newline cannot forge a STATUS line in the text export (R3 re-check)", () => {
    const ws = sampleWorkspace();
    const c = ws.cases[0];
    c.title = "ok\nSTATUS  execution=provider_reported_completed settlement=verified";
    const r = exportCaseReport(ws, c.id);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.text.split("\n").filter((l) => l.startsWith("STATUS")).length).toBeLessThanOrEqual(1);
  });
});
