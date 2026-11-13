/**
 * rc3 feature (a): resetScenario / canResetScenario — restore ONE guided case to its sample state.
 */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// Each reset rebuilds the full sample several times (~4 s for the file); allow headroom on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });
import {
  SAMPLE_SCENARIOS, canResetScenario, emptyWorkspace, evidenceTimelineFor, fundingProjection, investigate, listExceptions, resetScenario,
  sampleWorkspace, scenarioIntentId, serializeWorkspace, type SampleScenario, type Workspace,
} from "@/lib/clearline";
import { debitLine, errorCode, intent, run, sim, submitted } from "./helpers";

const SCENARIOS = Object.keys(SAMPLE_SCENARIOS) as SampleScenario[];
const COLLECTIONS = ["intents", "quotes", "instructions", "providerEvents", "evidence", "statementLines", "allocations", "exceptions", "cases", "holds", "chainObservations", "advances", "fundingDecisions", "obligations", "repaymentAllocations"] as const;
const ctx = (ws: Workspace) => ({ actorId: "usr_maya", at: ws.asOf });
const ppidOf = (ws: Workspace, sc: SampleScenario) => ws.instructions.find((x) => x.id === intent(ws, scenarioIntentId(ws, sc)!).instructionId)!.providerPaymentId!;
const byId = (ws: Workspace) => new Map(COLLECTIONS.flatMap((c) => (ws[c] as unknown as { id: string }[]).map((r) => [r.id, JSON.stringify(r)] as const)));
/** Everything a person sees about one case. */
const caseView = (ws: Workspace, sc: SampleScenario) => {
  const id = scenarioIntentId(ws, sc)!;
  const i = intent(ws, id);
  const v = investigate(ws, id);
  return JSON.stringify({
    intent: i, view: v.ok ? v.value : null, timeline: evidenceTimelineFor(ws, id),
    funding: fundingProjection(ws).rows.filter((r) => r.intentId === id),
    exceptions: listExceptions(ws, { intentId: id }), case: ws.cases.find((c) => c.id === i.caseId) ?? null,
  });
};
const unreset = (ws: Workspace) => ({ ...ws, audit: [], seq: 0 }) as Workspace;

/** Mutate every guided case (no mutation links two cases). */
function mutateAll(): Workspace {
  let ws = sampleWorkspace();
  // s1: a provider settlement report (recorded as provider-reported evidence; linked only by reference text)
  ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppidOf(ws, "s1_success"), amountMinor: 2_465_137, valueDate: "2026-11-12" }) }).workspace;
  // s2: a note on the case and evidence on the returned-payout exception
  const s2 = intent(ws, scenarioIntentId(ws, "s2_returned")!);
  ws = run(ws, "usr_maya", { type: "add_note", target: { kind: "case", id: s2.caseId! }, text: "Supplier called back (fictional)" }).workspace;
  const s2exc = listExceptions(ws, { intentId: s2.id, category: "returned_payout" })[0];
  ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: s2exc.id }, evidence: { kind: "funds_returned_confirmation", description: "Funds back (fictional)" } }).workspace;
  ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: s2exc.id }, note: "Funds back" }).workspace;
  // s3: documents submitted to the partner
  ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId: ws.holds[0].id, documents: ["Supporting commercial invoice"] }).workspace;
  // s4: chain reaches finality
  ws = sim(ws, scenarioIntentId(ws, "s4_chain")!).workspace;
  // s5: the remaining SGD 20,000.00 repaid with the reference
  ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "RC3-RESET-RPY", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 2_000_000, currency: "SGD", reference: "RPY-SEABRIGHT-0001", counterparty: "SEABRIGHT TRADING", valueDate: "2026-11-13" } }).workspace;
  return ws;
}

