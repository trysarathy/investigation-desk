/**
 * rc4 Accounting Bridge — the re-review of 466d42a (APPROVE, non-blocking R1–R7). Probes: scratchpad/review-probes/p-rereview.
 */
import { describe, expect, it } from "vitest";
import { describeError, getAdapter, ledgerProblem, loadWorkspace, sampleWorkspace, serializeWorkspace, type Workspace } from "@/lib/clearline";
import { basisOf } from "@/lib/clearline/accounting/derive";
import { attempt, debitLine, errorCode, intent, run, sim, submitted } from "./helpers";
import { S, active, byRule, period, postAll, propose, proposals, s4Final, tryAct, view } from "./rc4-helpers";

const ppidOf = (ws: Workspace, id: string) => ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!.providerPaymentId!;

describe("R2: a stored debit-direction return allocation (rc3 shape) gives no entry", () => {
  it("P0: loads with migrations [] and proposes nothing for it; NP_EVIDENCE_CONTRADICTED is listed (kills N1)", () => {
    let { ws, id, ppid } = submitted({ sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    for (let k = 0; k < 6 && intent(ws, id).status.execution !== "returned"; k++) ws = sim(ws, id).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ kind: "reversal", direction: "credit", reference: `RETURN ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const line = o.statementLines.find((x) => x.reference === `RETURN ${ppid}`)!;
    expect(line.allocationIds.length).toBe(1);
    line.direction = "debit"; // what rc3 stored for a debit "reversal" quoting RETURN <ppid>
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations).toEqual([]);
    const after = propose(r.value.workspace).workspace;
    expect(proposals(after).filter((p) => p.evidence.statementLineIds.includes(line.id))).toEqual([]);
    expect(view(after).notProposed.find((n) => n.refs.includes(line.id))!.code).toBe("NP_EVIDENCE_CONTRADICTED");
  });
});

describe("R3: only the first event reporting a tx hash is chain evidence", () => {
  it("a second, distinct provider event with the same tx hash never changes a posted chain entry's basis (kills N6)", () => {
    let ws = propose(s4Final()).workspace;
    const id = S(ws, "s4_chain");
    const [p] = byRule(ws, "JR_STABLECOIN_FINAL_TRANSFER", id);
    ws = postAll(ws, active(ws).map((x) => x.id));
    const e0 = ws.providerEvents.filter((e) => e.intentId === id && e.detail.txHash).at(-1)!;
    const instr = ws.instructions.find((x) => x.id === intent(ws, id).instructionId)!;
    const seq = ws.providerEvents.filter((e) => e.intentId === id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
    const rawBody = JSON.stringify({ id: `${instr.providerPaymentId}-AGAIN`, type: "payout.completed", provider_payment_id: instr.providerPaymentId, sequence: seq, occurred_at: ws.asOf, tx_hash: e0.detail.txHash });
    ws = run(ws, "usr_maya", { type: "ingest_webhook", delivery: { providerId: instr.providerId, rawBody, signatureHeader: getAdapter(instr.providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000)) } }).workspace;
    const again = ws.providerEvents.at(-1)!;
    expect(again.providerEventId).toBe(`${instr.providerPaymentId}-AGAIN`);
    expect(["applied", "recorded_no_state_change"]).toContain(again.processingOutcome); // it would qualify as chain evidence
    expect(again.detail.txHash).toBe(e0.detail.txHash);
    expect(proposals(ws).find((x) => x.id === p.id)!.evidenceChange).toBeUndefined();
    expect(propose(ws).outcome).toBe("no_new_proposals");
  });
});

describe("R4: an approver (not the exporter) can confirm an exported entry was never imported", () => {
  const exported = () => {
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    return { ws, id };
  };
  it("the exporter or an operator cannot confirm; an approver can, it is recorded and audited, no reversal is needed and the entry may be proposed again", () => {
    let { ws, id } = exported();
    expect(errorCode(tryAct(ws, "usr_maya", { type: "confirm_not_imported", proposalId: id, note: "Checked ledger" }))).toBe("maker_checker_violation");
    expect(errorCode(tryAct(ws, "usr_sam", { type: "confirm_not_imported", proposalId: id, note: "Checked ledger" }))).toBe("unauthorized_actor");
    ws = run(ws, "usr_daniel", { type: "confirm_not_imported", proposalId: id, note: "Ledger journal list checked: not imported (fictional)" }).workspace;
    const p = proposals(ws).find((x) => x.id === id)!;
    expect(p).toMatchObject({ status: "rejected", rejection: { notImported: { by: "usr_daniel" } } });
    expect(ws.audit.at(-1)).toMatchObject({ action: "journal.confirmed_not_imported", actorId: "usr_daniel", entityId: id });
    const r = propose(ws);
    expect(byRule(r.workspace, "JR_REVERSAL")).toEqual([]);
    const fresh = byRule(r.workspace, "JR_SUPPLIER_PAYOUT_DEBIT").find((x) => x.status === "proposed")!;
    expect(fresh.id).not.toBe(id);
    expect(fresh.sourceKey).toBe(p.sourceKey);
    expect(errorCode(tryAct(r.workspace, "usr_daniel", { type: "confirm_not_imported", proposalId: id, note: "again" }))).toBe("invalid_transition");
  });
  it("after a withdrawal the pending reversal is superseded by the confirmation; once the reversal is exported, confirming is refused", () => {
    let { ws, id } = exported();
    ws = run(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: id, reason: "Wrong file (fictional)" }).workspace;
    ws = propose(ws).workspace;
    const [rev] = byRule(ws, "JR_REVERSAL");
    const c = run(ws, "usr_daniel", { type: "confirm_not_imported", proposalId: id, note: "Not imported (fictional)" }).workspace;
    expect(proposals(c).find((x) => x.id === rev.id)).toMatchObject({ status: "superseded", supersession: { code: "SP_EVIDENCE_WITHDRAWN" } });
    expect(proposals(c).find((x) => x.id === rev.id)!.supersession!.reason).toMatch(/never imported/);
    // the other path: the reversal goes out first, then a confirmation would contradict the ledger
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: rev.id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    const r = tryAct(ws, "usr_daniel", { type: "confirm_not_imported", proposalId: id, note: "late" });
    expect(!r.ok && describeError(r.error).reasonCode).toBe("REVERSAL_ALREADY_EXPORTED");
  });
});

describe("R6: one payout's payable is cleared at most once in total, never in two currencies", () => {
  it("ledgerProblem refuses a payable cleared in SGD and in USDC for one payout, each within its own bound", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "USDC", destinationCountry: "SG" }, "prv_tidewater", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    for (let k = 0; k < 6; k++) { const s = attempt(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }); if (!s.ok) break; ws = s.value.workspace; }
    ws = propose(ws).workspace;
    expect(ledgerProblem(ws)).toBeUndefined();
    const o = structuredClone(ws);
    const f = o.accounting!.proposals.find((p) => p.ruleCode === "JR_STABLECOIN_ONRAMP_FUNDING" && p.intentId === id)!;
    f.ruleCode = "JR_SUPPLIER_PAYOUT_DEBIT"; f.showsSupplierPaid = true; f.lines[0].accountKey = "supplier_payable";
    for (const l of f.lines) l.ruleCode = "JR_SUPPLIER_PAYOUT_DEBIT";
    f.basisHash = basisOf(f);
    expect(ledgerProblem(o)).toMatch(/cleared in (SGD and USDC|USDC and SGD); a payout is cleared once/);
  });
});

describe("R7: REVERSAL_REQUIRED names the real reason", () => {
  it("for an entry withdrawn after export it says so and points to confirm_not_imported", () => {
    let ws = sampleWorkspace();
    const id = byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT")[0].id;
    ws = run(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "export_journal", periodId: period(ws).id }).workspace;
    ws = run(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: id, reason: "x (fictional)" }).workspace;
    ws = propose(ws).workspace;
    const [rev] = byRule(ws, "JR_REVERSAL");
    const r = tryAct(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: rev.id, reason: "never imported" });
    expect(!r.ok && r.error.message).toMatch(/^REVERSAL_REQUIRED: .* was withdrawn after export .*confirm_not_imported/);
    expect(!r.ok && r.error.message).not.toMatch(/evidence no longer gives it/);
  });
});

/**
 * R1. Running the a91dd11 engine to produce fixtures was not permitted in this session (it needs the old engine checked out
 * over the working tree), so these workspaces are a91dd11-SHAPED: produced by the current engine, then given exactly the
 * records a91dd11 wrote for the same evidence (its rule, lines, evidence ids and its own basis hash, via basisOf — the
 * basis function is unchanged since a91dd11).
 */
describe("R1: a91dd11-shaped saved workspaces load (pending entries superseded, never refused; posted never altered)", () => {
  const onrampWs = () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "USDC", destinationCountry: "SG" }, "prv_tidewater", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    for (let k = 0; k < 6; k++) { const s = attempt(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }); if (!s.ok) break; ws = s.value.workspace; }
    return { ws: propose(ws).workspace, id };
  };
  it("a proposed payable debit on a stablecoin payout (a91dd11 cleared the payable twice) is superseded with SP_RULES_CHANGED and reported; propose gives the on-ramp funding", () => {
    const { ws, id } = onrampWs();
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const f = o.accounting!.proposals.find((p) => p.ruleCode === "JR_STABLECOIN_ONRAMP_FUNDING" && p.intentId === id)!;
    f.ruleCode = "JR_SUPPLIER_PAYOUT_DEBIT"; f.showsSupplierPaid = true; f.lines[0].accountKey = "supplier_payable";
    for (const l of f.lines) l.ruleCode = "JR_SUPPLIER_PAYOUT_DEBIT";
    f.basisHash = basisOf(f);
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations.map((m) => [m.kind, m.proposalId, m.intentId])).toEqual([["journal_proposal_superseded", f.id, id]]);
    expect(r.value.migrations[0].text).not.toMatch(/No version/);
    expect(proposals(r.value.workspace).find((p) => p.id === f.id)!.supersession!.code).toBe("SP_RULES_CHANGED");
    const after = propose(r.value.workspace).workspace;
    expect(byRule(after, "JR_STABLECOIN_ONRAMP_FUNDING", id).filter((p) => p.status === "proposed").length).toBe(1);
    expect(ledgerProblem(after)).toBeUndefined();
  });
  it("a proposed chain entry that listed a duplicate event (a91dd11, F8) is superseded and proposed again without it", () => {
    const ws = propose(s4Final()).workspace;
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const p = o.accounting!.proposals.find((x) => x.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER")!;
    const dup = { ...structuredClone(o.providerEvents.find((e) => e.id === p.evidence.providerEventIds[0])!), id: "pev_99998", processingOutcome: "duplicate_ignored" as const, dedupeKey: "dup:pev_99998" };
    o.providerEvents.push(dup);
    p.evidence.providerEventIds.push(dup.id);
    for (const l of p.lines) l.evidenceIds.push(dup.id);
    p.basisHash = basisOf(p);
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations.map((m) => m.kind)).toEqual(["journal_proposal_superseded"]);
    const after = propose(r.value.workspace).workspace;
    const fresh = byRule(after, "JR_STABLECOIN_FINAL_TRANSFER").filter((x) => x.status === "proposed");
    expect(fresh.length).toBe(1);
    expect(fresh[0].evidence.providerEventIds).not.toContain("pev_99998");
  });
  it("posted entries are never altered: a91dd11's rejected required reversal (bank debit booked twice) is proposed again and corrects it", () => {
    let { ws, id, ppid } = submitted({ amountMinor: 1_000_000, sandboxOutcome: "return" }, "prv_northline", sampleWorkspace());
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `NORTHLINE PAYOUT ${ppid}`, valueDate: "2026-11-13" }) }).workspace;
    ws = propose(ws).workspace;
    ws = postAll(ws, [byRule(ws, "JR_SUPPLIER_PAYOUT_DEBIT", id)[0].id]);
    ws = run(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }).workspace;
    ws = propose(ws).workspace;
    const o = JSON.parse(serializeWorkspace(ws)) as Workspace;
    const rev = o.accounting!.proposals.find((x) => x.ruleCode === "JR_REVERSAL")!;
    rev.status = "rejected"; rev.rejection = { by: "usr_daniel", at: o.asOf, reason: "dup" }; // what a91dd11 allowed
    const posted = o.accounting!.proposals.filter((x) => x.status === "posted").map((x) => structuredClone(x));
    const r = loadWorkspace(JSON.stringify(o));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.migrations).toEqual([]);
    for (const p of posted) expect(proposals(r.value.workspace).find((x) => x.id === p.id)).toEqual(p);
    const after = propose(r.value.workspace).workspace;
    const again = byRule(after, "JR_REVERSAL").filter((x) => x.status === "proposed");
    expect(again.map((x) => x.reverses)).toEqual([rev.reverses]);
  });
});
