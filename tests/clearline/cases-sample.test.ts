import { describe, expect, it } from "vitest";
import { exportCaseReport, investigate, listExceptions, parseWorkspace, sampleWorkspace, serializeWorkspace, SAMPLE_AS_OF, ENGINE_DISCLAIMER } from "@/lib/clearline";
import { attempt, errorCode, intent, run, sim, submitted } from "./helpers";

const byScenario = (ws: ReturnType<typeof sampleWorkspace>, s: string) => ws.intents.find((i) => i.scenario === s)!;

describe("sample workspace", () => {
  it("is deterministic and serialisable", () => {
    const a = sampleWorkspace(), b = sampleWorkspace();
    expect(serializeWorkspace(a)).toBe(serializeWorkspace(b));
    expect(a.asOf).toBe(SAMPLE_AS_OF);
    const parsed = parseWorkspace(serializeWorkspace(a));
    expect(parsed.ok && parsed.value).toEqual(a);
    expect(parseWorkspace("{").ok).toBe(false);
    expect(parseWorkspace(JSON.stringify({ ...a, schemaVersion: 2 })).ok).toBe(false);
    expect(parseWorkspace(JSON.stringify({ ...a, intents: null })).ok).toBe(false);
  });
  it("seeds five coherent, visibly fictional scenarios", () => {
    const ws = sampleWorkspace();
    expect(ws.organization.name).toMatch(/fictional/);
    expect(byScenario(ws, "s1_success").status).toEqual({ execution: "provider_reported_completed", settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" });
    expect(byScenario(ws, "s2_returned").status.execution).toBe("returned");
    expect(byScenario(ws, "s3_hold").status.execution).toBe("on_hold");
    expect(byScenario(ws, "s4_chain").status).toMatchObject({ execution: "provider_reported_completed", settlement: "pending_finality", settlementScope: "onchain_transfer" });
    expect(byScenario(ws, "s5_funding").advanceId).toBeTruthy();
    for (const i of ws.intents) expect(i.beneficiaryName).toMatch(/fictional/);
  });
  it("scenario 4 can be advanced to verified with simulate", () => {
    let ws = sampleWorkspace();
    const id = byScenario(ws, "s4_chain").id;
    ws = sim(ws, id).workspace;
    expect(intent(ws, id).status.settlement).toBe("verified");
  });
  it("scenario 2 correction workflow: correction intent makes the return resolvable", () => {
    let ws = sampleWorkspace();
    const orig = byScenario(ws, "s2_returned");
    const exc = listExceptions(ws, { intentId: orig.id, category: "returned_payout" })[0];
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "x" }))).toBe("resolution_not_permitted");
    ws = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-2026-141-C1", amountMinor: orig.amountMinor, sourceCurrency: orig.sourceCurrency, destinationCurrency: orig.destinationCurrency, purpose: "Supplier invoice correction", beneficiaryRef: "BEN-REDWOOD-08", beneficiaryName: orig.beneficiaryName, destinationCountry: orig.destinationCountry, requestedExecutionDate: "2026-11-16", idempotencyKey: "correction-s2-0001", correctsIntentId: orig.id } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Correction intent created after supplier confirmed details" }).workspace;
    expect(ws.exceptions.find((e) => e.id === exc.id)!.status).toBe("resolved");
  });
  it("investigation answers each question with explanation codes for every scenario", () => {
    const ws = sampleWorkspace();
    for (const i of ws.intents) {
      const v = investigate(ws, i.id);
      expect(v.ok).toBe(true);
      if (!v.ok) continue;
      expect(v.value.requested.internalReference).toBe(i.internalReference);
      expect(v.value.provider).toBeTruthy();
      expect(v.value.whoActs.code).toMatch(/^WA_/);
      expect(v.value.nextActions.length).toBeGreaterThan(0);
      expect(v.value.disclaimer).toBe(ENGINE_DISCLAIMER);
    }
    const hold = investigate(ws, byScenario(ws, "s3_hold").id);
    expect(hold.ok && hold.value.whoActs).toMatchObject({ code: "WA_COMPLIANCE_REVIEWER", ownerId: "usr_priya" });
    expect(investigate(ws, "pi_missing").ok).toBe(false);
  });
});