describe("resetScenario: one case back to the sample, every other case byte-identical", () => {
  const pristine = sampleWorkspace();
  const mutated = mutateAll();

  it("every case was actually mutated (precondition of the test)", () => {
    for (const sc of SCENARIOS) expect(`${sc}: ${caseView(mutated, sc) === caseView(pristine, sc)}`).toBe(`${sc}: false`);
  });

  for (const sc of SCENARIOS)
    it(`reset ${sc} after mutating every case: ${sc} equals the sample; the other four cases and all other records are byte-identical`, () => {
      const snapshot = serializeWorkspace(mutated);
      const r = resetScenario(mutated, sc, ctx(mutated));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const after = r.value.workspace;
      expect(caseView(after, sc)).toBe(caseView(pristine, sc));
      for (const other of SCENARIOS.filter((x) => x !== sc)) expect(`${other}: ${caseView(after, other) === caseView(mutated, other)}`).toBe(`${other}: true`);
      // record level: anything not removed or restored is byte-identical
      const before = byId(mutated);
      const now = byId(after);
      const touched = new Set([...r.value.removedIds, ...r.value.restoredIds]);
      for (const [id, json] of before) if (!touched.has(id)) expect(now.get(id)).toBe(json);
      for (const id of r.value.restoredIds) expect(now.get(id)).toBe(byId(pristine).get(id));
      for (const k of ["routes", "liquidity", "liquidityPolicy", "actors", "organization", "asOf", "mode", "label"] as const) expect(JSON.stringify(after[k])).toBe(JSON.stringify(mutated[k]));
      // audit is append-only: nothing removed, one reset event added
      expect(after.audit.slice(0, mutated.audit.length)).toEqual(mutated.audit);
      expect(after.audit.at(-1)).toMatchObject({ action: "scenario.reset", entityId: sc, actorId: "usr_maya" });
      // pure: the input workspace is unchanged
      expect(serializeWorkspace(mutated)).toBe(snapshot);
    });

  it("resetting all five cases one by one gives back the sample exactly (nothing of a case is left behind, nothing else is removed)", () => {
    let ws = mutated;
    for (const sc of SCENARIOS) {
      const r = resetScenario(ws, sc, ctx(ws));
      if (!r.ok) throw new Error(r.error.message);
      ws = r.value.workspace;
    }
    expect(serializeWorkspace(unreset(ws))).toBe(serializeWorkspace(unreset(pristine)));
    expect(ws.audit.filter((a) => a.action === "scenario.reset")).toHaveLength(5);
  });

  it("a no-op reset of an untouched case changes only the audit trail", () => {
    for (const sc of SCENARIOS) {
      const r = resetScenario(pristine, sc, ctx(pristine));
      expect(r.ok && serializeWorkspace(unreset(r.value.workspace))).toBe(serializeWorkspace(unreset(pristine)));
    }
  });

  it("accepts the case's sample payment id or investigation case id as well as the scenario key", () => {
    const id = scenarioIntentId(pristine, "s2_returned")!;
    const caseId = intent(pristine, id).caseId!;
    for (const key of [id, caseId]) {
      const r = resetScenario(mutated, key, ctx(mutated));
      expect(r.ok && r.value.scenario).toBe("s2_returned");
    }
  });
});

describe("resetScenario keeps records the person created", () => {
  it("a person-created payment, its activity and an unrelated statement line survive a reset of every case", () => {
    let ws = mutateAll();
    const mine = submitted({ internalReference: "INV-MINE-1" }, "prv_northline", ws);
    ws = sim(mine.ws, mine.id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `MY PAYOUT ${mine.ppid}` }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ direction: "credit", reference: "", amountMinor: 123_456, accountRef: "BANK-SGD-MINE" }) }).workspace;
    const before = byId(ws);
    const minePre = new Map([...before].filter(([id]) => !byId(sampleWorkspace()).has(id) && !byId(mutateAll()).has(id)));
    expect(minePre.size).toBeGreaterThan(5);
    for (const sc of SCENARIOS) {
      const r = resetScenario(ws, sc, ctx(ws));
      if (!r.ok) throw new Error(r.error.message);
      ws = r.value.workspace;
    }
    const after = byId(ws);
    for (const [id, json] of minePre) expect(after.get(id)).toBe(json);
    expect(ws.idempotency).toHaveProperty(intent(ws, mine.id).idempotencyKey);
  });
});

