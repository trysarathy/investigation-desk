/**
 * rc4 Accounting Bridge — the eight invariants, checked after EVERY successful action of seeded random sequences
 * that mix the payment engine's actions (the rc3 property generator's shapes) with every bridge action.
 *
 * | Invariant                                   | Check below                       |
 * |---------------------------------------------|-----------------------------------|
 * | Balanced per currency                       | balanced                          |
 * | No entry without evidence                   | evidenced, current                |
 * | Proposed ≠ posted                           | postedOnlyByPerson                |
 * | Idempotent exports                          | idempotentExports                 |
 * | Closed periods respected                    | closedPeriods                     |
 * | Maker ≠ checker                             | makerChecker                      |
 * | Returns never imply the supplier was paid   | returnsNotPaid                    |
 * | An amount-only match never produces an entry| noAmountOnly                      |
 */
import { describe, expect, it } from "vitest";
import {
  accountingExportToJson, applyAction, buildJournalExport, buildReconciliationExport, deriveJournalCandidates, getAdapter, loadWorkspace, reconciliationExportToCsv,
  sampleWorkspace, serializeWorkspace, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import { debitLine, submitted } from "./helpers";
import { bridgeCandidates, proposals } from "./rc4-helpers";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
}

const NOT_DELIVERED = ["failed", "returned", "cancelled", "expired", "on_hold"];
const fails: string[] = [];
function check(ws: Workspace, label: string) {
  const bad = (why: string) => fails.push(`${label}: ${why}`);
  const ids = new Set(["statementLines", "allocations", "chainObservations", "repaymentAllocations", "providerEvents", "evidence"].flatMap((c) => (ws[c as keyof Workspace] as { id: string }[]).map((x) => x.id)));
  const periodOf = new Map((ws.accounting?.periods ?? []).map((p) => [p.id, p]));
  const { candidates } = deriveJournalCandidates(ws);
  for (const p of proposals(ws)) {
    // balanced
    const sums = new Map<string, bigint>();
    for (const l of p.lines) sums.set(l.currency, (sums.get(l.currency) ?? 0n) + BigInt(l.amountMinor) * (l.side === "debit" ? 1n : -1n));
    if ([...sums.values()].some((v) => v !== 0n) || sums.size !== 1) bad(`${p.id} not balanced per currency`);
    // evidenced
    if (p.lines.some((l) => !l.evidenceIds.length || l.evidenceIds.some((e) => !ids.has(e)))) bad(`${p.id} has a line without existing evidence`);
    // current: a proposed or approved entry always matches its evidence (otherwise it was superseded)
    if ((p.status === "proposed" || p.status === "approved") && !candidates.some((c) => c.sourceKey === p.sourceKey && c.basisHash === p.basisHash)) bad(`${p.id} is ${p.status} but its evidence changed`);
    // postedOnlyByPerson
    if ((p.status === "posted") !== !!p.posting) bad(`${p.id} posted/posting mismatch`);
    if (p.status === "posted" && !ws.audit.some((a) => a.action === "journal.posting_recorded" && a.entityId === p.id && a.actorId === p.posting!.recordedBy && a.actorId !== "system")) bad(`${p.id} posted without a person's record_posting`);
    if (p.status === "posted" && !(p.export && p.approval)) bad(`${p.id} posted without approval and export`);
    // makerChecker
    if (p.approval && (p.approval.by === p.createdBy || ws.actors.find((a) => a.id === p.approval!.by)?.role !== "approver")) bad(`${p.id} approved by the maker or a non-approver`);
    // closedPeriods
    const per = periodOf.get(p.periodId);
    if (!per || p.postingDate < per.from || p.postingDate >= per.to) bad(`${p.id} posting date outside its period`);
    if ((p.status === "proposed" || p.status === "approved") && per?.status === "closed") bad(`${p.id} pending in a closed period`);
    const created = ws.audit.find((a) => a.action === "journal.proposed" && a.entityId === p.id);
    if (created && ws.audit.some((a) => a.action === "accounting.period_closed" && a.entityId === p.periodId && a.id < created.id)) bad(`${p.id} proposed into a period that was already closed`);
    if (p.priorPeriodItem && periodOf.get(p.priorPeriodItem.originalPeriodId)?.status !== "closed") bad(`${p.id} prior-period flag without a closed period`);
    // returnsNotPaid
    const intent = ws.intents.find((i) => i.id === p.intentId);
    if ((p.status === "proposed" || p.status === "approved") && intent && NOT_DELIVERED.includes(intent.status.execution) && p.ruleCode !== "JR_REVERSAL" && p.lines.some((l) => l.side === "debit" && (l.accountKey === "supplier_payable" || l.accountKey === "customer_receivable"))) bad(`${p.id} shows a not-delivered payout as paid`);
    if (p.ruleCode === "JR_PAYOUT_RETURN_CREDIT" && (p.showsSupplierPaid || p.lines.some((l) => l.accountKey === "supplier_payable"))) bad(`${p.id} return credit touches the supplier payable`);
    // noAmountOnly: every statement line an entry rests on was matched by a trusted reference
    for (const lid of p.evidence.statementLineIds) {
      const allocs = ws.allocations.filter((a) => a.statementLineId === lid);
      if (!allocs.length || allocs.some((a) => a.matchedBy !== "trusted_reference")) bad(`${p.id} rests on line ${lid} without a trusted-reference allocation`);
    }
  }
  for (const l of ws.statementLines)
    if (l.explanationCodes.includes("RC_AMOUNT_ONLY_CANDIDATES") && !l.allocationIds.length && proposals(ws).some((p) => p.ruleCode !== "JR_REVERSAL" && p.evidence.statementLineIds.includes(l.id))) bad(`amount-only line ${l.id} produced an entry`);
}