describe("cases and exceptions", () => {
  function returned() {
    let { ws, id } = submitted({ sandboxOutcome: "return" });
    ws = sim(sim(ws, id).workspace, id).workspace;
    return { ws, id, caseId: intent(ws, id).caseId!, excId: listExceptions(ws, { intentId: id })[0].id };
  }
  it("owner, notes, info requests and evidence metadata", () => {
    let { ws, caseId } = returned();
    expect(errorCode(attempt(ws, "usr_maya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_alex" }))).toBe("invalid_field");
    expect(errorCode(attempt(ws, "usr_alex", { type: "add_note", target: { kind: "case", id: caseId }, text: "hi" }))).toBe("unauthorized_actor");
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "add_note", target: { kind: "case", id: caseId }, text: "Called supplier (fictional)" }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "add_note", target: { kind: "case", id: caseId }, text: "<b>x</b>" }))).toBe("invalid_field");
    const req = run(ws, "usr_maya", { type: "request_info", caseId, from: "Supplier", request: "Confirm account holder name" });
    ws = req.workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "attach_evidence", target: { kind: "case", id: caseId }, evidence: { kind: "document_metadata", description: "x", sha256: "nothex" } }))).toBe("invalid_field");
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "case", id: caseId }, evidence: { kind: "beneficiary_correction", description: "Supplier confirmed details", reference: req.createdIds[0], documentName: "confirmation.pdf" } }).workspace;
    const c = ws.cases.find((x) => x.id === caseId)!;
    expect(c.requestedInfo.find((r) => r.id === req.createdIds[0])!.status).toBe("provided");
    expect(ws.evidence.find((e) => e.id === c.evidenceIds.at(-1))).toMatchObject({ independent: false, documentName: "confirmation.pdf" });
  });
  it("resolve only when permitted; reopen; new contradicting evidence reopens a resolved case", () => {
    let { ws, id, caseId, excId } = returned();
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_maya" }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "x" }))).toBe("resolution_not_permitted");
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: excId }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: excId }, evidence: { kind: "funds_returned_confirmation", description: "Bank confirmed funds returned (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "Funds back" }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "Closed" }).workspace;
    expect(ws.cases.find((c) => c.id === caseId)!.status).toBe("resolved");
    expect(errorCode(attempt(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "again" }))).toBe("resolution_not_permitted");
    // contradicting evidence: provider now says completed
    const r = sim(ws, id, "contradictory");
    expect(r.workspace.cases.find((c) => c.id === caseId)!.status).toBe("reopened");
    // manual reopen of the resolved exception
    const re = run(ws, "usr_maya", { type: "reopen", target: { kind: "exception", id: excId }, reason: "Supplier says still unpaid" });
    expect(re.workspace.exceptions.find((e) => e.id === excId)!.status).toBe("reopened");
    expect(re.workspace.cases.find((c) => c.id === caseId)!.status).toBe("reopened");
  });
  it("exports a case report as JSON and text", () => {
    const ws = sampleWorkspace();
    const caseId = byScenario(ws, "s5_funding").caseId!;
    const r = exportCaseReport(ws, caseId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.text).toContain("CLEARLINE CASE REPORT");
    expect(r.value.text).toContain("FINANCIALLY OUTSTANDING");
    expect(r.value.text).toContain("SGD 20,000.00");
    expect(r.value.text).toContain("TEST MODE");
    expect(JSON.parse(JSON.stringify(r.value.json)).disclaimer).toBe(ENGINE_DISCLAIMER);
    expect(exportCaseReport(ws, "case_missing").ok).toBe(false);
  });
  it("every action appends audit events", () => {
    const ws = sampleWorkspace();
    const n = ws.audit.length;
    const r = run(ws, "usr_maya", { type: "add_note", target: { kind: "case", id: ws.cases[0].id }, text: "Audit check" });
    expect(r.audit.length).toBeGreaterThan(0);
    expect(r.workspace.audit.length).toBe(n + r.audit.length);
  });
});
