/**
 * Independent QA, release candidate 4 (2c0f0f0): Accounting Bridge, adversarial.
 * Tests named "DEFECT (...)" assert the correct behaviour and FAIL on 2c0f0f0 (see QA_SECURITY_REVIEW_RC4.md);
 * every other test passes on 2c0f0f0 and pins an invariant I attacked and saw hold.
 */
import { describe, expect, it } from "vitest";
import {
  applyAction, buildJournalExport, buildReconciliationExport, journalExportToCsv, reconciliationExportToCsv, accountingExportToJson,
  parseWorkspaceValue, resetScenario, sampleWorkspace, scenarioIntentId, isBalanced, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import { run, signedDelivery } from "../clearline/helpers";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const tryAct = (ws: Workspace, actor: string, action: WorkspaceAction) => applyAction(ws, action, { actorId: actor, at: ws.asOf });
const ok = (ws: Workspace, actor: string, action: WorkspaceAction) => run(ws, actor, action).workspace;
const props = (ws: Workspace) => ws.accounting!.proposals;
const per = (ws: Workspace) => ws.accounting!.periods.find((p) => p.status === "open")!.id;
const loads = (ws: Workspace) => parseWorkspaceValue(clone(ws));
const S = (ws: Workspace, s: string) => scenarioIntentId(ws, s)!;
const supplierPaid = (ws: Workspace, intentId: string) =>
  props(ws).filter((p) => p.intentId === intentId && ["proposed", "approved", "exported", "posted"].includes(p.status))
    .reduce((t, p) => t + p.lines.filter((l) => l.accountKey === "supplier_payable").reduce((s, l) => s + (l.side === "debit" ? l.amountMinor : -l.amountMinor), 0), 0);

/** s1's supplier-payout entry approved by usr_daniel and exported by usr_maya. */
function exportedS1(): { ws: Workspace; id: string } {
  const ws0 = sampleWorkspace();
  const id = props(ws0).find((p) => p.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!.id;
  let ws = ok(ws0, "usr_daniel", { type: "approve_journal_proposal", proposalId: id });
  ws = ok(ws, "usr_maya", { type: "export_journal", periodId: per(ws) });
  return { ws, id };
}

describe("QA rc4: accounting invariants that hold on 2c0f0f0", () => {
  it("every sample proposal balances per currency; nothing is proposed for provider-only, amount-only, hold or pending-chain evidence", () => {
    const ws = sampleWorkspace();
    for (const p of props(ws)) expect(isBalanced(p.lines), p.id).toBe(true);
    const lines = new Set(props(ws).flatMap((p) => p.evidence.statementLineIds));
    const unrelated = ws.statementLines.find((l) => l.direction === "credit" && l.amountMinor === 2_000_000 && !l.reference)!;
    expect(lines.has(unrelated.id)).toBe(false);
    for (const s of ["s3_hold", "s4_chain"]) expect(props(ws).filter((p) => p.intentId === S(ws, s))).toEqual([]);
    expect(supplierPaid(ws, S(ws, "s2_returned"))).toBe(0);
  });

  it("a provider completion alone or a provider settlement report gives no entry", () => {
    let ws = sampleWorkspace();
    const before = props(ws).length;
    const r = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-QA4-1", amountMinor: 100_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-QA4", beneficiaryName: "QA Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20", idempotencyKey: "qa4-acct-key-1" } });
    ws = r.workspace; const id = r.createdIds[0];
    ws = ok(ws, "usr_maya", { type: "request_quotes", intentId: id });
    const q = ws.quotes.find((x) => x.intentId === id && x.providerId === "prv_northline" && x.eligible)!;
    const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
    ws = ok(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] });
    ws = ok(ws, "usr_maya", { type: "submit_instruction", instructionId: c.createdIds[0] });
    for (let k = 0; k < 3; k++) { const s = tryAct(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }); if (s.ok) ws = s.value.workspace; }
    const ppid = ws.instructions.find((x) => x.id === c.createdIds[0])!.providerPaymentId!;
    ws = ok(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "PR-QA4", source: "provider_settlement_report", accountRef: "NL-REPORT", direction: "debit", kind: "payment", amountMinor: 100_000, currency: "SGD", reference: ppid, counterparty: "Northline", valueDate: "2026-11-13" } });
    ws = ok(ws, "usr_maya", { type: "propose_journal_entries" });
    expect(props(ws).filter((p) => p.intentId === id)).toEqual([]);
    expect(props(ws).length).toBe(before);
  });

  it("stablecoin route: one final transfer clears the supplier payable once", () => {
    let ws = sampleWorkspace();
    const id = S(ws, "s4_chain");
    ws = ok(ws, "usr_maya", { type: "simulate_provider_event", intentId: id });
    ws = ok(ws, "usr_maya", { type: "propose_journal_entries" });
    const mine = props(ws).filter((p) => p.intentId === id && p.status === "proposed");
    expect(mine.map((p) => p.ruleCode)).toContain("JR_STABLECOIN_FINAL_TRANSFER");
    // The payable is cleared by the final transfer's own amount (the quoted recipient amount), once.
    const obs = ws.chainObservations.find((o) => o.intentId === id && o.status === "final")!;
    expect(supplierPaid(ws, id)).toBe(obs.amountMinor);
    const again = tryAct(ws, "usr_maya", { type: "propose_journal_entries" });
    expect(again.ok && supplierPaid(again.value.workspace, id)).toBe(obs.amountMinor);
  });

  it("maker ≠ checker on approve, withdraw-exported and confirm-not-imported; posted only via record_posting after export", () => {
    const ws0 = sampleWorkspace();
    const id = props(ws0).find((p) => p.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!.id;
    expect(tryAct(ws0, "usr_maya", { type: "approve_journal_proposal", proposalId: id }).ok).toBe(false);
    expect(tryAct(ws0, "usr_sam", { type: "approve_journal_proposal", proposalId: id }).ok).toBe(false);
    let ws = ok(ws0, "usr_daniel", { type: "approve_journal_proposal", proposalId: id });
    expect(tryAct(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: "JE-1" }).ok).toBe(false);
    ws = ok(ws, "usr_daniel", { type: "export_journal", periodId: per(ws) });
    expect(tryAct(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: id, reason: "x" }).ok).toBe(false);
    expect(tryAct(ws, "usr_daniel", { type: "confirm_not_imported", proposalId: id, note: "checked" }).ok).toBe(false);
    expect(tryAct(ws, "usr_lin", { type: "confirm_not_imported", proposalId: id, note: "checked with the ledger" }).ok).toBe(true);
    for (const ref of ["=1+1", "+1", "@x", "-1", "JE 1", "<b>"]) expect(tryAct(ws, "usr_maya", { type: "record_posting", proposalId: id, externalReference: ref }).ok, ref).toBe(false);
  });

  it("exports are deterministic: same workspace → byte-identical CSV/JSON and the same documentId; a recorded export re-renders from its record", () => {
    const { ws } = exportedS1();
    const a = buildJournalExport(ws, { exportId: ws.accounting!.exports[0].id });
    const b = buildJournalExport(clone(ws), { exportId: ws.accounting!.exports[0].id });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(journalExportToCsv(a.value)).toBe(journalExportToCsv(b.value));
    expect(a.value.documentId).toBe(b.value.documentId);
    const exp = ws.accounting!.exports[0];
    const re = buildJournalExport(ws, { exportId: exp.id });
    expect(re.ok).toBe(true);
    if (re.ok) expect(re.value.documentId).toBe(exp.documentId);
    const r1 = buildReconciliationExport(ws, { from: "2026-11-01", to: "2026-12-01" });
    const r2 = buildReconciliationExport(clone(ws), { from: "2026-11-01", to: "2026-12-01" });
    expect(r1.ok && r2.ok && reconciliationExportToCsv(r1.value) === reconciliationExportToCsv(r2.value)).toBe(true);
    expect(r1.ok && r2.ok && accountingExportToJson(r1.value) === accountingExportToJson(r2.value)).toBe(true);
  });

  it("CSV injection: a formula-like account name in the mapping is neutralised in the journal CSV", () => {
    let ws = sampleWorkspace();
    const entries = ws.accounting!.mapping!.entries.map((e) => e.accountKey === "supplier_payable" ? { ...e, accountName: "+SUM(A1) payables" } : e);
    ws = ok(ws, "usr_maya", { type: "set_account_mapping", entries, expectedRevision: ws.accounting!.mapping!.revision });
    const id = props(ws).find((p) => p.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!.id;
    ws = ok(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: id });
    ws = ok(ws, "usr_maya", { type: "export_journal", periodId: per(ws) });
    const doc = buildJournalExport(ws, { exportId: ws.accounting!.exports[0].id });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const csv = journalExportToCsv(doc.value);
    expect(csv).toContain("'+SUM(A1) payables");
    for (const cell of csv.split(/\r\n/).flatMap((l) => l.split(","))) expect(/^"?[=+@\t\r]/.test(cell), cell).toBe(false);
  });
});

