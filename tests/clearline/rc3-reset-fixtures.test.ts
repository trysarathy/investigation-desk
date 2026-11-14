/**
 * Re-review R-B1: resetScenario on workspaces saved by EARLIER sample versions (fixtures built by the reviewer
 * with the real cf8732e engine; only the opaque line-id prefix "DBS-SIM-" renamed "SIMBANK-"). The rc3 sample's
 * s2 records reach seq 180 while a v2-saved sample stops at 164: without raising the id counter, later actions
 * generate the restored ids again and the workspace no longer loads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_SCENARIOS, applyAction, canResetScenario, parseWorkspace, resetScenario, sampleWorkspace, serializeWorkspace, type SampleScenario, type Workspace, type WorkspaceAction } from "@/lib/clearline";
import { baseInput, debitLine } from "./helpers";

const SCENARIOS = Object.keys(SAMPLE_SCENARIOS) as SampleScenario[];
const COLLECTIONS = ["intents", "quotes", "instructions", "providerEvents", "evidence", "statementLines", "allocations", "exceptions", "cases", "holds", "chainObservations", "advances", "fundingDecisions", "obligations", "repaymentAllocations", "audit"] as const;
const load = (name: string): Workspace => {
  const r = parseWorkspace(readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
  if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
  return r.value;
};
const ids = (ws: Workspace) => COLLECTIONS.flatMap((c) => (ws[c] as unknown as { id: string }[]).map((r) => r.id));
const seqOf = (id: string) => Number(/_(\d+)$/.exec(id)?.[1] ?? -1);
const duplicates = (ws: Workspace) => {
  const seen = new Map<string, number>();
  for (const id of ids(ws)) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
};
const step = (ws: Workspace, action: WorkspaceAction): Workspace => {
  const r = applyAction(ws, action, { actorId: "usr_maya", at: ws.asOf });
  if (!r.ok) throw new Error(`${action.type}: ${r.error.message}`);
  return r.value.workspace;
};
/** Ordinary follow-up work: notes, unmatched and matched statement lines, a new payment through submission. */
function keepWorking(ws: Workspace, tag: string): Workspace {
  ws = step(ws, { type: "add_note", target: { kind: "case", id: ws.cases[0].id }, text: `Follow-up ${tag}` });
  for (let k = 0; k < 6; k++)
    ws = step(ws, { type: "ingest_statement_line", line: debitLine({ lineId: `RB1-${tag}-${k}`, accountRef: "BANK-SGD-RB1", amountMinor: 1_000 + k, reference: k % 2 ? "" : `UNKNOWN ${k}`, direction: k % 3 ? "credit" : "debit" }) });
  const created = applyAction(ws, { type: "create_intent", input: baseInput({ internalReference: `INV-RB1-${tag}`, idempotencyKey: `rb1-${tag}-0001`, amountMinor: 50_000 }) }, { actorId: "usr_maya", at: ws.asOf });
  if (!created.ok) throw new Error(created.error.message);
  ws = created.value.workspace;
  const id = created.value.createdIds[0];
  ws = step(ws, { type: "request_quotes", intentId: id });
  const q = ws.quotes.find((x) => x.intentId === id && x.providerId === "prv_northline" && x.eligible)!;
  const c = applyAction(ws, { type: "choose_route", intentId: id, quoteId: q.id }, { actorId: "usr_maya", at: ws.asOf });
  if (!c.ok) throw new Error(c.error.message);
  ws = c.value.workspace;
  const ap = applyAction(ws, { type: "approve_instruction", instructionId: c.value.createdIds[0] }, { actorId: "usr_daniel", at: ws.asOf });
  if (!ap.ok) throw new Error(ap.error.message);
  ws = step(ap.value.workspace, { type: "submit_instruction", instructionId: c.value.createdIds[0] });
  return step(ws, { type: "simulate_provider_event", intentId: id });
}

