/**
 * Review M-1: workspaces saved by the v2 engine (built on cf8732e by the reviewer; fixtures in ./fixtures, with
 * the opaque sample line-id prefix "DBS-SIM-" renamed "SIMBANK-" per invariant 9 — nothing else changed) are
 * MIGRATED on load to the rc3 state, not refused. Only states no engine version could produce are refused.
 * - v2_t1.json: T-1 — chain-final payout, then payout.failed → stored failed / verified (onchain_transfer).
 * - v2_t2.json: T-2 — debit, payout.failed, person resolved RC_DEBIT_FOR_FAILED_PAYOUT → failed / verified.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, canResetScenario, investigate, loadWorkspace, loadWorkspaceValue, resetScenario, listExceptions, parseWorkspace, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace } from "@/lib/clearline";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const raw = (name: string) => JSON.parse(fixture(name)) as Workspace;
const load = (text: string) => {
  const r = parseWorkspace(text);
  if (!r.ok) throw new Error(`refused: ${r.error.field} ${r.error.message}`);
  return r.value;
};

describe("review M-1: v2-saved workspaces are migrated, not refused", () => {
  it("v2 T-1 (failed after a final chain transfer): contradicted with an owned CH_TRANSFER_FOR_TERMINAL_PAYOUT exception; audited; nothing else changes", () => {
    const before = raw("v2_t1.json");
    const target = before.intents.find((i) => i.status.execution === "failed" && i.status.settlement === "verified")!;
    expect(target.status.settlementScope).toBe("onchain_transfer");
    // Before the fix: refused with "Damaged workspace … a failed payout cannot carry verified settlement".
    const ws = load(fixture("v2_t1.json"));
    const i = ws.intents.find((x) => x.id === target.id)!;
    expect(i.status).toMatchObject({ execution: "failed", settlement: "contradicted", settlementScope: "onchain_transfer" });
    const exc = listExceptions(ws, { intentId: i.id, category: "contradictory_evidence", status: "unresolved" });
    expect(exc.map((e) => e.explanationCode)).toEqual(["CH_TRANSFER_FOR_TERMINAL_PAYOUT"]);
    expect(exc[0]).toMatchObject({ ownerId: "usr_maya", status: "in_review", severity: "critical", caseId: i.caseId });
    expect(exc[0].supportingEventIds.length).toBeGreaterThan(0);
    expect(ws.cases.find((c) => c.id === i.caseId)!.exceptionIds).toContain(exc[0].id);
    const audit = ws.audit.filter((a) => a.action === "workspace.migrated");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: "system", entityType: "intent", entityId: i.id });
    expect(audit[0].summary).toMatch(/failed \/ verified .*→ contradicted with CH_TRANSFER_FOR_TERMINAL_PAYOUT/);
    // every other payout is untouched
    for (const x of before.intents.filter((y) => y.id !== i.id)) expect(ws.intents.find((y) => y.id === x.id)).toEqual(x);
    // the contradiction has an open owner
    const v = investigate(ws, i.id);
    expect(v.ok && v.value.contradictions.map((c) => c.code)).toContain("CH_TRANSFER_FOR_TERMINAL_PAYOUT");
    expect(v.ok && v.value.whoActs.code).not.toBe("WA_NONE");
  });

  it("v2 T-2 (person resolved the failed payout's debit contradiction): settlement none / scope none, reconciliation kept; audited", () => {
    const before = raw("v2_t2.json");
    const target = before.intents.find((i) => i.status.execution === "failed" && i.status.settlement === "verified")!;
    const ws = load(fixture("v2_t2.json"));
    const i = ws.intents.find((x) => x.id === target.id)!;
    expect(i.status).toEqual({ execution: "failed", settlement: "none", settlementScope: "none", reconciliation: target.status.reconciliation });
    expect(listExceptions(ws, { intentId: i.id, status: "unresolved" })).toHaveLength(0);
    expect(ws.exceptions).toHaveLength(before.exceptions.length); // no new exception: a person already decided
    expect(ws.audit.filter((a) => a.action === "workspace.migrated").map((a) => a.entityId)).toEqual([i.id]);
  });

  it("idempotent: parsing a migrated workspace again changes nothing; actions work on it", () => {
    for (const f of ["v2_t1.json", "v2_t2.json"]) {
      const once = load(fixture(f));
      const twice = load(serializeWorkspace(once));
      expect(serializeWorkspace(twice)).toBe(serializeWorkspace(once));
      const r = applyAction(raw(f), { type: "advance_clock", to: raw(f).asOf }, { actorId: "usr_maya", at: raw(f).asOf });
      expect(r.ok).toBe(true);
      expect(r.ok && r.value.workspace.audit.filter((a) => a.action === "workspace.migrated")).toHaveLength(1);
    }
  });

  it("a pre-CHANGE 6 returned payout stored as verified (debit on the statement, return open) becomes contradicted", () => {
    const ws = JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
    const s2 = ws.intents.find((i) => i.id === scenarioIntentId(ws, "s2_returned"))!;
    s2.status.settlement = "verified";
    const m = load(JSON.stringify(ws));
    expect(m.intents.find((i) => i.id === s2.id)!.status).toMatchObject({ execution: "returned", settlement: "contradicted", settlementScope: "bank_statement" });
    expect(m.audit.at(-1)).toMatchObject({ action: "workspace.migrated", entityId: s2.id });
    expect(m.exceptions).toHaveLength(ws.exceptions.length); // the open return already owns it
  });

  it("refusals no longer call the engine's own data 'damaged'; they say what is wrong", () => {
    const ws = JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
    ws.fundingDecisions[0].checkerId = ws.fundingDecisions[0].makerId;
    const r = parseWorkspace(JSON.stringify(ws));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toMatch(/^This workspace cannot be loaded: .*maker and checker must be different people/);
    expect(!r.ok && r.error.message).not.toMatch(/Damaged/i);
  });

  it("resetScenario / canResetScenario never migrate the caller's object in place (they parse a copy)", () => {
    const input = raw("v2_t1.json");
    const snapshot = JSON.stringify(input);
    canResetScenario(input, "s1_success");
    const r = resetScenario(input, "s1_success", { actorId: "usr_maya", at: input.asOf });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(r.ok && r.value.workspace.audit.some((a) => a.action === "workspace.migrated")).toBe(true);
  });
});

describe("re-review R-M1: only the rc3 rule's OWN resolved exception lets a migration end in 'none'", () => {
  it("v2_va (reviewer, cf8732e): an unrelated resolved contradiction (EV_AMOUNT_DIFFERS_FROM_INSTRUCTION), then chain final, then failed → contradicted with CH_TRANSFER_FOR_TERMINAL_PAYOUT open (as rc3 gives for the same facts)", () => {
    const before = raw("v2_va.json");
    const target = before.intents.find((i) => i.status.execution === "failed" && i.status.settlement === "verified")!;
    expect(before.exceptions.filter((e) => e.intentId === target.id && e.category === "contradictory_evidence").map((e) => [e.explanationCode, e.status])).toEqual([["EV_AMOUNT_DIFFERS_FROM_INSTRUCTION", "resolved"]]);
    const ws = load(fixture("v2_va.json"));
    const i = ws.intents.find((x) => x.id === target.id)!;
    // Before the fix: failed / none with no exception ("a person already resolved the contradiction").
    expect(i.status).toMatchObject({ execution: "failed", settlement: "contradicted", settlementScope: "onchain_transfer" });
    expect(listExceptions(ws, { intentId: i.id, status: "unresolved" }).map((e) => e.explanationCode)).toContain("CH_TRANSFER_FOR_TERMINAL_PAYOUT");
  });
  it("a resolved exception with the rule's CODE but about OTHER evidence does not count (chain: other observation; bank: other line)", () => {
    // chain: v2_t1 plus a resolved CH_TRANSFER_FOR_TERMINAL_PAYOUT about an observation that is not this payout's
    const t1 = raw("v2_t1.json");
    const i1 = t1.intents.find((i) => i.status.execution === "failed" && i.status.settlement === "verified")!;
    const tmpl = t1.exceptions.find((e) => e.intentId === i1.id)!;
    t1.exceptions.push({ ...tmpl, id: "exc_99901", category: "contradictory_evidence", explanationCode: "CH_TRANSFER_FOR_TERMINAL_PAYOUT", status: "resolved", supportingEventIds: ["chn_99999"], resolution: { at: t1.asOf, actorId: "usr_maya", note: "other transfer" } });
    const r1 = loadWorkspace(JSON.stringify(t1));
    expect(r1.ok && r1.value.migrations.map((m) => m.outcome)).toEqual(["contradiction_raised"]);
    // bank: v2_t2 with its resolved RC_DEBIT_FOR_FAILED_PAYOUT pointed at a different statement line
    const t2 = raw("v2_t2.json");
    const e2 = t2.exceptions.find((e) => e.explanationCode === "RC_DEBIT_FOR_FAILED_PAYOUT")!;
    e2.statementLineId = "stl_99999";
    const r2 = loadWorkspace(JSON.stringify(t2));
    expect(r2.ok && r2.value.migrations.map((m) => m.outcome)).toEqual(["contradiction_raised"]);
  });
  it("the rule exception resolved by a person (v2 T-2: RC_DEBIT_FOR_FAILED_PAYOUT about this debit) still gives none", () => {
    const r = loadWorkspace(fixture("v2_t2.json"));
    expect(r.ok && r.value.migrations.map((m) => m.outcome)).toEqual(["resolved_by_person"]);
  });
});

describe("re-review R-m1: loadWorkspace / loadWorkspaceValue return what the migration changed", () => {
  it("v2_t1: one migration with from/to, the new exception, its owner, the audit id and a sentence for the person", () => {
    const r = loadWorkspace(fixture("v2_t1.json"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations).toHaveLength(1);
    const m = r.value.migrations[0];
    expect(m).toMatchObject({ kind: "terminal_payout_verified", outcome: "contradiction_raised", exceptionCode: "CH_TRANSFER_FOR_TERMINAL_PAYOUT", ownerId: "usr_maya", from: { execution: "failed", settlement: "verified" }, to: { execution: "failed", settlement: "contradicted" } });
    expect(r.value.workspace.exceptions.some((e) => e.id === m.exceptionId)).toBe(true);
    expect(r.value.workspace.audit.find((a) => a.id === m.auditId)).toMatchObject({ action: "workspace.migrated", entityId: m.intentId });
    expect(m.text).toMatch(/^Payment .* was saved by an earlier version as failed with settlement verified\. It now shows settlement contradicted, with a new exception exc_\d+ \(CH_TRANSFER_FOR_TERMINAL_PAYOUT\) for usr_maya to review\.$/);
  });
  it("an rc3 workspace loads with no migrations; parseWorkspace and loadWorkspace give the same workspace", () => {
    const text = serializeWorkspace(sampleWorkspace());
    const r = loadWorkspace(text);
    expect(r.ok && r.value.migrations).toEqual([]);
    expect(r.ok && serializeWorkspace(r.value.workspace)).toBe(serializeWorkspace(load(text)));
    expect(loadWorkspaceValue(JSON.parse(text)).ok).toBe(true);
    const bad = loadWorkspace("{not json");
    expect(!bad.ok && bad.error.code).toBe("invalid_field");
  });
  it("applyAction on a v2 workspace returns the migration's audit event in ActionResult.audit", () => {
    const w = raw("v2_t1.json");
    const r = applyAction(w, { type: "advance_clock", to: w.asOf }, { actorId: "usr_maya", at: w.asOf });
    expect(r.ok && r.value.audit.map((a) => a.action)).toContain("workspace.migrated");
  });
});
