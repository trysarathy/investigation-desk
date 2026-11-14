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
import { applyAction, canResetScenario, investigate, resetScenario, listExceptions, parseWorkspace, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace } from "@/lib/clearline";

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
