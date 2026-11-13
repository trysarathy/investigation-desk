import { describe, expect, it } from "vitest";
import { investigate, listExceptions, timelineFor, canResolveException } from "@/lib/clearline";
import { attempt, errorCode, intent, later, run, signedDelivery, sim, submitted } from "./helpers";

describe("provider events", () => {
  it("happy path: provider-reported completion never sets verified or reconciled", () => {
    let { ws, id } = submitted();
    ws = sim(ws, id).workspace;
    expect(intent(ws, id).status.execution).toBe("in_transit");
    ws = sim(ws, id).workspace;
    expect(intent(ws, id).status).toEqual({ execution: "provider_reported_completed", settlement: "none", settlementScope: "none", reconciliation: "pending" });
    const v = investigate(ws, id);
    expect(v.ok && v.value.explanationCodes).toContain("PR_COMPLETED_IS_PROVIDER_CLAIM");
    expect(v.ok && v.value.explanationCodes).toContain("UK_NO_INDEPENDENT_SETTLEMENT_EVIDENCE");
    expect(sim(ws, id).outcome).toBe("no_event_pending");
  });
  it("never invents a missing intermediate event", () => {
    const { ws, id, ppid } = submitted();
    const d = signedDelivery(ws, "prv_northline", { id: `${ppid}-E3`, type: "payout.completed", provider_payment_id: ppid, sequence: 3, occurred_at: ws.asOf });
    const r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d });
    expect(r.outcome).toBe("applied");
    expect(timelineFor(r.workspace, id).some((e) => e.normalizedType === "payout.in_transit")).toBe(false);
    const v = investigate(r.workspace, id);
    expect(v.ok && v.value.explanationCodes).toContain("UK_IN_TRANSIT_NOT_REPORTED");
  });
  it("dedupes by provider event id", () => {
    let { ws, id } = submitted();
    ws = sim(ws, id).workspace;
    const r = sim(ws, id, "duplicate");
    expect(r.outcome).toBe("duplicate_ignored");
    expect(intent(r.workspace, id).status.execution).toBe("in_transit");
    expect(r.workspace.exceptions.filter((e) => e.category === "duplicate_event")).toHaveLength(0);
  });
  it("same event id with a different payload raises duplicate_event and is not applied", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(ws, id).workspace;
    const d = signedDelivery(ws, "prv_northline", { id: `${ppid}-E2`, type: "payout.completed", provider_payment_id: ppid, sequence: 2, occurred_at: ws.asOf });
    const r = run(ws, "usr_maya", { type: "ingest_webhook", delivery: d });
    expect(r.outcome).toBe("duplicate_ignored");
    expect(intent(r.workspace, id).status.execution).toBe("in_transit");
    expect(r.workspace.exceptions.some((e) => e.category === "duplicate_event" && e.explanationCode === "EV_SAME_ID_DIFFERENT_PAYLOAD")).toBe(true);
  });
  it("out-of-order delivery stores the late event without regressing state", () => {
    const { ws, id } = submitted();
    const r = sim(ws, id, "out_of_order");
    expect(r.outcome).toBe("stored_late_no_regression");
    expect(intent(r.workspace, id).status.execution).toBe("provider_reported_completed");
    const late = timelineFor(r.workspace, id).find((e) => e.normalizedType === "payout.in_transit")!;
    expect(late.processingOutcome).toBe("stored_late_no_regression");
  });
  it("contradictory events raise contradictory_evidence and keep both reports", () => {
    let { ws, id } = submitted();
    ws = sim(ws, id).workspace;
    ws = sim(ws, id).workspace; // completed
    const r = sim(ws, id, "contradictory");
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.execution).toBe("provider_reported_completed");
    expect(listExceptions(r.workspace, { category: "contradictory_evidence" })).toHaveLength(1);
    const v = investigate(r.workspace, id);
    expect(v.ok && v.value.contradictions.length).toBeGreaterThan(0);
  });
  it("amount differing from the instruction is a contradiction, not an update", () => {
    let { ws, id } = submitted();
    ws = sim(ws, id).workspace;
    const r = sim(ws, id, "contradictory");
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.execution).toBe("in_transit");
    expect(r.workspace.exceptions[0].explanationCode).toBe("EV_AMOUNT_DIFFERS_FROM_INSTRUCTION");
  });
  it("rejects badly signed webhooks without applying them", () => {
    const { ws, id, ppid } = submitted();
    const r = sim(ws, id, "bad_signature");
    expect(r.outcome).toBe("rejected_signature");
    expect(intent(r.workspace, id).status.execution).toBe("submitted");
    const d = signedDelivery(ws, "prv_harbour", { id: `${ppid}-E2`, type: "payout.in_transit", provider_payment_id: ppid, sequence: 2, occurred_at: ws.asOf });
    const r2 = run(ws, "usr_maya", { type: "ingest_webhook", delivery: { ...d, providerId: "prv_northline" } });
    expect(r2.outcome).toBe("rejected_signature");
    const stale = signedDelivery(ws, "prv_northline", { id: `${ppid}-E2`, type: "payout.in_transit", provider_payment_id: ppid, sequence: 2, occurred_at: ws.asOf });
    expect(run(ws, "usr_maya", { type: "ingest_webhook", delivery: stale }, later(ws, 10)).outcome).toBe("rejected_signature");
  });
  it("records webhooks for unknown payments without applying them", () => {
    const { ws } = submitted();
    const d = signedDelivery(ws, "prv_northline", { id: "X-E2", type: "payout.completed", provider_payment_id: "NLPO-UNKNOWN", sequence: 2, occurred_at: ws.asOf });
    expect(run(ws, "usr_maya", { type: "ingest_webhook", delivery: d }).outcome).toBe("rejected_unknown_payment");
  });
  it("timeout raises provider_timeout; it cannot be resolved until the provider responds", () => {
    let { ws, id } = submitted();
    const r = sim(ws, id, "timeout");
    expect(r.outcome).toBe("timeout_exception_raised");
    ws = r.workspace;
    const exc = listExceptions(ws, { category: "provider_timeout" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    expect(canResolveException(ws, exc.id).code).toBe("NO_PROVIDER_RESPONSE");
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "ok" }))).toBe("resolution_not_permitted");
    ws = sim(ws, id, "none", ).workspace;
    // exception does not disappear because another event arrived
    expect(ws.exceptions.find((e) => e.id === exc.id)!.status).toBe("in_review");
    // provider event at the same instant is not "after" the timeout; move on
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, later(ws, 1)).workspace;
    expect(canResolveException(ws, exc.id).allowed).toBe(true);
    expect(run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Provider responded" }).outcome).toBe("applied");
  });
  it("clock-based timeout opens provider_timeout when no status arrives in the window", () => {
    const { ws, id } = submitted();
    const r = run(ws, "usr_maya", { type: "advance_clock", to: later(ws, 300) });
    expect(listExceptions(r.workspace, { intentId: id, category: "provider_timeout" })).toHaveLength(1);
  });
  it("missing statement is flagged two days after provider-reported completion", () => {
    let { ws, id } = submitted();
    ws = sim(ws, id).workspace;
    ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "advance_clock", to: later(ws, 3 * 1440) }).workspace;
    expect(listExceptions(ws, { intentId: id, category: "missing_statement" })).toHaveLength(1);
  });
  it("a returned payout opens returned_payout with impact and a case", () => {
    let { ws, id } = submitted({ sandboxOutcome: "return" });
    ws = sim(ws, id).workspace;
    ws = sim(ws, id).workspace;
    expect(intent(ws, id).status.execution).toBe("returned");
    const e = listExceptions(ws, { intentId: id, category: "returned_payout" })[0];
    expect(e.impact).toEqual({ amountMinor: 1_000_000, currency: "SGD" });
    expect(e.caseId).toBe(intent(ws, id).caseId);
  });
});