describe("QA rc4: reconciliation export CSV injection", () => {
  it("formula-leading statement references and counterparties are neutralised in the reconciliation CSV", () => {
    let ws = sampleWorkspace();
    const payloads = ["=HYPERLINK(\"http://example.invalid\",\"x\")", "+SUM(1)", "-1+1", "@cmd", "\t=1"];
    let n = 0;
    for (const p of payloads) {
      const r = tryAct(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: `QA4-CSV-${++n}`, source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 12_345 + n, currency: "SGD", reference: p, counterparty: "Payer (fictional)", valueDate: "2026-11-13" } });
      if (r.ok) ws = r.value.workspace;
    }
    const doc = buildReconciliationExport(ws, { from: "2026-11-01", to: "2026-12-01" });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    const csv = reconciliationExportToCsv(doc.value);
    const hits = csv.split("\r\n").filter((l) => l.includes("QA4-CSV"));
    expect(hits.length).toBeGreaterThan(0);
    for (const l of hits) for (const cell of l.split(",")) expect(/^"?[=+@\t]|^"?-[^0-9]|^"?-1\+/.test(cell), cell).toBe(false);
  });
});

describe("QA rc4: a returned payout after its entry was posted", () => {
  it("s1 posted, then the provider reports it returned: the reversal cannot be rejected, and once everything is posted the supplier is not shown paid", () => {
    const { ws: w0, id } = exportedS1();
    let ws = ok(w0, "usr_sam", { type: "record_posting", proposalId: id, externalReference: "JE-S1" });
    const intentId = props(ws).find((p) => p.id === id)!.intentId!;
    const ins = ws.instructions.find((x) => x.id === ws.intents.find((i) => i.id === intentId)!.instructionId)!;
    const ppid = ins.providerPaymentId!;
    const r = tryAct(ws, "usr_maya", { type: "ingest_webhook", delivery: signedDelivery(ws, ins.providerId, { id: `${ppid}-QA4R`, type: "payout.returned", provider_payment_id: ppid, sequence: 50, occurred_at: ws.asOf, reason: "beneficiary_account_invalid" }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    ws = ok(r.value.workspace, "usr_maya", { type: "propose_journal_entries" });
    const rev = props(ws).find((p) => p.ruleCode === "JR_REVERSAL" && p.status === "proposed")!;
    expect(rev).toBeDefined();
    expect(tryAct(ws, "usr_daniel", { type: "reject_journal_proposal", proposalId: rev.id, reason: "not needed" }).ok).toBe(false);
    const rebook = props(ws).find((p) => p.status === "proposed" && p.ruleCode === "JR_PAYOUT_DEBIT_NOT_DELIVERED" && p.intentId === intentId);
    if (rebook) expect(tryAct(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: rebook.id }).ok).toBe(false); // REVERSAL_FIRST
    for (const p of props(ws).filter((x) => x.status === "proposed" && x.intentId === intentId).sort((a) => (a.ruleCode === "JR_REVERSAL" ? -1 : 1)))
      ws = ok(ws, "usr_daniel", { type: "approve_journal_proposal", proposalId: p.id });
    ws = ok(ws, "usr_maya", { type: "export_journal", periodId: per(ws) });
    for (const p of props(ws).filter((x) => x.status === "exported" && x.intentId === intentId)) ws = ok(ws, "usr_sam", { type: "record_posting", proposalId: p.id, externalReference: `JE-${p.id}` });
    expect(supplierPaid(ws, intentId)).toBe(0);
  });
});

/** The s5 unrelated SGD 20,000 receipt (no reference) forged into a repayment allocation of the s5 obligation. */
function forgedRepayment(): { ws: Workspace; lineId: string } {
  const ws = clone(sampleWorkspace());
  const line = ws.statementLines.find((l) => l.direction === "credit" && l.amountMinor === 2_000_000 && !l.reference)!;
  const existing = ws.allocations.find((a) => a.target.kind === "repayment")!;
  ws.allocations.push({ ...existing, id: "alc_99991", statementLineId: line.id, amountMinor: 2_000_000 });
  line.allocationIds = ["alc_99991"]; line.status = "allocated";
  ws.repaymentAllocations.push({ ...ws.repaymentAllocations[0], id: "ra_99992", statementLineId: line.id, amountMinor: 2_000_000 });
  for (const e of ws.exceptions.filter((x) => x.statementLineId === line.id)) Object.assign(e, { status: "resolved", ownerId: "usr_maya", resolution: { at: ws.asOf, actorId: "usr_maya", note: "forged" } });
  return { ws, lineId: line.id };
}

/** A bank debit with no provider payment id forged into an allocation of a fresh live payout. */
function forgedPayoutDebit(): { ws: Workspace; intentId: string; lineId: string } | undefined {
  let ws = sampleWorkspace();
  const r = run(ws, "usr_maya", { type: "create_intent", input: { internalReference: "INV-QA4-F", amountMinor: 700_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-QA4", beneficiaryName: "QA Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20", idempotencyKey: "qa4-forge-key-1" } });
  ws = r.workspace; const id = r.createdIds[0];
  ws = ok(ws, "usr_maya", { type: "request_quotes", intentId: id });
  const q = ws.quotes.find((x) => x.intentId === id && x.providerId === "prv_northline" && x.eligible)!;
  const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
  ws = ok(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] });
  ws = ok(ws, "usr_maya", { type: "submit_instruction", instructionId: c.createdIds[0] });
  const li = run(ws, "usr_maya", { type: "ingest_statement_line", line: { lineId: "QA4-NOREF", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "debit", kind: "payment", amountMinor: 700_000, currency: "SGD", reference: "", counterparty: "Northline", valueDate: "2026-11-13" } });
  const f = clone(li.workspace);
  const lineId = li.createdIds[0];
  const line = f.statementLines.find((l) => l.id === lineId)!;
  const tmpl = f.allocations.find((a) => a.target.kind === "payment" && a.evidenceKind === "statement_line")!;
  f.allocations.push({ ...tmpl, id: "alc_99993", statementLineId: lineId, target: { kind: "payment", intentId: id }, amountMinor: 700_000 });
  line.allocationIds = ["alc_99993"]; line.status = "allocated";
  for (const e of f.exceptions.filter((x) => x.statementLineId === lineId)) Object.assign(e, { status: "resolved", ownerId: "usr_maya", resolution: { at: f.asOf, actorId: "usr_maya", note: "forged" } });
  return { ws: f, intentId: id, lineId };
}

describe("QA rc4: forged evidence (allocations) in a stored or posted workspace", () => {
  it("DEFECT (Medium) M1: an unreferenced SGD 20,000 receipt forged into a repayment allocation loads, closes the advance and is proposed as JR_REPAYMENT_BY_REFERENCE", () => {
    const { ws, lineId } = forgedRepayment();
    const r = loads(ws);
    // Correct: refused on load (the allocation is not by the obligation's reference) — or at least never proposed.
    if (!r.ok) return;
    const p = tryAct(r.value, "usr_maya", { type: "propose_journal_entries" });
    const made = p.ok ? props(p.value.workspace).filter((x) => x.evidence.statementLineIds.includes(lineId)) : [];
    expect(made.map((x) => x.ruleCode)).toEqual([]);
  });

  it("DEFECT (Medium) M1b: a chain observation marked 'final' with 6 of 12 confirmations, plus an allocation, loads and is proposed as the supplier-paying stablecoin entry", () => {
    const ws = clone(sampleWorkspace());
    const o = ws.chainObservations[0];
    expect(o.confirmations).toBeLessThan(12);
    o.status = "final";
    const t = ws.allocations[0];
    ws.allocations.push({ ...t, id: "alc_99995", evidenceKind: "chain_observation", statementLineId: o.id, target: { kind: "payment", intentId: o.intentId }, amountMinor: o.amountMinor, currency: "USDC", codes: [] } as never);
    const r = loads(ws);
    if (!r.ok) return; // correct: refused
    expect(r.value.chainObservations[0].status).not.toBe("final");
    const p = tryAct(r.value, "usr_maya", { type: "propose_journal_entries" });
    expect(p.ok ? props(p.value.workspace).filter((x) => x.intentId === o.intentId).map((x) => x.ruleCode) : []).toEqual([]);
  });

  it("holds: an unreferenced bank debit forged into a payout allocation is refused on load (contrast with M1)", () => {
    const f = forgedPayoutDebit()!;
    const r = loads(f.ws);
    expect(r.ok).toBe(false);
    if (!r.ok) return;
    let ws = r.value;
    const p = tryAct(ws, "usr_maya", { type: "propose_journal_entries" });
    const made = p.ok ? props(p.value.workspace).filter((x) => x.evidence.statementLineIds.includes(f.lineId)) : [];
    expect(made.filter((x) => x.lines.some((l) => l.accountKey === "supplier_payable" && l.side === "debit"))).toEqual([]);
  });
});

describe("QA rc4: forged workspaces against the bridge", () => {
  it("an invented amount on a proposed entry is not exportable (refused or superseded on load)", () => {
    const ws = clone(sampleWorkspace());
    const p = props(ws).find((x) => x.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!;
    for (const l of p.lines) l.amountMinor = 99_999_999;
    const r = loads(ws);
    if (r.ok) {
      const q = props(r.value).find((x) => x.id === p.id)!;
      expect(q.status === "superseded" || q.lines.every((l) => l.amountMinor !== 99_999_999)).toBe(true);
    } else expect(r.ok).toBe(false);
  });

  it("a forged exported entry with an invented amount is refused on load", () => {
    const { ws, id } = exportedS1();
    const f = clone(ws);
    for (const l of props(f).find((x) => x.id === id)!.lines) l.amountMinor += 1;
    expect(loads(f).ok).toBe(false);
  });

  it("a forged approval by the proposer, by a viewer or by an unknown id is refused on load", () => {
    for (const by of ["usr_maya", "usr_alex", "usr_ghost"]) {
      const ws = clone(sampleWorkspace());
      const p = props(ws).find((x) => x.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!;
      p.status = "approved";
      p.approval = { by, at: ws.asOf, mappingRevision: ws.accounting!.mapping!.revision, accounts: ws.accounting!.mapping!.entries.filter((e) => p.lines.some((l) => l.accountKey === e.accountKey)) };
      p.history.push({ at: ws.asOf, actorId: by, action: "approved", detail: "forged" } as never);
      expect(loads(ws).ok, by).toBe(false);
    }
  });

  it("a forged 'posted' entry that was never exported is refused on load", () => {
    const ws = clone(sampleWorkspace());
    const p = props(ws).find((x) => x.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!;
    p.status = "posted";
    p.posting = { externalReference: "JE-FORGED", recordedBy: "usr_maya", recordedAt: ws.asOf, simulated: true };
    expect(loads(ws).ok).toBe(false);
  });

  it("a forged proposal for the pending-finality s4 transfer is refused or superseded", () => {
    const ws0 = sampleWorkspace();
    const fin = ok(ws0, "usr_maya", { type: "simulate_provider_event", intentId: S(ws0, "s4_chain") });
    const proposed = ok(fin, "usr_maya", { type: "propose_journal_entries" });
    const forged = clone(ws0);
    const p = clone(props(proposed).find((x) => x.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER")!);
    forged.accounting!.proposals.push(p);
    forged.seq = Math.max(forged.seq, proposed.seq);
    const r = loads(forged);
    expect(!r.ok || props(r.value).find((x) => x.id === p.id)!.status === "superseded").toBe(true);
  });

  it("forged bridge records are refused on load: duplicate account codes, overlapping periods, a pending entry in a closed period, an export naming an unknown entry", () => {
    const dup = clone(sampleWorkspace());
    dup.accounting!.mapping!.entries[1].accountCode = dup.accounting!.mapping!.entries[0].accountCode;
    expect(loads(dup).ok).toBe(false);
    const overlap = clone(sampleWorkspace());
    overlap.accounting!.periods.push({ ...overlap.accounting!.periods[0], id: "per_99990", name: "dup", from: "2026-11-15", to: "2026-12-15" });
    expect(loads(overlap).ok).toBe(false);
    const closed = clone(sampleWorkspace());
    Object.assign(closed.accounting!.periods[0], { status: "closed", closedBy: "usr_daniel", closedAt: closed.asOf });
    expect(loads(closed).ok).toBe(false);
    const { ws } = exportedS1();
    const ex = clone(ws);
    ex.accounting!.exports[0].proposalIds!.push("jp_99999");
    expect(loads(ex).ok).toBe(false);
  });

  it("a per-case reset is refused once that case's entry has been exported", () => {
    const { ws } = exportedS1();
    const r = resetScenario(ws, "s1_success", { actorId: "usr_maya", at: ws.asOf });
    expect(r.ok).toBe(false);
  });

  it("documented limit: approver identity is not authenticated — the caller chooses the actor id", () => {
    const ws0 = sampleWorkspace();
    const id = props(ws0).find((p) => p.ruleCode === "JR_SUPPLIER_PAYOUT_DEBIT")!.id;
    // The same caller can act as maya (proposer) and then as daniel (approver): the rule is a workflow rule.
    expect(tryAct(ws0, "usr_daniel", { type: "approve_journal_proposal", proposalId: id }).ok).toBe(true);
  });
});
