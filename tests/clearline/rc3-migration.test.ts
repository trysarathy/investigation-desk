/**
 * Review M-1: workspaces saved by the v2 engine (built on cf8732e by the reviewer; fixtures in ./fixtures, with
 * the opaque sample line-id prefix "DBS-SIM-" renamed "SIMBANK-" per invariant 9 — nothing else changed) are
 * MIGRATED on load to the rc3 state, not refused. Only states no engine version could produce are refused.
 * - v2_t1.json: T-1 — chain-final payout, then payout.failed → stored failed / verified (onchain_transfer).
 * - v2_t2.json: T-2 — debit, payout.failed, person resolved RC_DEBIT_FOR_FAILED_PAYOUT → failed / verified.
 */
import { readFileSync } from "node:fs";
import { run, sim, submitted } from "./helpers";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, applyAction, getAdapter, canResetScenario, investigate, loadWorkspace, loadWorkspaceValue, resetScenario, listExceptions, parseWorkspace, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace } from "@/lib/clearline";

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

describe("second re-review R2-M1: every v2 state rc3 cannot produce is corrected on load (v2_gaps.json, reviewer, real cf8732e engine)", () => {
  const before = raw("v2_gaps.json");
  const r = loadWorkspace(fixture("v2_gaps.json"));
  if (!r.ok) throw new Error(r.error.message);
  const ws = r.value.workspace;
  const byKind = (k: string) => r.value.migrations.filter((m) => m.kind === k);

  it("C-1 revival: a chain-1 observation v2 counted as final is no longer counted; the payout is no longer 'verified'", () => {
    const i = ws.intents.find((x) => x.internalReference === "INV-V2-B")!;
    expect(before.intents.find((x) => x.id === i.id)!.status).toMatchObject({ settlement: "verified", settlementScope: "onchain_transfer" });
    // Before the fix: loaded as in_transit / verified (onchain_transfer), migrations [].
    expect(i.status).toMatchObject({ execution: "in_transit", settlement: "none", settlementScope: "none" });
    expect(ws.chainObservations.filter((o) => o.intentId === i.id).map((o) => [o.chainId, o.status])).toEqual([[1, "rejected_unsupported"]]);
    const m = byKind("chain_observation_not_allowlisted");
    expect(m.map((x) => [x.intentId, x.outcome, x.from.settlement, x.to.settlement])).toEqual([[i.id, "observation_not_counted", "verified", "none"]]);
    expect(m[0].exceptionId).toBeUndefined(); // CH_UNSUPPORTED_TOKEN_OR_NETWORK was already open
    expect(m[0].text).toMatch(/not on the allowlist\. It is no longer counted; settlement verified → none\.$/);
    const v = investigate(ws, i.id);
    expect(v.ok && v.value.status.settlement).toBe("none");
  });
  it("T-1 before finality: failed with a pending chain transfer → contradicted with CH_TRANSFER_FOR_TERMINAL_PAYOUT (owned)", () => {
    const i = ws.intents.find((x) => x.internalReference === "INV-V2-A")!;
    expect(i.status).toMatchObject({ execution: "failed", settlement: "contradicted", settlementScope: "onchain_transfer" });
    const m = byKind("terminal_payout_evidence");
    expect(m.map((x) => [x.intentId, x.outcome, x.exceptionCode, x.from.settlement])).toEqual([[i.id, "contradiction_raised", "CH_TRANSFER_FOR_TERMINAL_PAYOUT", "pending_finality"]]);
    expect(listExceptions(ws, { intentId: i.id, status: "unresolved" }).find((e) => e.id === m[0].exceptionId)).toMatchObject({ ownerId: "usr_maya" });
  });
  it("C-3 reorg: s4 contradicted + matched on a transfer that is no longer final → reconciliation exception", () => {
    const i = ws.intents.find((x) => x.scenario === "s4_chain")!;
    expect(before.intents.find((x) => x.id === i.id)!.status.reconciliation).toBe("matched");
    expect(i.status).toMatchObject({ settlement: "contradicted", reconciliation: "exception" });
    expect(byKind("reorg_reconciliation").map((x) => [x.intentId, x.outcome, x.from.reconciliation, x.to.reconciliation])).toEqual([[i.id, "reconciliation_reopened", "matched", "exception"]]);
  });
  it("nothing else changes; idempotent; every migration is audited; never an upgrade", () => {
    expect(r.value.migrations).toHaveLength(3);
    const touched = new Set(r.value.migrations.map((m) => m.intentId));
    for (const x of before.intents.filter((y) => !touched.has(y.id))) expect(ws.intents.find((y) => y.id === x.id)).toEqual(x);
    for (const m of r.value.migrations) expect(ws.audit.find((a) => a.id === m.auditId)).toMatchObject({ action: "workspace.migrated", entityId: m.intentId });
    const rank: Record<string, number> = { none: 0, observed: 1, pending_finality: 2, verified: 3 };
    for (const m of r.value.migrations) if (m.to.settlement !== "contradicted") expect(rank[m.to.settlement]).toBeLessThanOrEqual(rank[m.from.settlement] ?? 9);
    const again = loadWorkspace(serializeWorkspace(ws));
    expect(again.ok && again.value.migrations).toEqual([]);
  });
});

