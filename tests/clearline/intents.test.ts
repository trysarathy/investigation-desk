import { describe, expect, it } from "vitest";
import { emptyWorkspace, QUOTE_LABEL, EXECUTION_TRANSITIONS, canTransitionExecution } from "@/lib/clearline";
import { approved, attempt, baseInput, created, errorCode, intent, later, run, submitted } from "./helpers";

describe("payment intents", () => {
  it("creates an intent with three separate status dimensions", () => {
    const { ws, id } = created();
    expect(intent(ws, id).status).toEqual({ execution: "created", settlement: "none", settlementScope: "none", reconciliation: "not_started" });
    expect(ws.audit.at(-1)?.action).toBe("intent.created");
  });
  it("rejects invalid amounts, currencies and markup", () => {
    const ws = emptyWorkspace();
    for (const amountMinor of [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 2, NaN])
      expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ amountMinor }) }))).toBe("invalid_amount");
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ sourceCurrency: "BTC" as never }) }))).toBe("invalid_currency");
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ beneficiaryName: "<script>x</script>" }) }))).toBe("invalid_field");
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ destinationCountry: "Philippines" }) }))).toBe("invalid_field");
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ requestedExecutionDate: "2026-02-30" }) }))).toBe("invalid_field");
  });
  it("idempotency: same key + same body replays; same key + different body conflicts", () => {
    const input = baseInput();
    const first = run(emptyWorkspace(), "usr_maya", { type: "create_intent", input });
    const replay = run(first.workspace, "usr_maya", { type: "create_intent", input: { ...input } });
    expect(replay.outcome).toBe("idempotent_replay");
    expect(replay.createdIds).toEqual(first.createdIds);
    expect(replay.workspace.intents).toHaveLength(1);
    const conflict = attempt(first.workspace, "usr_maya", { type: "create_intent", input: { ...input, amountMinor: input.amountMinor + 1 } });
    expect(conflict).toMatchObject({ ok: false, error: { code: "idempotency_conflict", entityId: first.createdIds[0] } });
  });
  it("refuses a duplicate intent with the same internal reference under a new key", () => {
    const input = baseInput();
    const { workspace } = run(emptyWorkspace(), "usr_maya", { type: "create_intent", input });
    expect(errorCode(attempt(workspace, "usr_maya", { type: "create_intent", input: { ...input, idempotencyKey: "another-key-123" } }))).toBe("invalid_field");
  });
  it("rejects unknown and unauthorised actors and backwards clocks", () => {
    const ws = emptyWorkspace();
    expect(errorCode(attempt(ws, "usr_ghost", { type: "create_intent", input: baseInput() }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, "usr_alex", { type: "create_intent", input: baseInput() }))).toBe("unauthorized_actor");
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput() }, "2020-01-01T00:00:00Z"))).toBe("invalid_field");
  });
  it("is pure: the input workspace is never mutated", () => {
    const ws = emptyWorkspace();
    const before = JSON.stringify(ws);
    run(ws, "usr_maya", { type: "create_intent", input: baseInput() });
    expect(JSON.stringify(ws)).toBe(before);
  });
});

