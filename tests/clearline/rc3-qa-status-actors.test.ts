/**
 * QA rc3 L1 / L2 (QA_SECURITY_REVIEW_RC3.md): a crafted stored or posted workspace.
 * - L1: a stored settlement / reconciliation above what the recorded evidence supports is capped on load (migration
 *   rule E, kind "status_exceeds_evidence", never an upgrade), and canResolveCase never trusts such a status.
 * - L2: every recorded decision names an existing actor with the role its action requires.
 * QA's own tests are in tests/qa-release-rc3/engine-rc3.test.ts; these pin the details.
 */
import { describe, expect, it } from "vitest";
import {
  canResolveCase, evidenceCeiling, loadWorkspace, loadWorkspaceValue, parseWorkspaceValue, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace,
} from "@/lib/clearline";
import { attempt, debitLine, intent, run, sim, submitted } from "./helpers";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const refused = (ws: Workspace, field: RegExp) => {
  const r = parseWorkspaceValue(clone(ws));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toMatch(field);
};

/** The sample's s4 payout (only a pending-finality transfer), forged to verified / matched with its exceptions resolved. */
function forgedS4() {
  const ws = clone(sampleWorkspace());
  const id = scenarioIntentId(ws, "s4_chain")!;
  const i = ws.intents.find((x) => x.id === id)!;
  i.status.settlement = "verified";
  i.status.reconciliation = "matched";
  const c = ws.cases.find((x) => x.id === i.caseId)!;
  c.ownerId = "usr_maya";
  for (const eid of c.exceptionIds) Object.assign(ws.exceptions.find((x) => x.id === eid)!, { status: "resolved", ownerId: "usr_maya", resolution: { at: ws.asOf, actorId: "usr_maya", note: "forged" } });
  return { ws, id, caseId: c.id };
}