describe("second re-review R2-m2: the migration's 'another contradiction is still open' branch", () => {
  it("rule exception resolved, but a DIFFERENT contradiction still open → contradicted (not none)", () => {
    const t2 = raw("v2_t2.json");
    const i = t2.intents.find((x) => x.status.execution === "failed" && x.status.settlement === "verified")!;
    const rule = t2.exceptions.find((e) => e.explanationCode === "RC_DEBIT_FOR_FAILED_PAYOUT")!;
    t2.exceptions.push({ ...rule, id: "exc_99902", explanationCode: "EV_IMPOSSIBLE_TRANSITION", status: "open", resolution: undefined, statementLineId: undefined });
    const r = loadWorkspace(JSON.stringify(t2));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations.map((m) => [m.outcome, m.exceptionId])).toEqual([["contradicted_open", "exc_99902"]]);
    expect(r.value.workspace.intents.find((x) => x.id === i.id)!.status.settlement).toBe("contradicted");
  });
});

describe("R2-M1: the migration never upgrades evidence", () => {
  it("a revived (not allowlisted) chain observation at 'observed', with a full bank debit on record: stays 'observed' (scope bank_statement), never jumps to 'verified'", () => {
    const g = raw("v2_gaps.json");
    const i = g.intents.find((x) => x.internalReference === "INV-V2-B")!;
    i.status.settlement = "observed";
    g.chainObservations.find((o) => o.intentId === i.id)!.status = "observed";
    // a full, matched bank debit already on record for this payout
    const tmplLine = g.statementLines.find((l) => l.allocationIds.length && l.direction === "debit")!;
    const tmplAlloc = g.allocations.find((a) => a.statementLineId === tmplLine.id)!;
    g.statementLines.push({ ...tmplLine, id: "stl_99990", lineId: "UPG-1", currency: i.sourceCurrency, amountMinor: i.amountMinor, allocationIds: ["alc_99991"], amountDifference: undefined });
    g.allocations.push({ ...tmplAlloc, id: "alc_99991", statementLineId: "stl_99990", currency: i.sourceCurrency, amountMinor: i.amountMinor, target: { kind: "payment", intentId: i.id } });
    const r = loadWorkspace(JSON.stringify(g));
    if (!r.ok) throw new Error(r.error.message);
    const m = r.value.migrations.find((x) => x.intentId === i.id)!;
    expect(m.kind).toBe("chain_observation_not_allowlisted");
    expect(m.to.settlement).toBe("observed");
    expect(m.to.settlementScope).toBe("bank_statement");
  });
});

describe("R2-M1 rule B: a hash recorded earlier as rejected never counts later (v2 M-3 state)", () => {
  const usdcInTransit = () => {
    let { ws, id } = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater", sampleWorkspace());
    ws = sim(ws, id).workspace;
    const i = ws.intents.find((x) => x.id === id)!;
    const obs = { intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC", txHash: "0x" + "4b".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(i), amountMinor: ws.quotes.find((q) => q.id === i.selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 70, confirmations: 20 };
    return { ws, id, obs };
  };
  it("v2 M-3 state (unsupported USDT record, then the same hash counted as USDC final, verified, no conflict raised) → CH_TX_HASH_CONFLICT raised and settlement contradicted", () => {
    const { ws: w0, id, obs } = usdcInTransit();
    const ws = run(w0, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, tokenSymbol: "USDT", tokenContract: "0x" + "96".repeat(20) } }).workspace;
    const v2 = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const rejected = v2.chainObservations.find((o) => o.intentId === id)!;
    v2.seq += 1;
    v2.chainObservations.push({ ...rejected, id: `chn_${String(v2.seq).padStart(5, "0")}`, tokenSymbol: "USDC", tokenContract: ALLOWLISTED_TOKENS[0].contract, status: "final", confirmations: 20 });
    Object.assign(v2.intents.find((x) => x.id === id)!.status, { settlement: "verified", settlementScope: "onchain_transfer" });
    const r = loadWorkspace(JSON.stringify(v2));
    if (!r.ok) throw new Error(r.error.message);
    // Before the fix: loaded as verified, migrations [].
    expect(r.value.migrations.map((m) => [m.kind, m.outcome, m.exceptionCode])).toEqual([["chain_hash_conflict", "contradiction_raised", "CH_TX_HASH_CONFLICT"]]);
    expect(r.value.workspace.intents.find((x) => x.id === id)!.status.settlement).toBe("contradicted");
  });
  it("the reverse order is an ordinary rc3 state (valid USDC first, an unsupported record of the same hash later): nothing changes", () => {
    const { ws: w0, obs } = usdcInTransit();
    let ws = run(w0, "usr_maya", { type: "ingest_chain_observation", observation: obs }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, tokenSymbol: "USDT", tokenContract: "0x" + "96".repeat(20) } }).workspace;
    const r = loadWorkspace(serializeWorkspace(ws));
    expect(r.ok && r.value.migrations).toEqual([]);
  });
});

