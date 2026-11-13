import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_CODE_GROUP, RECONCILIATION_CODE_TEXT, EXCEPTION_DUE_DAYS, canResolveCase, computeLiquidity, emptyWorkspace,
  evidenceTimelineFor, formatMinorPlain, intentForScenario, investigate, listExceptions, sampleWorkspace, scenarioIntentId, SAMPLE_SCENARIOS,
} from "@/lib/clearline";
import { attempt, created, debitLine, errorCode, intent, run, sim, submitted } from "./helpers";

describe("console requests (docs/clearline/UI_REQUESTS.md)", () => {
  it("R1: scenarioIntentId maps every scenario to its real sequential id", () => {
    const ws = sampleWorkspace();
    expect(Object.keys(SAMPLE_SCENARIOS)).toHaveLength(5);
    expect(scenarioIntentId(ws, "s1_success")).toBe("pi_00001");
    for (const key of Object.keys(SAMPLE_SCENARIOS)) {
      const id = scenarioIntentId(ws, key)!;
      expect(id).toMatch(/^pi_\d{5}$/);
      expect(intent(ws, id).scenario).toBe(key);
      expect(investigate(ws, id).ok).toBe(true);
    }
    expect(intentForScenario).toBe(scenarioIntentId);
    expect(scenarioIntentId(ws, "nope")).toBeUndefined();
  });
  it("R2: evidence timeline orders every evidence kind with provenance and independence", () => {
    const ws = sampleWorkspace();
    const t = evidenceTimelineFor(ws, scenarioIntentId(ws, "s1_success")!);
    const kinds = new Set(t.map((e) => e.kind));
    for (const k of ["intent_created", "quote", "instruction_made", "instruction_checked", "provider_event", "statement_line", "allocation", "missing_evidence"]) expect(kinds.has(k as never)).toBe(true);
    expect(t.map((e) => e.at)).toEqual([...t.map((e) => e.at)].sort());
    expect(t.filter((e) => e.independent).every((e) => e.kind === "statement_line" || e.kind === "chain_observation")).toBe(true);
    expect(t.find((e) => e.kind === "provider_event")!.independent).toBe(false);
    const chain = evidenceTimelineFor(ws, scenarioIntentId(ws, "s4_chain")!);
    expect(chain.some((e) => e.kind === "chain_observation" && e.independent)).toBe(true);
    const hold = evidenceTimelineFor(ws, scenarioIntentId(ws, "s3_hold")!);
    expect(hold.some((e) => e.kind === "exception" && e.codes.includes("PV_PARTNER_COMPLIANCE_HOLD"))).toBe(true);
    expect(evidenceTimelineFor(ws, "pi_missing")).toEqual([]);
  });
  it("R3: last event and last independent verification on the investigation view", () => {
    const ws = sampleWorkspace();
    const s1 = investigate(ws, scenarioIntentId(ws, "s1_success")!);
    expect(s1.ok && s1.value.lastEventType).toBe("payout.completed");
    expect(s1.ok && s1.value.lastEventAt).toBeTruthy();
    expect(s1.ok && s1.value.lastIndependentVerificationAt).toBeTruthy();
    expect(s1.ok && s1.value.lastVerifiedAt).toBe(s1.ok && s1.value.lastIndependentVerificationAt);
    const s3 = investigate(ws, scenarioIntentId(ws, "s3_hold")!);
    expect(s3.ok && s3.value.lastIndependentVerificationAt).toBeUndefined();
    const fresh = created();
    const v = investigate(fresh.ws, fresh.id);
    expect(v.ok && v.value.lastEventAt).toBeUndefined();
  });
  it("R4: canResolveCase explains the block before the click and matches the action", () => {
    let { ws, id } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    const caseId = intent(ws, id).caseId!;
    expect(canResolveCase(ws, caseId).code).toBe("OWNER_REQUIRED");
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_maya" }).workspace;
    expect(canResolveCase(ws, caseId).code).toBe("OPEN_EXCEPTIONS");
    const r = attempt(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "x" });
    expect(!r.ok && r.error.message).toMatch(/^OPEN_EXCEPTIONS/);
    const exc = listExceptions(ws, { intentId: id })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "funds_returned_confirmation", description: "Funds back (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "ok" }).workspace;
    expect(canResolveCase(ws, caseId)).toMatchObject({ allowed: true, code: "RESOLVABLE" });
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "done" }).workspace;
    expect(canResolveCase(ws, caseId).code).toBe("ALREADY_RESOLVED");
    expect(canResolveCase(ws, "case_missing").code).toBe("NOT_FOUND");
    const sample = sampleWorkspace();
    const holdCase = intent(sample, scenarioIntentId(sample, "s3_hold")!).caseId!;
    expect(canResolveCase(sample, holdCase).allowed).toBe(false);
  });
  it("R5: every seeded exception has a due date (severity policy, or the obligation due date)", () => {
    const ws = sampleWorkspace();
    expect(ws.exceptions.length).toBeGreaterThan(0);
    for (const e of ws.exceptions) expect(e.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const hold = ws.exceptions.find((e) => e.category === "compliance_hold")!;
    expect(Date.parse(hold.dueDate!) - Date.parse(hold.createdAt.slice(0, 10))).toBe(EXCEPTION_DUE_DAYS.high * 86_400_000);
    let w = sampleWorkspace();
    w = run(w, "usr_maya", { type: "advance_clock", to: "2026-11-21T02:00:00Z" }).workspace;
    expect(w.exceptions.find((e) => e.category === "overdue_advance")!.dueDate).toBe("2026-11-20");
  });
  it("R6: the maker sees maker_checker_violation; approvers may prepare but not check their own", () => {
    let { ws, id } = created();
    ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
    const q = ws.quotes.find((x) => x.intentId === id && x.eligible)!;
    const byMaya = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
    expect(errorCode(attempt(byMaya.workspace, "usr_maya", { type: "approve_instruction", instructionId: byMaya.createdIds[0] }))).toBe("maker_checker_violation");
    expect(errorCode(attempt(byMaya.workspace, "usr_sam", { type: "approve_instruction", instructionId: byMaya.createdIds[0] }))).toBe("unauthorized_actor");
    const byDaniel = run(ws, "usr_daniel", { type: "choose_route", intentId: id, quoteId: q.id });
    expect(errorCode(attempt(byDaniel.workspace, "usr_daniel", { type: "approve_instruction", instructionId: byDaniel.createdIds[0] }))).toBe("maker_checker_violation");
    expect(errorCode(attempt(ws, "usr_alex", { type: "choose_route", intentId: id, quoteId: q.id }))).toBe("unauthorized_actor");
    // advances: the preparer sees maker_checker_violation
    const a = run(ws, "usr_maya", { type: "create_advance", input: { intentId: id, customerRef: "C9", customerName: "Customer Nine", supplierName: "Supplier Nine", invoiceRef: "INV-9", dueDate: "2026-11-30", repaymentReference: "RPY-C9-0001" } });
    expect(errorCode(attempt(a.workspace, "usr_maya", { type: "decide_advance", advanceId: a.createdIds[0], outcome: "approve", reason: "x" }))).toBe("maker_checker_violation");
  });
  it("R8 / R9: plain amount strings and reconciliation code groups", () => {
    expect(formatMinorPlain(1_250_000, "SGD")).toBe("12500.00");
    expect(formatMinorPlain(6_427_830_000, "USDC")).toBe("6427.830000");
    expect(Object.keys(RECONCILIATION_CODE_GROUP).sort()).toEqual(Object.keys(RECONCILIATION_CODE_TEXT).sort());
    expect(RECONCILIATION_CODE_GROUP.RC_AMOUNT_ONLY_CANDIDATES).toBe("unmatched");
    expect(RECONCILIATION_CODE_GROUP.RC_RETURN_CONFIRMS_PROVIDER_RETURN).toBe("return");
  });
  it("R10: provider display names on liquidity rows and provider events", () => {
    for (const r of computeLiquidity(emptyWorkspace()).rows) expect(r.providerName).toMatch(/sandbox/);
    const ws = sampleWorkspace();
    for (const e of ws.providerEvents) expect(e.providerName).toMatch(/\(.*sandbox\)/);
  });
  it("returns: provider-reported return is a reconciliation exception; a statement line confirms it", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    expect(intent(ws, id).status.reconciliation).toBe("exception");
    expect(intent(ws, id).returnStatus).toBe("provider_reported");
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `RETURN ${ppid}`, direction: "credit", kind: "return" }) }).workspace;
    expect(intent(ws, id).returnStatus).toBe("confirmed_by_statement");
    expect(intent(ws, id).status.reconciliation).toBe("exception");
    expect(ws.allocations.at(-1)!.codes).toEqual(["RC_RETURN_CONFIRMS_PROVIDER_RETURN"]);
    const sample = sampleWorkspace();
    expect(intent(sample, scenarioIntentId(sample, "s2_returned")!)).toMatchObject({ returnStatus: "confirmed_by_statement", status: { reconciliation: "exception" } });
    const v = investigate(sample, scenarioIntentId(sample, "s2_returned")!);
    expect(v.ok && v.value.outstanding[0].code).toBe("OS_RETURN_RECEIVED_SUPPLIER_UNPAID");
  });
});