describe("QA rc3 L1: a stored status above the evidence is capped, never trusted", () => {
  it("load caps the forged s4 to what rc3 derives (pending finality / pending), reports it once, audits it, and is idempotent", () => {
    const { ws, id, caseId } = forgedS4();
    const load = ok(loadWorkspaceValue(clone(ws)));
    const st = load.workspace.intents.find((x) => x.id === id)!.status;
    expect(st).toMatchObject({ settlement: "pending_finality", settlementScope: "onchain_transfer", reconciliation: "pending" });
    const m = load.migrations.filter((x) => x.intentId === id);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "status_exceeds_evidence", outcome: "status_capped", from: { settlement: "verified", reconciliation: "matched" }, to: { settlement: "pending_finality", reconciliation: "pending" } });
    expect(m[0].text).toMatch(/more than its recorded evidence supports/);
    expect(load.workspace.audit.find((a) => a.id === m[0].auditId)).toMatchObject({ action: "workspace.migrated", entityId: id });
    expect(canResolveCase(load.workspace, caseId)).toMatchObject({ allowed: false, code: "EVIDENCE_OUTSTANDING" });
    const again = ok(loadWorkspace(serializeWorkspace(load.workspace)));
    expect(again.migrations).toEqual([]);
    expect(serializeWorkspace(again.workspace)).toBe(serializeWorkspace(load.workspace));
  });

  it("canResolveCase on the forged object itself (not loaded) refuses, naming the unsupported stored status", () => {
    const { ws, caseId } = forgedS4();
    const r = canResolveCase(ws, caseId);
    expect(r).toMatchObject({ allowed: false, code: "EVIDENCE_OUTSTANDING" });
    expect(r.reason).toMatch(/does not support that stored status/);
  });

  it("an applyAction on the forged workspace cannot close the case", () => {
    const { ws, caseId } = forgedS4();
    const r = attempt(ws, "usr_maya", { type: "resolve", target: { kind: "case", id: caseId }, note: "Closing (forged)" });
    expect(r.ok).toBe(false);
  });

  it("a fiat payout forged verified / matched with no statement line, and partially matched with no allocation, is capped", () => {
    let { ws, id } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    const forged = clone(ws);
    Object.assign(forged.intents.find((x) => x.id === id)!.status, { settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" });
    const l = ok(loadWorkspaceValue(forged));
    expect(l.workspace.intents.find((x) => x.id === id)!.status).toMatchObject({ settlement: "none", settlementScope: "none", reconciliation: "pending" });
    expect(l.migrations.map((m) => m.kind)).toEqual(["status_exceeds_evidence"]);
    const partly = clone(ws);
    partly.intents.find((x) => x.id === id)!.status.reconciliation = "partially_matched";
    const p = ok(loadWorkspaceValue(partly));
    expect(p.workspace.intents.find((x) => x.id === id)!.status.reconciliation).toBe("pending");
    expect(p.migrations.map((m) => m.kind)).toEqual(["status_exceeds_evidence"]);
    // observed with no evidence at all is also above the evidence
    const obs = clone(ws);
    obs.intents.find((x) => x.id === id)!.status.settlement = "observed";
    expect(ok(loadWorkspaceValue(obs)).workspace.intents.find((x) => x.id === id)!.status.settlement).toBe("none");
  });

  it("a short bank debit stored as verified is capped to observed (evidence supports observed, not verified)", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: 400_000, reference: `NORTHLINE PAYOUT ${ppid}` }) }).workspace;
    const before = intent(ws, id).status;
    expect(before.settlement).not.toBe("verified");
    const forged = clone(ws);
    forged.intents.find((x) => x.id === id)!.status.settlement = "verified";
    expect(evidenceCeiling(forged, forged.intents.find((x) => x.id === id)!).settlement).not.toBe("verified");
    const l = ok(loadWorkspaceValue(forged));
    expect(l.workspace.intents.find((x) => x.id === id)!.status.settlement).not.toBe("verified");
    expect(l.migrations.some((m) => m.kind === "status_exceeds_evidence")).toBe(true);
  });

  it("evidence that does support verified / matched loads unchanged (the sample's verified payouts, a final transfer)", () => {
    const ws0 = sampleWorkspace();
    const id = scenarioIntentId(ws0, "s4_chain")!;
    const o = ws0.chainObservations.find((x) => x.intentId === id)!;
    const fin = run(ws0, "usr_maya", { type: "ingest_chain_observation", observation: { intentId: id, chainId: o.chainId, network: o.network, tokenContract: o.tokenContract, tokenSymbol: o.tokenSymbol, txHash: o.txHash, toAddress: o.toAddress, amountMinor: o.amountMinor, blockNumber: o.blockNumber, confirmations: 100 } }).workspace;
    expect(intent(fin, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    const l = ok(loadWorkspace(serializeWorkspace(fin)));
    expect(l.migrations).toEqual([]);
    expect(ok(loadWorkspace(serializeWorkspace(ws0))).migrations).toEqual([]);
  });

  it("a terminal payout stored as verified without evidence is still refused by the integrity check (not silently capped)", () => {
    // A payout cancelled before submission: terminal, with no bank or chain evidence (rule C does not apply).
    const a = sampleWorkspace();
    const created = run(a, "usr_maya", { type: "create_intent", input: { internalReference: "INV-QA-L1-T", amountMinor: 50_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-QA-L1", beneficiaryName: "QA Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-12-20", idempotencyKey: "qa-l1-terminal" } });
    const tid = created.createdIds[0];
    const cancelled = run(created.workspace, "usr_maya", { type: "cancel_intent", intentId: tid, reason: "Not needed" }).workspace;
    expect(intent(cancelled, tid).status.execution).toBe("cancelled");
    const forged = clone(cancelled);
    forged.intents.find((x) => x.id === tid)!.status.settlement = "verified";
    refused(forged, /cannot carry verified settlement/);
  });
});

describe("QA rc3 L2: every recorded decision names an existing actor with the required role", () => {
  const base = () => clone(sampleWorkspace());

  it("instructions: checker must be an existing approver (not the maker, not a viewer, operator or unknown); maker an operator or approver", () => {
    for (const who of ["usr_nobody", "usr_alex", "usr_maya", "usr_sam"]) {
      const ws = base();
      const ins = ws.instructions.find((x) => x.checkerId)!;
      ins.checkerId = who === "usr_maya" ? (ins.makerId === "usr_maya" ? "usr_sam" : who) : who;
      if (ins.checkerId === ins.makerId) continue;
      refused(ws, /instructions\[\d+\]\.checkerId/);
    }
    const ws = base();
    ws.instructions[0].makerId = "usr_alex";
    refused(ws, /instructions\[0\]\.makerId/);
  });

  it("funding decisions: checker an existing approver, maker an existing operator", () => {
    for (const who of ["usr_alex", "usr_nobody", "usr_sam"]) {
      const ws = base();
      ws.fundingDecisions[0].checkerId = who;
      refused(ws, /fundingDecisions\[0\]\.checkerId/);
    }
    const ws = base();
    ws.fundingDecisions[0].makerId = "usr_nobody";
    refused(ws, /fundingDecisions\[0\]\.makerId/);
  });

  it("holds: each decision by an existing compliance reviewer (reviewerId); the assigned reviewer has the compliance role", () => {
    const released = base();
    released.holds[0].status = "released";
    released.holds[0].decisions.push({ at: released.asOf, reviewerId: "usr_maya", decision: "release", reason: "forged" });
    refused(released, /holds\[0\]\.decisions\[\d+\]/);
    const noActor = base();
    noActor.holds[0].status = "released";
    noActor.holds[0].decisions.push({ at: noActor.asOf, decision: "release", reason: "forged" } as never);
    refused(noActor, /holds\[0\]\.decisions\[\d+\]/);
    const reviewer = base();
    reviewer.holds[0].reviewerId = "usr_daniel";
    refused(reviewer, /holds\[0\]\.reviewerId/);
    const reqMore = base();
    reqMore.holds[0].decisions.push({ at: reqMore.asOf, reviewerId: "usr_nobody", decision: "request_more", reason: "x" });
    refused(reqMore, /holds\[0\]\.decisions\[\d+\]/);
  });

  it("accepted differences: the accepter and the second approver are existing staff members", () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    const r = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: 1_050_000, reference: `NORTHLINE PAYOUT ${ppid}` }) });
    ws = r.workspace;
    const excId = ws.exceptions.find((e) => e.statementLineId === r.createdIds[0])!.id;
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: excId }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: excId }, evidence: { kind: "document_metadata", description: "Bank fee advice (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: excId }, note: "Fee accepted", acceptDifference: true }).workspace;
    ws = run(ws, "usr_sam", { type: "approve_acceptance", exceptionId: excId, note: "Checked" }).workspace;
    expect(ok(parseWorkspaceValue(clone(ws)))).toBeTruthy();
    for (const who of ["usr_alex", "usr_nobody"]) {
      const f = clone(ws);
      f.exceptions.find((e) => e.id === excId)!.resolution!.acceptedDifference!.secondApproval!.approvedBy = who;
      refused(f, /secondApproval\.approvedBy/);
      const g = clone(ws);
      g.exceptions.find((e) => e.id === excId)!.resolution!.actorId = who;
      refused(g, /resolution\.actorId/);
    }
  });

  it("every v2 fixture and the sample still load (no engine version recorded such decisions)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const f of ["v2_t1", "v2_t2", "v2_sample", "v2_va", "v2_vb", "v2_gaps"]) {
      const r = loadWorkspace(readFileSync(path.join(__dirname, "fixtures", `${f}.json`), "utf8"));
      expect(r.ok, `${f}: ${r.ok ? "" : r.error.message}`).toBe(true);
    }
  });
});