describe("quotes, routes and maker-checker", () => {
  it("returns three providers' quotes with one ineligible route and a reason", () => {
    const { ws, id } = created();
    const r = run(ws, "usr_maya", { type: "request_quotes", intentId: id });
    const qs = r.workspace.quotes.filter((q) => q.intentId === id);
    expect(new Set(qs.map((q) => q.providerId)).size).toBe(3);
    const ineligible = qs.filter((q) => !q.eligible);
    expect(ineligible.length).toBeGreaterThan(0);
    for (const q of ineligible) expect(q.eligibilityReason.length).toBeGreaterThan(5);
    for (const q of qs) {
      expect(q.label).toBe(QUOTE_LABEL);
      expect(q.source).toMatch(/simulator/);
      expect(Date.parse(q.expiresAt)).toBeGreaterThan(Date.parse(q.quotedAt));
    }
    const nl = qs.find((q) => q.providerId === "prv_northline")!;
    expect(nl.estimatedRecipientMinor).toBeGreaterThan(0);
    expect(intent(r.workspace, id).status.execution).toBe("quoted");
  });
  it("refuses an ineligible or expired quote", () => {
    let { ws, id } = created();
    ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
    const bad = ws.quotes.find((q) => q.intentId === id && !q.eligible)!;
    expect(errorCode(attempt(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: bad.id }))).toBe("quote_ineligible");
    const good = ws.quotes.find((q) => q.intentId === id && q.eligible)!;
    expect(errorCode(attempt(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: good.id }, later(ws, 16)))).toBe("quote_expired");
  });
  it("refuses approval by the maker (maker = checker) and by non-approvers", () => {
    let { ws, id } = created();
    ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.eligible)!;
    const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
    expect(errorCode(attempt(c.workspace, "usr_sam", { type: "approve_instruction", instructionId: c.createdIds[0] }))).toBe("unauthorized_actor");
    // an approver who made the instruction cannot check it
    const ws2 = { ...c.workspace, instructions: c.workspace.instructions.map((i) => ({ ...i, makerId: "usr_daniel" })) };
    expect(errorCode(attempt(ws2, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] }))).toBe("maker_checker_violation");
    const ok = run(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] });
    expect(intent(ok.workspace, id).status.execution).toBe("approved");
    expect(ok.workspace.instructions[0]).toMatchObject({ makerId: "usr_maya", checkerId: "usr_daniel", status: "approved" });
  });
  it("rejecting an instruction keeps the intent quoted and allows another route", () => {
    let { ws, id } = created();
    ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.eligible)!;
    const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
    expect(errorCode(attempt(c.workspace, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id }))).toBe("precondition_failed");
    ws = run(c.workspace, "usr_daniel", { type: "reject_instruction", instructionId: c.createdIds[0], reason: "Prefer cheaper route" }).workspace;
    expect(intent(ws, id).status.execution).toBe("quoted");
    expect(run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id }).outcome).toBe("applied");
  });
  it("blocks skips: cannot submit before approval or approve twice", () => {
    let { ws, id } = created();
    ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.eligible)!;
    const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
    expect(errorCode(attempt(c.workspace, "usr_maya", { type: "submit_instruction", instructionId: c.createdIds[0] }))).toBe("invalid_transition");
    const a = run(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] });
    expect(errorCode(attempt(a.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] }))).toBe("invalid_transition");
  });
  it("submits through the adapter, assigns a provider payment id and records the ack", () => {
    const { ws, id, ppid } = submitted();
    expect(ppid).toMatch(/^NLPO-[0-9A-F]{10}$/);
    expect(intent(ws, id).status).toMatchObject({ execution: "submitted", settlement: "none", reconciliation: "pending" });
    expect(ws.providerEvents.find((e) => e.intentId === id)?.normalizedType).toBe("payout.accepted");
  });
  it("a synchronous provider rejection fails the payment and opens failed_submission", () => {
    const a = approved({ sandboxOutcome: "submission_failure" });
    const r = run(a.ws, "usr_maya", { type: "submit_instruction", instructionId: a.instructionId });
    expect(r.outcome).toBe("exception_raised");
    expect(intent(r.workspace, a.id).status.execution).toBe("failed");
    expect(r.workspace.exceptions.some((e) => e.category === "failed_submission" && e.intentId === a.id)).toBe(true);
  });
  it("cancels before submission but not after", () => {
    const a = approved();
    expect(intent(run(a.ws, "usr_maya", { type: "cancel_intent", intentId: a.id, reason: "No longer needed" }).workspace, a.id).status.execution).toBe("cancelled");
    const s = submitted();
    expect(errorCode(attempt(s.ws, "usr_maya", { type: "cancel_intent", intentId: s.id, reason: "late" }))).toBe("invalid_transition");
  });
  it("expires unsubmitted intents after the requested execution date", () => {
    const { ws, id } = created({ requestedExecutionDate: "2026-11-13" });
    const r = run(ws, "usr_maya", { type: "advance_clock", to: "2026-11-14T01:00:00Z" });
    expect(intent(r.workspace, id).status.execution).toBe("expired");
  });
  it("transition table: terminal states have no exits; completed may only become returned", () => {
    for (const s of ["failed", "returned", "cancelled", "expired"] as const) expect(EXECUTION_TRANSITIONS[s]).toEqual([]);
    expect(EXECUTION_TRANSITIONS.provider_reported_completed).toEqual(["returned"]);
    expect(canTransitionExecution("created", "submitted")).toBe(false);
    expect(canTransitionExecution("on_hold", "provider_reported_completed")).toBe(false);
    expect(canTransitionExecution("submitted", "provider_reported_completed")).toBe(true);
  });
});