describe("re-review R-B1: reset on a workspace saved by an earlier sample version never leads to duplicate ids", () => {
  it("the reviewer's repro: v2 sample → reset s2 → a note and six statement lines → still unique, still loads", () => {
    const ws0 = load("v2_sample.json");
    expect(ws0.seq).toBe(164);
    const r = resetScenario(ws0, "s2_returned", { actorId: "usr_maya", at: ws0.asOf });
    if (!r.ok) throw new Error(r.error.message);
    // Before the fix: seq stayed 164 while restored ids reach 180 (stl_00177, evd_00179 regenerated later).
    expect(r.value.workspace.seq).toBeGreaterThanOrEqual(Math.max(...r.value.restoredIds.map(seqOf)));
    const ws = keepWorking(r.value.workspace, "repro");
    expect(duplicates(ws)).toEqual([]);
    expect(parseWorkspace(serializeWorkspace(ws)).ok).toBe(true);
  });

  const FIXTURES = ["v2_sample.json", "v2_va.json", "v2_vb.json", "v2_t1.json"];
  for (const f of FIXTURES)
    it(`${f}: after resetting ANY case, seq is past every id in use; then more work and a reload keep every id unique`, () => {
      const ws0 = load(f);
      let resets = 0;
      for (const sc of SCENARIOS) {
        if (!canResetScenario(ws0, sc).allowed) continue;
        const r = resetScenario(ws0, sc, { actorId: "usr_maya", at: ws0.asOf });
        if (!r.ok) throw new Error(`${sc}: ${r.error.message}`);
        resets++;
        const ws = r.value.workspace;
        expect(`${sc}: ${Math.max(...ids(ws).map(seqOf)) <= ws.seq}`).toBe(`${sc}: true`);
        expect(duplicates(ws)).toEqual([]);
        const after = keepWorking(ws, `${f.slice(0, 6)}-${sc}`);
        expect(`${sc}: ${duplicates(after).join(",")}`).toBe(`${sc}: `);
        expect(parseWorkspace(serializeWorkspace(after)).ok).toBe(true);
      }
      expect(resets).toBe(5);
    }, 120_000);

  it("on an rc3-derived workspace the counter is untouched (no-op reset is still the identity apart from audit)", () => {
    const ws = sampleWorkspace();
    for (const sc of SCENARIOS) {
      const r = resetScenario(ws, sc, { actorId: "usr_maya", at: ws.asOf });
      expect(r.ok && r.value.workspace.seq).toBe(ws.seq + 1); // only the reset audit event's id
    }
  });
});

describe("per-case reset through the console's path (src/components/clearline/workspace.tsx: parseWorkspace → resetScenario at asOf + 1 min → persist → actions at asOf + 1 min each → reload)", () => {
  const nextInstant = (asOf: string) => new Date(Date.parse(asOf) + 60_000).toISOString();
  for (const f of ["v2_sample.json", "v2_va.json", "v2_vb.json", "v2_t1.json"])
    it(`${f}: every case reset in turn as the console does it, with work between resets; storage round-trips and ids stay unique`, () => {
      let stored = readFileSync(path.join(__dirname, "fixtures", f), "utf8");
      for (const sc of SCENARIOS) {
        const parsed = parseWorkspace(stored);
        if (!parsed.ok) throw new Error(`${sc}: reload refused: ${parsed.error.message}`);
        let current = parsed.value;
        const r = resetScenario(current, sc, { actorId: "usr_maya", at: nextInstant(current.asOf) });
        if (!r.ok) throw new Error(`${sc}: ${r.error.message}`);
        current = r.value.workspace;
        stored = serializeWorkspace(current); // persist
        for (let k = 0; k < 4; k++) {
          const a = applyAction(current, { type: "ingest_statement_line", line: debitLine({ lineId: `CON-${sc}-${k}`, accountRef: "BANK-SGD-CON", amountMinor: 2_000 + k, reference: `UNKNOWN ${k}` }) }, { actorId: "usr_maya", at: nextInstant(current.asOf) });
          if (!a.ok) throw new Error(`${sc} action ${k}: ${a.error.message}`);
          current = a.value.workspace;
        }
        expect(`${sc}: ${duplicates(current).join(",")}`).toBe(`${sc}: `);
        stored = serializeWorkspace(current);
      }
      const final = parseWorkspace(stored);
      expect(final.ok).toBe(true);
      expect(final.ok && final.value.audit.filter((a) => a.action === "scenario.reset")).toHaveLength(5);
    }, 120_000);
});