describe("Fifth check R5-m2: evidenceCeiling is exact on chain finality and on return confirmation", () => {
  it("a chain allocation whose observation is not final does not support matched (nor verified)", () => {
    const ws0 = sampleWorkspace();
    const id = scenarioIntentId(ws0, "s4_chain")!;
    const o = ws0.chainObservations.find((x) => x.intentId === id)!;
    const obs = { intentId: id, chainId: o.chainId, network: o.network, tokenContract: o.tokenContract, tokenSymbol: o.tokenSymbol, txHash: o.txHash, toAddress: o.toAddress, amountMinor: o.amountMinor, blockNumber: o.blockNumber };
    const fin = run(ws0, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations: 100 } }).workspace;
    const finIntent = fin.intents.find((x) => x.id === id)!;
    expect(fin.allocations.some((a) => a.evidenceKind === "chain_observation" && a.target.kind === "payment" && a.target.intentId === id)).toBe(true);
    expect(evidenceCeiling(fin, finIntent)).toMatchObject({ settlement: "verified", matched: true });
    // The same allocation, its observation dropped below finality (crafted: no reload, so rule D does not mask it).
    const crafted = clone(fin);
    for (const x of crafted.chainObservations) if (x.intentId === id) x.status = "pending_finality";
    const c = evidenceCeiling(crafted, crafted.intents.find((x) => x.id === id)!);
    expect(c.matched).toBe(false);
    expect(c.settlement).toBe("pending_finality");
    expect(c.partiallyMatched).toBe(true);
  });

  it("a returned payout's return allocation supports matched only once the return is confirmed by the statement", () => {
    const ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s2_returned")!;
    const i = ws.intents.find((x) => x.id === id)!;
    expect(i.status.execution).toBe("returned");
    expect(i.returnStatus).toBe("confirmed_by_statement");
    expect(ws.allocations.some((a) => a.target.kind === "payment" && a.target.intentId === id && a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN"))).toBe(true);
    // Remove the debit allocations so only the return allocation can support matched.
    const onlyReturn = clone(ws);
    onlyReturn.allocations = onlyReturn.allocations.filter((a) => !(a.target.kind === "payment" && a.target.intentId === id && !a.codes.includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN")));
    const ir = onlyReturn.intents.find((x) => x.id === id)!;
    expect(evidenceCeiling(onlyReturn, ir).matched).toBe(true);
    const unconfirmed = clone(onlyReturn);
    const iu = unconfirmed.intents.find((x) => x.id === id)!;
    iu.returnStatus = "provider_reported";
    expect(evidenceCeiling(unconfirmed, iu).matched).toBe(false);
  });
});

describe("Fifth check R5-m1: forged evidence records that no engine version produces are refused", () => {
  /** A provider-completed SGD 10,000.00 payout, nothing allocated. */
  const live = () => {
    let { ws, id, ppid } = submitted();
    ws = sim(sim(ws, id).workspace, id).workspace;
    return { ws: clone(ws), id, ppid };
  };
  const forgeLine = (ws: Workspace, id: string, line: Record<string, unknown>, codes: string[] = ["RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW"]) => {
    const l = { id: "stl_99902", lineId: "FORGED-1", source: "bank_statement", accountRef: "BANK-SGD", direction: "debit", kind: "payment", amountMinor: 1_000_000, currency: "SGD", reference: "NOTHING", counterparty: "X (fictional)", valueDate: "2026-11-13", receivedAt: ws.asOf, status: "allocated", allocationIds: ["alc_99903"], explanationCodes: [], ...line };
    ws.statementLines.push(l as never);
    ws.allocations.push({ id: "alc_99903", statementLineId: l.id, evidenceKind: "statement_line", target: { kind: "payment", intentId: id }, amountMinor: 1_000_000, currency: l.currency, matchedBy: "trusted_reference", codes, createdAt: ws.asOf } as never);
    Object.assign(ws.intents.find((x) => x.id === id)!.status, { settlement: "verified", settlementScope: "bank_statement", reconciliation: "matched" });
    return ws;
  };

  it("the genuine shape loads (a bank debit carrying the provider payment id), so the probes isolate one field each", () => {
    const { ws, id, ppid } = live();
    expect(parseWorkspaceValue(forgeLine(ws, id, { reference: `NORTHLINE PAYOUT ${ppid}` })).ok).toBe(true);
  });

  it("a provider settlement report allocated to a payout is refused", () => {
    const { ws, id, ppid } = live();
    refused(forgeLine(ws, id, { source: "provider_settlement_report", accountRef: "prv_northline:settlement", reference: ppid }), /provider report or a credit is never allocated/);
  });

  it("a bank credit, and a credit without the payout's reference, allocated to a payout are refused", () => {
    const a = live();
    refused(forgeLine(a.ws, a.id, { direction: "credit", reference: "NOTHING" }), /provider payment id/);
    const b = live();
    refused(forgeLine(b.ws, b.id, { direction: "credit", reference: `NORTHLINE ${b.ppid}` }), /never allocated to a payout/);
  });

  it("a bank debit without the payout's provider payment id, or in another currency, is refused", () => {
    const a = live();
    refused(forgeLine(a.ws, a.id, { reference: "NORTHLINE PAYOUT" }), /provider payment id/);
    const b = live();
    refused(forgeLine(b.ws, b.id, { reference: b.ppid, currency: "USD" }), /source currency/);
  });

  it("a return confirmation must come from a return or reversal line", () => {
    const a = live();
    refused(forgeLine(a.ws, a.id, { reference: a.ppid }, ["RC_RETURN_CONFIRMS_PROVIDER_RETURN"]), /return or reversal line/);
    const b = live();
    expect(parseWorkspaceValue(forgeLine(b.ws, b.id, { reference: b.ppid, kind: "return", direction: "credit" }, ["RC_RETURN_CONFIRMS_PROVIDER_RETURN"])).ok).toBe(true);
  });
});

