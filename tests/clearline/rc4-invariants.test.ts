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
 * | Net payable per payout ≤ payout, once (F1)  | netPerPayout (ledgerProblem)      |
 * | No bank line booked twice (F5)              | netPerPayout (ledgerProblem)      |
 * | A debit is never booked as cash in (F2)     | debitNotCashIn                    |
 *
 * Review widening: return and reversal lines in both directions, stablecoin payouts (SGD→USDC and USDC→USDC) with
 * bank debits and chain finality, per-case resets after exports, rejected reversals and early rebooking approvals.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_TOKENS, SAMPLE_SCENARIOS, accountingExportToJson, applyAction, buildJournalExport, buildReconciliationExport, deriveJournalCandidates, getAdapter, journalExportToCsv,
  ledgerProblem, loadWorkspace, reconciliationExportToCsv, resetScenario, sampleWorkspace, serializeWorkspace, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import { sha256Hex } from "@/lib/clearline/sha256";
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
  // netPerPayout: the payable / receivable per payout and every bank line are booked at most once (review F1 / F5)
  const lp = ledgerProblem(ws);
  if (lp) bad(lp);
  // debitNotCashIn: a bank line's own side in an entry is always opposite to the money's direction (review F2)
  for (const p of proposals(ws)) for (const lid of p.evidence.statementLineIds) {
    const line = ws.statementLines.find((x) => x.id === lid)!;
    const bankLines = p.lines.filter((l) => l.accountKey.startsWith("bank:"));
    const expected = (line.direction === "debit") !== (p.ruleCode === "JR_REVERSAL") ? "credit" : "debit";
    if (bankLines.some((l) => l.side !== expected)) bad(`${p.id} books ${line.direction} line ${lid} on the wrong bank side`);
  }
  // a returned payout shown as paid in the ledger always has a correcting reversal pending or done
  for (const i of ws.intents.filter((x) => NOT_DELIVERED.includes(x.status.execution))) {
    const inLedger = proposals(ws).filter((p) => p.intentId === i.id && (p.status === "posted" || p.status === "exported") && p.ruleCode !== "JR_REVERSAL" && p.showsSupplierPaid);
    for (const p of inLedger)
      if (!proposals(ws).some((q) => q.reverses === p.id && q.status !== "superseded") && !candidates.some((c) => c.reverses === p.id)) bad(`${p.id} shows not-delivered ${i.id} paid with no reversal`);
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
    if (!j.ok || j.value.documentId !== rec.documentId || j.value.sha256 !== rec.sha256 || sha256Hex(journalExportToCsv(j.value)) !== rec.fileSha256?.csv || sha256Hex(accountingExportToJson(j.value)) !== rec.fileSha256?.json) fails.push(`${label}: journal export ${rec.id} does not re-render to its recorded hashes`);
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
  if (ppid) {
    // return and reversal lines in both directions (a debit "reversal" must never be cash in)
    out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: debitLine({ accountRef: "BANK-SGD-OPS (fictional)", reference: `RETURN ${ppid}`, amountMinor: intent.amountMinor, currency: intent.sourceCurrency, direction: pick(["credit", "debit"] as const)!, kind: pick(["return", "reversal"] as const)!, valueDate: "2026-11-14" }) } });
  }
  if (intent.destinationCurrency === "USDC" && instr.providerId === "prv_tidewater") {
    // stablecoin payouts: the bank (or custody) debit funding the on-ramp, then the chain transfer to finality
    out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: debitLine({ accountRef: intent.sourceCurrency === "USDC" ? "CUSTODY-USDC (fictional)" : "BANK-SGD-OPS (fictional)", reference: `PAYOUT ${ppid}`, amountMinor: intent.amountMinor, currency: intent.sourceCurrency, valueDate: "2026-11-13" }) } });
    for (let k = 0; k < 2; k++) out.push({ actor: "usr_maya", action: { type: "simulate_provider_event", intentId: intent.id } });
    const o = ws.chainObservations.find((x) => x.intentId === intent.id && x.status !== "rejected_unsupported");
    if (o && r() < 0.3) out.push({ actor: "usr_maya", action: { type: "ingest_chain_observation", observation: { intentId: intent.id, chainId: o.chainId, network: o.network, tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: o.tokenSymbol, txHash: o.txHash, toAddress: o.toAddress, amountMinor: o.amountMinor, blockNumber: o.blockNumber, confirmations: pick([3, 13, 20])! } } });
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
    if (p.ruleCode === "JR_STABLECOIN_ONRAMP_FUNDING") SEEN.add("on-ramp funding");
    if (p.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER") SEEN.add("stablecoin final");
    if (p.ruleCode === "JR_PAYOUT_RETURN_CREDIT") SEEN.add("return credit");
    if (p.status === "rejected" && p.export) SEEN.add("withdrawn after export");
  }
  if (ws.statementLines.some((l) => l.explanationCodes.includes("RC_RETURN_LINE_IS_DEBIT"))) SEEN.add("debit return line");
}
describe("rc4: the bridge invariants hold after every action of random mixed sequences", () => {
  for (let seed = 1; seed <= 24; seed++)
    it(`seed ${seed}`, () => {
      const r = rng(seed * 104729);
      let ws = sampleWorkspace();
      ws = submitted({ amountMinor: 1_000_000, internalReference: "INV-RC4-SGD", idempotencyKey: "rc4-sgd-0001", sandboxOutcome: seed % 2 ? "return" : "success" }, "prv_northline", ws).ws;
      ws = submitted({ amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "USDC", destinationCountry: "SG", internalReference: "INV-RC4-ONRAMP", idempotencyKey: "rc4-onramp-0001", sandboxOutcome: seed % 3 ? "success" : "return" }, "prv_tidewater", ws).ws;
      for (let step = 0; step < 70; step++) {
        if (r() < 0.04) {
          // per-case reset (also after exports): refused when the case's entries were exported; otherwise ids never reused
          const sc = Object.keys(SAMPLE_SCENARIOS)[Math.floor(r() * 5)];
          const rs = resetScenario(ws, sc, { actorId: "usr_maya", at: ws.asOf });
          if (rs.ok) { ws = rs.value.workspace; KINDS.set("reset", (KINDS.get("reset") ?? 0) + 1); check(ws, `seed ${seed} step ${step} reset ${sc}`); idempotentExports(ws, `seed ${seed} step ${step} reset`); }
          else if (/ACCOUNTING_ENTRIES_RECORDED/.test(rs.error.message)) KINDS.set("reset refused (entries exported)", (KINDS.get("reset refused (entries exported)") ?? 0) + 1);
          continue;
        }
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
    for (const k of ["propose_journal_entries", "approve_journal_proposal", "export_journal", "record_posting", "reject_journal_proposal", "close_accounting_period", "open_accounting_period", "ingest_webhook", "ingest_statement_line", "reset", "reset refused (entries exported)"])
      expect(`${k}: ${(KINDS.get(k) ?? 0) > 0}`).toBe(`${k}: true`);
    for (const s of ["proposed", "approved", "exported", "posted", "rejected", "superseded", "reversal", "prior-period item", "evidence changed after export", "not delivered", "on-ramp funding", "stablecoin final", "return credit", "withdrawn after export", "debit return line"]) expect(`${s}: ${SEEN.has(s)}`).toBe(`${s}: true`);
  });
});
