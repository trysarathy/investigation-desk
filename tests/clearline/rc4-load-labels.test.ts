/**
 * rc4 Accounting Bridge — load-time validation, older workspaces, per-case reset, labels (CHANGE 15).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNTING_ACTION_TYPES, HUMAN_LABELS, canResetScenario, describeCode, describeError, isKnownCode, loadWorkspace, resetScenario, sampleWorkspace, serializeWorkspace,
  type Workspace,
} from "@/lib/clearline";
import { run } from "./helpers";
import { active, byRule, period, postAll, proposals, s4Final, tryAct, view } from "./rc4-helpers";

const ws0 = sampleWorkspace();
const FIX = join(__dirname, "fixtures");
const load = (ws: Workspace) => loadWorkspace(JSON.stringify(ws));
const refusedAt = (ws: Workspace) => { const r = load(ws); return r.ok ? "loaded" : r.error.field; };
const mutate = (f: (w: Workspace) => void) => { const w = structuredClone(ws0); f(w); return w; };

describe("older workspaces: absent bridge data means empty; nothing is refused or migrated", () => {
  for (const f of readdirSync(FIX).filter((x) => x.endsWith(".json")))
    it(`fixture ${f} loads exactly as before (no accounting key added)`, () => {
      const text = readFileSync(join(FIX, f), "utf8");
      const r = loadWorkspace(text);
      if (!r.ok) return; // fixtures that rc3 already refuses stay refused (rc3-migration tests); the bridge adds no refusal
      expect(r.value.workspace.accounting).toBeUndefined();
      expect(serializeWorkspace(r.value.workspace)).not.toMatch(/"accounting"/);
    });
  it("an rc3 workspace (the sample without bridge data) loads with migrations [] and byte-identical, and every action still works", () => {
    const rc3 = { ...structuredClone(ws0) } as Workspace;
    delete rc3.accounting;
    const text = serializeWorkspace(rc3);
    const r = loadWorkspace(text);
    expect(r.ok && r.value.migrations).toEqual([]);
    expect(r.ok && serializeWorkspace(r.value.workspace)).toBe(text);
    const after = run(rc3, "usr_maya", { type: "advance_clock", to: "2026-11-14T00:00:00.000Z" }).workspace;
    expect(after.accounting).toBeUndefined();
    expect(view(after)).toMatchObject({ configured: false, proposals: [], periods: [] });
  });
  it("the sample with bridge data loads with migrations [] and byte-identical", () => {
    const text = serializeWorkspace(ws0);
    const r = loadWorkspace(text);
    expect(r.ok && r.value.migrations).toEqual([]);
    expect(r.ok && serializeWorkspace(r.value.workspace)).toBe(text);
  });
});

describe("load-time validation refuses crafted bridge records (never repaired)", () => {
  const p0 = () => ws0.accounting!.proposals[0];
  it("unbalanced entry (one minor unit off)", () => expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].lines[1].amountMinor += 1; }))).toBe("accounting.proposals[0].lines"));
  it("lines in two currencies", () => expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].lines[1].currency = "USD"; }))).toBe("accounting.proposals[0].lines[1].currency"));
  it("a line without evidence, or naming evidence that does not exist", () => {
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].lines[0].evidenceIds = []; }))).toBe("accounting.proposals[0].lines[0].evidenceIds");
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].lines[0].evidenceIds = ["stl_99999"]; }))).toBe("accounting.proposals[0].lines[0].evidenceIds");
  });
  it("posted without a recorded posting, or a posting on a non-posted entry (proposed ≠ posted)", () => {
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].status = "posted"; }))).not.toBe("loaded");
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].posting = { externalReference: "JNL-1", recordedBy: "usr_maya", recordedAt: w.asOf, simulated: true }; }))).toBe("accounting.proposals[0].posting");
  });
  it("approval by the proposer, or by a non-approver (maker ≠ checker)", () => {
    expect(refusedAt(mutate((w) => { const p = w.accounting!.proposals[0]; p.status = "approved"; p.approval = { by: p.createdBy, at: w.asOf }; }))).toBe("accounting.proposals[0].approval.by");
    expect(refusedAt(mutate((w) => { const p = w.accounting!.proposals[0]; p.status = "approved"; p.approval = { by: "usr_sam", at: w.asOf }; }))).toBe("accounting.proposals[0].approval.by");
    expect(refusedAt(mutate((w) => { const p = w.accounting!.proposals[0]; p.status = "approved"; p.approval = { by: "usr_daniel", at: w.asOf }; }))).toBe("loaded");
    // an approver who proposed the entry and "approved" it themselves: the role is right, so only maker ≠ checker refuses it
    const own = run(s4Final(), "usr_daniel", { type: "propose_journal_entries" }).workspace;
    const i = own.accounting!.proposals.findIndex((p) => p.createdBy === "usr_daniel");
    own.accounting!.proposals[i].status = "approved";
    own.accounting!.proposals[i].approval = { by: "usr_daniel", at: own.asOf };
    expect(refusedAt(own)).toBe(`accounting.proposals[${i}].approval.by`);
    const r = load(own);
    expect(!r.ok && r.error.message).toMatch(/maker ≠ checker/);
  });
  it("a returned payout's entry that debits the supplier payable, or claims the supplier paid (returns never imply paid)", () => {
    const i = ws0.accounting!.proposals.findIndex((p) => p.ruleCode === "JR_PAYOUT_DEBIT_NOT_DELIVERED");
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[i].lines[0].accountKey = "supplier_payable"; }))).toBe(`accounting.proposals[${i}].lines`);
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[i].showsSupplierPaid = true; }))).toBe(`accounting.proposals[${i}].showsSupplierPaid`);
    const j = ws0.accounting!.proposals.findIndex((p) => p.ruleCode === "JR_PAYOUT_RETURN_CREDIT");
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[j].lines[1].accountKey = "supplier_payable"; }))).toBe(`accounting.proposals[${j}].lines`);
  });
  it("a stablecoin entry against a bank account (a chain transfer never proves a bank credit)", () => {
    const w = structuredClone(sampleWorkspace());
    const s = run(s4Final(w), "usr_maya", { type: "propose_journal_entries" }).workspace;
    const i = s.accounting!.proposals.findIndex((p) => p.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER");
    s.accounting!.proposals[i].lines[1].accountKey = "bank:BANK-SGD-OPS (fictional)";
    expect(refusedAt(s)).toBe(`accounting.proposals[${i}].lines`);
  });
  it("a proposed entry in a closed period; overlapping periods; an unknown rule; a bad mapping", () => {
    expect(refusedAt(mutate((w) => { const p = w.accounting!.periods[0]; p.status = "closed"; p.closedBy = "usr_daniel"; p.closedAt = w.asOf; }))).toBe("accounting.proposals[0].periodId");
    expect(refusedAt(mutate((w) => { w.accounting!.periods.push({ ...w.accounting!.periods[0], id: "per_99999", name: "dup" }); }))).toBe("accounting.periods[1].from");
    expect(refusedAt(mutate((w) => { (w.accounting!.proposals[0] as { ruleCode: string }).ruleCode = "JR_MAGIC"; }))).toBe("accounting.proposals[0].ruleCode");
    expect(refusedAt(mutate((w) => { w.accounting!.mapping!.entries[0].accountCode = "=1"; }))).toBe("accounting.mapping.entries[0].accountCode");
  });
  it("a posting date outside its period, or a prior-period flag without a closed period", () => {
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].postingDate = "2026-12-05"; }))).toBe("accounting.proposals[0].postingDate");
    expect(refusedAt(mutate((w) => { w.accounting!.proposals[0].priorPeriodItem = { originalDate: p0().entryDate, originalPeriodId: w.accounting!.periods[0].id, reason: "x" }; }))).toBe("accounting.proposals[0].priorPeriodItem");
  });
  it("every action re-validates: a crafted workspace is refused by applyAction with a typed error and no change", () => {
    const bad = mutate((w) => { w.accounting!.proposals[0].lines[1].amountMinor += 1; });
    const r = tryAct(bad, "usr_maya", { type: "advance_clock", to: bad.asOf });
    expect(!r.ok && r.error).toMatchObject({ code: "invalid_field", field: "accounting.proposals[0].lines" });
  });
});

describe("per-case reset with journal proposals", () => {
  it("resetting a case whose proposals are only proposed restores them; the other cases' proposals are unchanged", () => {
    let ws = run(ws0, "usr_daniel", { type: "reject_journal_proposal", proposalId: byRule(ws0, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id, reason: "test (fictional)" }).workspace;
    const r = resetScenario(ws, "s1_success", { actorId: "usr_maya", at: ws.asOf });
    if (!r.ok) throw new Error(r.error.message);
    expect(proposals(r.value.workspace)).toEqual(proposals(ws0));
    expect(r.value.restoredIds).toContain(byRule(ws0, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id);
    ws = r.value.workspace;
    expect(load(ws).ok).toBe(true);
  });
  it("an approved, exported or posted entry blocks resetting its case (ACCOUNTING_ENTRIES_RECORDED); other cases can still be reset", () => {
    const id = byRule(ws0, "JR_ADVANCE_DISBURSED")[0].id;
    for (const ws of [run(ws0, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace, postAll(ws0, [id])]) {
      const c = canResetScenario(ws, "s5_funding");
      expect(c).toMatchObject({ allowed: false, code: "ACCOUNTING_ENTRIES_RECORDED" });
      expect(c.blockers).toContain(id);
      expect(isKnownCode(c.code)).toBe(true);
      expect(canResetScenario(ws, "s3_hold").allowed).toBe(true);
    }
  });
  it("a reset at a later clock after new evidence supersedes nothing elsewhere and keeps the workspace loadable", () => {
    let ws = s4Final();
    ws = run(ws, "usr_maya", { type: "propose_journal_entries" }).workspace;
    const r = resetScenario(ws, "s4_chain", { actorId: "usr_maya", at: "2026-11-20T00:00:00.000Z" });
    if (!r.ok) throw new Error(r.error.message);
    expect(byRule(r.value.workspace, "JR_STABLECOIN_FINAL_TRANSFER")).toEqual([]);
    expect(active(r.value.workspace).map((p) => p.id)).toEqual(active(ws0).map((p) => p.id));
    expect(load(r.value.workspace).ok).toBe(true);
  });
});

describe("labels: everything goes through HUMAN_LABELS", () => {
  const SRC = join(__dirname, "../../src/lib/clearline/accounting");
  const types = readFileSync(join(SRC, "types.ts"), "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
  const members = (name: string) => [...new RegExp(`export type ${name} =([^;]+);`).exec(types)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const dims: [keyof typeof HUMAN_LABELS, string][] = [
    ["journalProposalStatus", "JournalProposalStatus"], ["journalRule", "JournalRuleCode"], ["accountRole", "AccountRole"], ["notProposed", "NotProposedCode"],
    ["supersession", "SupersessionCode"], ["accountingPeriodStatus", "AccountingPeriodStatus"], ["accountingExportKind", "AccountingExportKind"],
  ];
  for (const [dim, t] of dims)
    it(`every ${t} member has a label in HUMAN_LABELS.${dim}`, () => {
      const m = members(t);
      expect(m.length).toBeGreaterThan(1);
      expect(Object.keys(HUMAN_LABELS[dim]).sort()).toEqual([...m].sort());
      for (const v of m) expect((HUMAN_LABELS[dim] as Record<string, string>)[v]).toMatch(/\S/);
    });
  it("every export evidence class and movement has a label", () => {
    const ex = readFileSync(join(SRC, "exports.ts"), "utf8");
    const u = (name: string) => [...new RegExp(`export type ${name} =([^;]+);`).exec(ex)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(Object.keys(HUMAN_LABELS.exportEvidenceClass).sort()).toEqual(u("ExportEvidenceClass").sort());
    expect(Object.keys(HUMAN_LABELS.exportMovement).sort()).toEqual(u("ExportMovementKind").sort());
  });
  it("every static JR_/NP_/SP_/XR_ code in the bridge source is known to describeCode", () => {
    const src = readdirSync(SRC).map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
    const codes = new Set([...src.matchAll(/"((?:JR|NP|SP|XR)_[A-Z0-9_]*[A-Z0-9])"/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(25);
    expect([...codes].filter((c) => !isKnownCode(c))).toEqual([]);
    for (const c of codes) expect(describeCode(c)).not.toMatch(/Unrecognised/);
  });
  it("every refusal prefix in the bridge source has a plain-words reason, and describeError uses it", () => {
    const src = readdirSync(SRC).map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
    const prefixes = new Set([...src.matchAll(/`([A-Z][A-Z_]{4,}): /g)].map((m) => m[1]));
    expect(prefixes.size).toBeGreaterThan(5);
    for (const p of prefixes) {
      expect(HUMAN_LABELS.bridgeReason[p], p).toMatch(/\S/);
      const h = describeError({ code: "precondition_failed", message: `${p}: detail.` });
      expect(h.reasonCode).toBe(p);
      expect(h.detail.startsWith(HUMAN_LABELS.bridgeReason[p])).toBe(true);
    }
  });
  it("every bridge action outcome has a label; every bridge action type is dispatched", () => {
    const src = readFileSync(join(SRC, "actions.ts"), "utf8");
    const outcomes = [...src.matchAll(/"((?:applied|proposals_created|no_new_proposals))"/g)].map((m) => m[1]);
    for (const o of new Set(outcomes)) expect(HUMAN_LABELS.actionOutcome[o], o).toMatch(/\S/);
    for (const t of ACCOUNTING_ACTION_TYPES) expect(src).toContain(`case "${t}":`);
  });
  it("labels never call a proposed, approved or exported entry posted, and returned-payout rules never say the supplier was paid", () => {
    for (const s of ["proposed", "approved", "exported"] as const) expect(HUMAN_LABELS.journalProposalStatus[s]).not.toMatch(/^Posted/);
    expect(HUMAN_LABELS.journalProposalStatus.proposed).toMatch(/not posted/);
    expect(HUMAN_LABELS.journalRule.JR_PAYOUT_DEBIT_NOT_DELIVERED).toMatch(/not paid/);
    expect(HUMAN_LABELS.journalRule.JR_PAYOUT_RETURN_CREDIT).toMatch(/not paid/);
    expect(HUMAN_LABELS.journalRule.JR_STABLECOIN_FINAL_TRANSFER).toMatch(/not a bank credit/);
  });
  it("the view carries a status and rule label for every proposal", () => {
    for (const p of view(ws0).proposals) {
      expect(p.statusLabel).toBe(HUMAN_LABELS.journalProposalStatus[p.status]);
      expect(p.ruleLabel).toBe(HUMAN_LABELS.journalRule[p.ruleCode]);
      expect(p.current).toBe(true);
      expect(p.accounts.every((a) => a.accountCode && a.roleLabel)).toBe(true);
    }
    expect(period(ws0).status).toBe("open");
  });
});