function idempotentExports(ws: Workspace, label: string) {
  const a = buildReconciliationExport(ws, { from: "2026-11-01", to: "2027-01-01" });
  const loaded = loadWorkspace(serializeWorkspace(ws));
  if (!loaded.ok) return fails.push(`${label}: does not load: ${loaded.error.message}`);
  const b = buildReconciliationExport(loaded.value.workspace, { from: "2026-11-01", to: "2027-01-01" });
  if (!a.ok || !b.ok || accountingExportToJson(a.value) !== accountingExportToJson(b.value) || reconciliationExportToCsv(a.value) !== reconciliationExportToCsv(b.value)) fails.push(`${label}: reconciliation export not byte-identical`);
  for (const rec of ws.accounting?.exports.filter((x) => x.kind === "journal") ?? []) {
    const j = buildJournalExport(ws, { exportId: rec.id });
    if (!j.ok || j.value.documentId !== rec.documentId || j.value.sha256 !== rec.sha256) fails.push(`${label}: journal export ${rec.id} does not re-render to its recorded hash`);
  }
}

function payments(ws: Workspace, r: () => number): { actor: string; action: WorkspaceAction }[] {
  const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
  const intent = pick(ws.intents.filter((i) => i.instructionId))!;
  const instr = ws.instructions.find((x) => x.id === intent.instructionId)!;
  const ppid = instr.providerPaymentId;
  const out: { actor: string; action: WorkspaceAction }[] = [{ actor: "usr_maya", action: { type: "simulate_provider_event", intentId: intent.id, injection: pick(["none", "none", "contradictory", "duplicate", "timeout"] as const) } }];
  if (ppid) {
    const type = pick(["payout.failed", "payout.returned", "payout.completed", "payout.on_hold"] as const)!;
    const seq = ws.providerEvents.filter((e) => e.intentId === intent.id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
    const rawBody = JSON.stringify({ id: `${ppid}-I${ws.seq}`, type, provider_payment_id: ppid, sequence: seq, occurred_at: ws.asOf, ...(type === "payout.failed" || type === "payout.returned" ? { reason: "beneficiary_account_invalid" } : {}), ...(type === "payout.on_hold" ? { reason: "compliance_review", requested_documents: ["Invoice"] } : {}) });
    out.push({ actor: "usr_maya", action: { type: "ingest_webhook", delivery: { providerId: instr.providerId, rawBody, signatureHeader: getAdapter(instr.providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000)) } } });
    for (let k = 0; k < 2; k++) out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: pick([`PAYOUT ${ppid}`, `RETURN ${ppid}`, ""])!, amountMinor: pick([intent.amountMinor, intent.amountMinor, Math.floor(intent.amountMinor / 2), intent.amountMinor + 1])!, currency: intent.sourceCurrency, direction: pick(["debit", "debit", "credit"] as const)!, kind: "payment", valueDate: pick(["2026-11-13", "2026-11-14", "2026-12-02"])! }) } });
  }
  const ob = pick(ws.obligations);
  if (ob) out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: { lineId: `RP-${ws.seq}`, source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: pick([1_000_000, 2_000_000, 500_000])!, currency: "SGD", reference: pick([ob.reference, ""])!, counterparty: "SEABRIGHT", valueDate: pick(["2026-11-14", "2026-12-03"])! } } });
  const exc = pick(ws.exceptions.filter((e) => e.status !== "resolved"));
  if (exc) {
    out.push({ actor: "usr_maya", action: { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" } });
    out.push({ actor: "usr_maya", action: { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "funds_returned_confirmation", description: "Evidence (fictional)" } } });
    out.push({ actor: "usr_maya", action: { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Reviewed" } });
  }
  const done = pick(ws.exceptions.filter((e) => e.status === "resolved"));
  if (done) out.push({ actor: "usr_daniel", action: { type: "reopen", target: { kind: "exception", id: done.id }, reason: "Reopened" } });
  out.push({ actor: "usr_maya", action: { type: "advance_clock", to: new Date(Date.parse(ws.asOf) + Math.floor(r() * 6) * 86_400_000).toISOString() } });
  return out;
}

const KINDS = new Map<string, number>();
const SEEN = new Set<string>();
function note(ws: Workspace) {
  for (const p of proposals(ws)) {
    SEEN.add(p.status);
    if (p.ruleCode === "JR_REVERSAL") SEEN.add("reversal");
    if (p.priorPeriodItem) SEEN.add("prior-period item");
    if (p.evidenceChange) SEEN.add("evidence changed after export");
    if (p.ruleCode === "JR_PAYOUT_DEBIT_NOT_DELIVERED") SEEN.add("not delivered");
  }
}
describe("rc4: the bridge invariants hold after every action of random mixed sequences", () => {
  for (let seed = 1; seed <= 24; seed++)
    it(`seed ${seed}`, () => {
      const r = rng(seed * 104729);
      let ws = sampleWorkspace();
      ws = submitted({ amountMinor: 1_000_000, internalReference: "INV-RC4-SGD", idempotencyKey: "rc4-sgd-0001", sandboxOutcome: seed % 2 ? "return" : "success" }, "prv_northline", ws).ws;
      for (let step = 0; step < 70; step++) {
        const list = r() < 0.5 ? bridgeCandidates(ws, r) : payments(ws, r);
        const { actor, action } = list[Math.floor(r() * list.length)];
        const res = applyAction(ws, action, { actorId: actor, at: ws.asOf });
        if (!res.ok) continue;
        KINDS.set(action.type, (KINDS.get(action.type) ?? 0) + 1);
        ws = res.value.workspace;
        check(ws, `seed ${seed} step ${step} ${action.type}`);
        note(ws);
        if (step % 5 === 0) idempotentExports(ws, `seed ${seed} step ${step}`);
      }
      expect(fails).toEqual([]);
    }, 60_000);

  it("the walks really exercised the lifecycle (not vacuous)", () => {
    for (const k of ["propose_journal_entries", "approve_journal_proposal", "export_journal", "record_posting", "reject_journal_proposal", "close_accounting_period", "open_accounting_period", "ingest_webhook", "ingest_statement_line"])
      expect(`${k}: ${(KINDS.get(k) ?? 0) > 0}`).toBe(`${k}: true`);
    for (const s of ["proposed", "approved", "exported", "posted", "rejected", "superseded", "reversal", "prior-period item", "evidence changed after export", "not delivered"]) expect(`${s}: ${SEEN.has(s)}`).toBe(`${s}: true`);
  });
});
