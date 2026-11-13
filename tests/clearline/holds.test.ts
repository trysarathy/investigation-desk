import { describe, expect, it } from "vitest";
import { canResolveException, listExceptions } from "@/lib/clearline";
import { attempt, errorCode, intent, later, run, sim, submitted } from "./helpers";

function held() {
  let { ws, id } = submitted({ sandboxOutcome: "hold", sourceCurrency: "SGD", destinationCurrency: "USD", destinationCountry: "US" }, "prv_harbour");
  ws = sim(ws, id).workspace;
  ws = sim(ws, id).workspace;
  const hold = ws.holds.find((h) => h.intentId === id)!;
  return { ws, id, holdId: hold.id };
}

describe("compliance holds (never auto-released)", () => {
  it("records a partner-reported hold with requested documents, exception and case requests", () => {
    const { ws, id, holdId } = held();
    const h = ws.holds.find((x) => x.id === holdId)!;
    expect(intent(ws, id).status.execution).toBe("on_hold");
    expect(h).toMatchObject({ reportedBy: "partner", status: "open", autoRelease: false });
    expect(h.requestedDocuments.length).toBe(2);
    expect(listExceptions(ws, { intentId: id, category: "compliance_hold" })).toHaveLength(1);
    expect(ws.cases.find((c) => c.intentId === id)!.requestedInfo.filter((r) => r.status === "open")).toHaveLength(2);
  });
  it("time passing and further simulation never release a hold", () => {
    let { ws, id, holdId } = held();
    ws = run(ws, "usr_maya", { type: "advance_clock", to: later(ws, 30 * 1440) }).workspace;
    expect(sim(ws, id).outcome).toBe("no_event_pending");
    expect(ws.holds.find((h) => h.id === holdId)!.status).toBe("open");
    expect(intent(ws, id).status.execution).toBe("on_hold");
  });
  it("a partner release event alone does not release the hold", () => {
    let { ws, id, holdId } = held();
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId, documents: ["Supporting commercial invoice", "Proof of business relationship with beneficiary"] }).workspace;
    const r = sim(ws, id);
    expect(r.outcome).toBe("recorded_no_state_change");
    expect(r.workspace.holds.find((h) => h.id === holdId)!.status).toBe("partner_release_reported");
    expect(intent(r.workspace, id).status.execution).toBe("on_hold");
    ws = run(r.workspace, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "release", reason: "Documents reviewed (fictional)" }).workspace;
    expect(ws.holds.find((h) => h.id === holdId)!.status).toBe("released");
    expect(intent(ws, id).status.execution).toBe("in_transit");
  });
  it("a human release before the partner's release waits for the partner", () => {
    let { ws, id, holdId } = held();
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId, documents: ["Supporting commercial invoice"] }).workspace;
    ws = run(ws, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "release", reason: "OK" }).workspace;
    expect(intent(ws, id).status.execution).toBe("on_hold");
    const r = sim(ws, id);
    expect(r.outcome).toBe("applied");
    expect(intent(r.workspace, id).status.execution).toBe("in_transit");
  });
  it("only the assigned compliance reviewer decides; release requires documents; exception resolvable only after decision", () => {
    let { ws, holdId, id } = held();
    expect(errorCode(attempt(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "release", reason: "x" }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, "usr_maya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, "usr_daniel", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_maya" }))).toBe("invalid_field");
    ws = run(ws, "usr_daniel", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    expect(errorCode(attempt(ws, "usr_daniel", { type: "record_hold_decision", holdId, decision: "release", reason: "x" }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "release", reason: "x" }))).toBe("precondition_failed");
    const exc = listExceptions(ws, { intentId: id, category: "compliance_hold" })[0];
    expect(canResolveException(ws, exc.id).code).toBe("HOLD_NOT_DECIDED");
    const caseId = intent(ws, id).caseId!;
    ws = run(ws, "usr_priya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_priya" }).workspace;
    expect(errorCode(attempt(ws, "usr_priya", { type: "resolve", target: { kind: "case", id: caseId }, note: "done" }))).toBe("resolution_not_permitted");
  });
  it("reject cancels the held payout and makes the exception resolvable", () => {
    let { ws, holdId, id } = held();
    ws = run(ws, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "reject", reason: "Cannot evidence relationship" }).workspace;
    expect(intent(ws, id).status.execution).toBe("cancelled");
    const exc = listExceptions(ws, { intentId: id, category: "compliance_hold" })[0];
    expect(canResolveException(ws, exc.id).allowed).toBe(true);
  });
  it("request_more re-opens the hold with a new requested item", () => {
    let { ws, holdId, id } = held();
    ws = run(ws, "usr_priya", { type: "assign_hold_reviewer", holdId, reviewerId: "usr_priya" }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId, decision: "request_more", reason: "Bill of lading" }).workspace;
    expect(ws.holds.find((h) => h.id === holdId)!.status).toBe("open");
    expect(ws.cases.find((c) => c.intentId === id)!.requestedInfo.some((r) => r.request === "Bill of lading")).toBe(true);
  });
});