describe("third re-review R3-m1: migration rules pinned one by one", () => {
  it("rule A raises CH_UNSUPPORTED_TOKEN_OR_NETWORK (owned) when the stored workspace lacks it", () => {
    const g = raw("v2_gaps.json");
    const i = g.intents.find((x) => x.internalReference === "INV-V2-B")!;
    const drop = g.exceptions.filter((e) => e.intentId === i.id && e.explanationCode === "CH_UNSUPPORTED_TOKEN_OR_NETWORK").map((e) => e.id);
    g.exceptions = g.exceptions.filter((e) => !drop.includes(e.id));
    for (const c of g.cases) c.exceptionIds = c.exceptionIds.filter((x) => !drop.includes(x));
    const r = loadWorkspace(JSON.stringify(g));
    if (!r.ok) throw new Error(r.error.message);
    const m = r.value.migrations.find((x) => x.kind === "chain_observation_not_allowlisted")!;
    expect(m).toMatchObject({ exceptionCode: "CH_UNSUPPORTED_TOKEN_OR_NETWORK", ownerId: "usr_maya" });
    expect(r.value.workspace.exceptions.find((e) => e.id === m.exceptionId)).toMatchObject({ category: "unsupported_token_or_network", status: "in_review" });
  });

  it("rule B honours a person's supersede: the freed hash later counted for ANOTHER payout is an rc3 state and is left alone", () => {
    const usdc = (ws0: Workspace, ref: string) => {
      const s = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay", internalReference: ref }, "prv_tidewater", ws0);
      return { ws: sim(s.ws, s.id).workspace, id: s.id };
    };
    const obs = (ws: Workspace, id: string, o: Record<string, unknown> = {}) => {
      const i = ws.intents.find((x) => x.id === id)!;
      return { intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC", txHash: "0x" + "3c".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(i), amountMinor: ws.quotes.find((q) => q.id === i.selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 80, confirmations: 20, ...o };
    };
    let { ws, id: x } = usdc(sampleWorkspace(), "INV-R3-X");
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obs(ws, x, { chainId: 1, network: "ethereum" }) }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obs(ws, x) }).workspace; // conflict on X
    const exc = ws.exceptions.find((e) => e.intentId === x && e.explanationCode === "CH_TX_HASH_ON_OTHER_CHAIN")!;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "document_metadata", description: "Explorer (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Wrong network on the first entry" }).workspace;
    const y = usdc(ws, "INV-R3-Y");
    ws = run(y.ws, "usr_maya", { type: "ingest_chain_observation", observation: obs(y.ws, y.id) }).workspace; // counted for Y
    expect(ws.chainObservations.some((o) => o.intentId === y.id && o.status === "final")).toBe(true);
    const r = loadWorkspace(serializeWorkspace(ws));
    expect(r.ok && r.value.migrations).toEqual([]);
  });

  it("rule D leaves a payout alone when a full bank match backs the 'matched' (the chain transfer is no longer final)", () => {
    const g = raw("v2_gaps.json");
    const s4 = g.intents.find((x) => x.scenario === "s4_chain")!;
    const tmplLine = g.statementLines.find((l) => l.allocationIds.length && l.direction === "debit")!;
    const tmplAlloc = g.allocations.find((a) => a.statementLineId === tmplLine.id)!;
    g.statementLines.push({ ...tmplLine, id: "stl_99980", lineId: "R3-D-1", accountRef: "BANK-USDC (fictional)", currency: "USDC", amountMinor: s4.amountMinor, allocationIds: ["alc_99981"], amountDifference: undefined });
    g.allocations.push({ ...tmplAlloc, id: "alc_99981", statementLineId: "stl_99980", currency: "USDC", amountMinor: s4.amountMinor, target: { kind: "payment", intentId: s4.id } });
    const r = loadWorkspace(JSON.stringify(g));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations.filter((m) => m.kind === "reorg_reconciliation")).toEqual([]);
  });
});