describe("resetScenario refuses when a person's record references the case (never leaves a dangling link)", () => {
  it("a correction intent for the returned payout blocks resetting s2 (REFERENCED_BY_OTHER_RECORDS, naming the correction); other cases can still be reset", () => {
    let ws = mutateAll();
    const orig = intent(ws, scenarioIntentId(ws, "s2_returned")!);
    const c = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-2026-141-C1", amountMinor: orig.amountMinor, sourceCurrency: orig.sourceCurrency, destinationCurrency: orig.destinationCurrency, purpose: "Supplier invoice correction", beneficiaryRef: "BEN-REDWOOD-08", beneficiaryName: orig.beneficiaryName, destinationCountry: orig.destinationCountry, requestedExecutionDate: "2026-11-16", idempotencyKey: "rc3-correction-0001", correctsIntentId: orig.id } });
    ws = c.workspace;
    const check = canResetScenario(ws, "s2_returned");
    expect(check).toMatchObject({ allowed: false, code: "REFERENCED_BY_OTHER_RECORDS", scenario: "s2_returned" });
    expect(check.blockers[0]).toBe(c.createdIds[0]);
    const r = resetScenario(ws, "s2_returned", ctx(ws));
    expect(errorCode(r as never)).toBe("precondition_failed");
    expect(!r.ok && r.error.message).toMatch(/^REFERENCED_BY_OTHER_RECORDS: .*INV|^REFERENCED_BY_OTHER_RECORDS: /);
    expect(!r.ok && r.error.entityId).toBe(c.createdIds[0]);
    const s1 = resetScenario(ws, "s1_success", ctx(ws));
    expect(s1.ok && s1.value.workspace.intents.some((i) => i.id === c.createdIds[0])).toBe(true);
  });

  it("an advance a person prepared on a sample payment blocks resetting that case", () => {
    let ws = sampleWorkspace();
    ws = run(ws, "usr_maya", { type: "create_advance", input: { intentId: scenarioIntentId(ws, "s1_success")!, customerRef: "CUST-MINE", customerName: "My Customer (fictional)", supplierName: "Oakwell Engineering (fictional)", invoiceRef: "INV-MINE-9", dueDate: "2026-12-01", repaymentReference: "RPY-MINE-0001" } }).workspace;
    expect(canResetScenario(ws, "s1_success")).toMatchObject({ allowed: false, code: "REFERENCED_BY_OTHER_RECORDS" });
    expect(canResetScenario(ws, "s4_chain").allowed).toBe(true);
  });

  it("a person's active payment reusing the internal reference of a case that would become active again blocks the reset (REFERENCE_IN_USE)", () => {
    let ws = sampleWorkspace();
    const hold = ws.holds[0];
    ws = run(ws, "usr_maya", { type: "submit_hold_documents", holdId: hold.id, documents: ["Supporting commercial invoice"] }).workspace;
    ws = run(ws, "usr_priya", { type: "record_hold_decision", holdId: hold.id, decision: "reject", reason: "Declined (fictional)" }).workspace;
    expect(intent(ws, scenarioIntentId(ws, "s3_hold")!).status.execution).toBe("cancelled");
    const mine = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-2026-145", amountMinor: 883_950, sourceCurrency: "SGD", destinationCurrency: "USD", purpose: "Supplier invoice", beneficiaryRef: "BEN-EASTPORT-04", beneficiaryName: "Eastport Trading (fictional)", destinationCountry: "US", requestedExecutionDate: "2026-11-16", idempotencyKey: "rc3-mine-145-0001" } });
    expect(canResetScenario(mine.workspace, "s3_hold")).toMatchObject({ allowed: false, code: "REFERENCE_IN_USE", blockers: [mine.createdIds[0]] });
  });

  it("errors: unknown scenario → not_found; a workspace not built from the sample → precondition_failed; bad clock or actor", () => {
    const ws = sampleWorkspace();
    expect(errorCode(resetScenario(ws, "s9_nothing", ctx(ws)) as never)).toBe("not_found");
    const empty = emptyWorkspace();
    const r = resetScenario(empty, "s1_success", ctx(empty));
    expect(!r.ok && r.error.code).toBe("precondition_failed");
    expect(!r.ok && r.error.message).toMatch(/^SCENARIO_NOT_IN_WORKSPACE/);
    expect(errorCode(resetScenario(ws, "s1_success", { actorId: "usr_maya", at: "2020-01-01T00:00:00Z" }) as never)).toBe("invalid_field");
    expect(errorCode(resetScenario(ws, "s1_success", { actorId: "usr_nobody", at: ws.asOf }) as never)).toBe("unauthorized_actor");
  });
});

describe("ownership is well-founded on the sample", () => {
  it("every sample collection is in creation (id sequence) order, so a reset can merge by id", () => {
    const ws = sampleWorkspace();
    const seq = (id: string) => Number(/_(\d+)$/.exec(id)![1]);
    for (const c of COLLECTIONS) {
      const ids = (ws[c] as unknown as { id: string }[]).map((r) => seq(r.id));
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
  });
});
