/**
 * Accounting Bridge (rc4) — WorkspaceActions. Called from applyAction's dispatch (../actions.ts), so every bridge
 * action has the same guarantees as the rest of the engine: pure, typed errors with no change (the console's dry
 * run), the workspace re-validated on entry, and an audit event for everything it records.
 *
 * Proposal lifecycle (separate from every payment status):
 *   proposed → approved (an approver who is NOT the person who proposed it) → exported (in a journal export file)
 *   → posted (ONLY via record_posting: a person states the external ledger reference; Clearline never posts).
 *   proposed / approved / exported → rejected (a person, with a reason).
 *   proposed / approved → superseded (automatically, after any action that changes the evidence; the reason is
 *   recorded). An exported or posted proposal is never changed: it gets `evidenceChange` and the next
 *   propose_journal_entries proposes a JR_REVERSAL (and the new entry), which go through the same approvals.
 */
import { formatMinor } from "../money";
import { Tx, fail, requireRole, safeNote } from "../tx";
import { JOURNAL_RULE } from "./labels";
import { deriveJournalCandidates, isActiveProposal, isBalanced, isStandingProposal, type JournalCandidate } from "./derive";
import { buildJournalExport, buildReconciliationExport, journalExportAccounts, validRange } from "./exports";
import { mappingProblem, periodProblem, resolvePeriod } from "./periods";
import type { AccountMappingEntry, AccountingAction, AccountingBridge, JournalProposal, NotProposedItem } from "./types";

export const ACCOUNTING_ACTION_TYPES: readonly AccountingAction["type"][] = [
  "set_account_mapping", "open_accounting_period", "close_accounting_period", "propose_journal_entries", "approve_journal_proposal",
  "reject_journal_proposal", "export_journal", "record_posting", "record_reconciliation_export",
];
export const isAccountingAction = (a: { type?: unknown } | null | undefined): a is AccountingAction => (ACCOUNTING_ACTION_TYPES as readonly unknown[]).includes(a?.type);

const EXTERNAL_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/#:]{1,63}$/;

function bridge(tx: Tx): AccountingBridge {
  return (tx.ws.accounting ??= { version: 1, periods: [], proposals: [], exports: [] });
}

function proposalById(tx: Tx, id: unknown): JournalProposal {
  const p = tx.ws.accounting?.proposals.find((x) => x.id === id);
  if (!p) fail("not_found", `Journal proposal ${String(id)} not found.`, { entityId: typeof id === "string" ? id : undefined });
  return p;
}

const evidenceIdsOf = (p: Pick<JournalProposal, "lines">) => [...new Set(p.lines.flatMap((l) => l.evidenceIds))];
const linesText = (p: Pick<JournalProposal, "lines">) => p.lines.map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.accountKey} ${formatMinor(l.amountMinor, l.currency)}`).join(" / ");

export function applyAccountingAction(tx: Tx, a: AccountingAction): string {
  switch (a.type) {
    case "set_account_mapping": return setMapping(tx, a.entries, a.expectedRevision);
    case "open_accounting_period": return openPeriod(tx, a.name, a.from, a.to);
    case "close_accounting_period": return closePeriod(tx, a.periodId);
    case "propose_journal_entries": return propose(tx, a.periodId);
    case "approve_journal_proposal": return approve(tx, a.proposalId, a.note);
    case "reject_journal_proposal": return reject(tx, a.proposalId, a.reason);
    case "export_journal": return exportJournal(tx, a.periodId);
    case "record_posting": return recordPosting(tx, a.proposalId, a.externalReference, a.note);
    case "record_reconciliation_export": return recordReconciliationExport(tx, a.from, a.to);
  }
}

// ---------------------------------------------------------------------------------------------
// Mapping and periods
// ---------------------------------------------------------------------------------------------

function setMapping(tx: Tx, entries: AccountMappingEntry[], expectedRevision?: number): string {
  requireRole(tx, ["operator", "approver"]);
  const problem = mappingProblem(entries);
  if (problem) fail("invalid_field", problem.message, { field: problem.field });
  const b = bridge(tx);
  const current = b.mapping?.revision ?? 0;
  if (expectedRevision !== undefined && expectedRevision !== current)
    fail("precondition_failed", `MAPPING_REVISION_CONFLICT: the mapping is at revision ${current}, not ${String(expectedRevision)}.`, { field: "expectedRevision" });
  b.mapping = { revision: current + 1, entries: entries.map((e) => ({ accountKey: e.accountKey, accountCode: e.accountCode, accountName: e.accountName })), updatedBy: tx.actorId, updatedAt: tx.at };
  tx.log("accounting.mapping_set", "account_mapping", `mapping_r${current + 1}`, `Revision ${current + 1}: ${b.mapping.entries.map((e) => `${e.accountKey} → ${e.accountCode}`).join("; ")}`);
  return "applied";
}

function openPeriod(tx: Tx, name: string, from: string, to: string): string {
  requireRole(tx, ["operator", "approver"]);
  const problem = periodProblem(tx.ws.accounting, name, from, to);
  if (problem) fail(problem.overlap ? "precondition_failed" : "invalid_field", problem.message, { field: problem.field, entityId: problem.overlap?.id });
  const b = bridge(tx);
  const id = tx.id("per");
  b.periods.push({ id, name, from, to, status: "open", openedBy: tx.actorId, openedAt: tx.at });
  tx.created.push(id);
  tx.log("accounting.period_opened", "accounting_period", id, `${name} [${from}, ${to}) opened (${tx.ws.organization.timezone} calendar dates)`);
  return "applied";
}

function closePeriod(tx: Tx, periodId: string): string {
  requireRole(tx, ["approver"]);
  const p = tx.ws.accounting?.periods.find((x) => x.id === periodId);
  if (!p) fail("not_found", `Accounting period ${String(periodId)} not found.`, { entityId: periodId });
  if (p.status !== "open") fail("invalid_transition", `PERIOD_CLOSED: period ${p.name} is already closed.`, { entityId: p.id });
  const pending = tx.ws.accounting!.proposals.filter((x) => x.periodId === p.id && isActiveProposal(x));
  if (pending.length) fail("precondition_failed", `PERIOD_HAS_PENDING_PROPOSALS: ${pending.length} proposal(s) in ${p.name} are still ${[...new Set(pending.map((x) => x.status))].join(" or ")} (${pending.map((x) => x.id).join(", ")}).`, { entityId: pending[0].id });
  p.status = "closed";
  p.closedBy = tx.actorId;
  p.closedAt = tx.at;
  tx.log("accounting.period_closed", "accounting_period", p.id, `${p.name} [${p.from}, ${p.to}) closed; later items dated in it go to the next open period as prior-period items`);
  return "applied";
}

// ---------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------

const reversedActive = (b: AccountingBridge, p: JournalProposal) => b.proposals.some((q) => q.reverses === p.id && q.status !== "rejected" && q.status !== "superseded");

/** Whether a candidate is new: no proposal for the same evidence is pending, in the books (and not being reversed), or was rejected. */
function isNew(b: AccountingBridge, c: JournalCandidate): boolean {
  return !b.proposals.some((p) => p.sourceKey === c.sourceKey && p.basisHash === c.basisHash && (isActiveProposal(p) || p.status === "rejected" || (isStandingProposal(p) && !reversedActive(b, p))));
}

function propose(tx: Tx, periodId?: string): string {
  requireRole(tx, ["operator", "approver"]);
  const b = tx.ws.accounting;
  if (periodId !== undefined) {
    const p = b?.periods.find((x) => x.id === periodId);
    if (!p) fail("not_found", `Accounting period ${String(periodId)} not found.`, { entityId: String(periodId) });
    if (p.status !== "open") fail("precondition_failed", `PERIOD_CLOSED: period ${p.name} is closed; no new proposals can be dated in it. Items dated in it are proposed in the next open period as prior-period items.`, { entityId: p.id });
  }
  if (!b || !b.periods.some((p) => p.status === "open")) fail("precondition_failed", "NO_OPEN_PERIOD: open an accounting period before proposing entries.");
  syncAccounting(tx);
  const { candidates } = deriveJournalCandidates(tx.ws);
  const made: string[] = [];
  for (const c of candidates) {
    if (!isNew(b, c)) continue;
    const where = resolvePeriod(b, c.entryDate);
    if (!where.ok) continue; // listed by journalProposalsView as NP_NO_OPEN_PERIOD
    if (periodId !== undefined && where.periodId !== periodId) continue;
    if (!isBalanced(c.lines)) fail("precondition_failed", `NOT_BALANCED: the candidate ${c.sourceKey} does not balance per currency.`);
    const id = tx.id("jp");
    const period = b.periods.find((p) => p.id === where.periodId)!;
    const p: JournalProposal = {
      id, sourceKey: c.sourceKey, ruleCode: c.ruleCode, status: "proposed", entryDate: c.entryDate, postingDate: where.postingDate, periodId: where.periodId,
      ...(where.priorPeriodItem ? { priorPeriodItem: where.priorPeriodItem } : {}),
      currency: c.currency, lines: structuredClone(c.lines), evidence: structuredClone(c.evidence),
      ...(c.intentId ? { intentId: c.intentId } : {}), ...(c.advanceId ? { advanceId: c.advanceId } : {}), ...(c.obligationId ? { obligationId: c.obligationId } : {}), ...(c.reverses ? { reverses: c.reverses } : {}),
      narrative: c.narrative, showsSupplierPaid: c.showsSupplierPaid, basisHash: c.basisHash, createdBy: tx.actorId, createdAt: tx.at,
      history: [{ at: tx.at, actorId: tx.actorId, action: "proposed", detail: `${JOURNAL_RULE[c.ruleCode]}: ${linesText(c)}${where.priorPeriodItem ? ` — ${where.priorPeriodItem.reason}` : ""}` }],
    };
    for (const old of b.proposals)
      if (old.sourceKey === c.sourceKey && old.status === "superseded" && old.supersession && !old.supersession.replacedBy) {
        old.supersession.replacedBy = id;
        old.history.push({ at: tx.at, actorId: tx.actorId, action: "replaced", detail: `Replaced by ${id}` });
      }
    b.proposals.push(p);
    made.push(id);
    tx.created.push(id);
    tx.log("journal.proposed", "journal_proposal", id,
      `${c.ruleCode} ${linesText(c)} on ${where.postingDate} in ${period.name}${where.priorPeriodItem ? " (prior-period item)" : ""}${c.reverses ? `, reverses ${c.reverses}` : ""}; evidence ${evidenceIdsOf(c).join(", ")}`);
  }
  return made.length ? "proposals_created" : "no_new_proposals";
}

function currentCandidate(tx: Tx, p: JournalProposal): JournalCandidate | undefined {
  return deriveJournalCandidates(tx.ws).candidates.find((c) => c.sourceKey === p.sourceKey);
}

function approve(tx: Tx, proposalId: string, note?: string): string {
  const p = proposalById(tx, proposalId);
  // Separation of duties is checked first so the maker always sees maker_checker_violation.
  if (p.createdBy === tx.actorId) fail("maker_checker_violation", "The approver must be a different person from the one who proposed the entry.", { entityId: p.id });
  requireRole(tx, ["approver"]);
  if (p.status !== "proposed") fail("invalid_transition", `Journal proposal ${p.id} is ${p.status}, not proposed.`, { entityId: p.id });
  if (note !== undefined && !safeNote(note, 300)) fail("invalid_field", "note must be 1–300 plain characters.", { field: "note" });
  const c = currentCandidate(tx, p);
  if (!c || c.basisHash !== p.basisHash) fail("precondition_failed", `EVIDENCE_CHANGED: the evidence behind ${p.id} changed; propose entries again.`, { entityId: p.id });
  const period = tx.ws.accounting!.periods.find((x) => x.id === p.periodId);
  if (!period || period.status !== "open") fail("precondition_failed", `PERIOD_CLOSED: period ${period?.name ?? p.periodId} is closed.`, { entityId: p.id });
  if (!isBalanced(p.lines)) fail("precondition_failed", `NOT_BALANCED: ${p.id} does not balance per currency.`, { entityId: p.id });
  p.status = "approved";
  p.approval = { by: tx.actorId, at: tx.at, ...(note !== undefined ? { note } : {}) };
  p.history.push({ at: tx.at, actorId: tx.actorId, action: "approved", detail: `Approved by ${tx.actorId} (proposed by ${p.createdBy})${note ? `: ${note}` : ""}` });
  tx.log("journal.approved", "journal_proposal", p.id, `Approved by ${tx.actorId}, proposed by ${p.createdBy}; not posted; evidence ${evidenceIdsOf(p).join(", ")}`);
  return "applied";
}

function reject(tx: Tx, proposalId: string, reason: string): string {
  requireRole(tx, ["operator", "approver"]);
  const p = proposalById(tx, proposalId);
  if (!["proposed", "approved", "exported"].includes(p.status)) fail("invalid_transition", `Journal proposal ${p.id} is ${p.status}; only a proposed, approved or exported (not posted) entry can be rejected.`, { entityId: p.id });
  if (!safeNote(reason, 300)) fail("invalid_field", "A rejection reason is required.", { field: "reason" });
  const was = p.status;
  p.status = "rejected";
  p.rejection = { by: tx.actorId, at: tx.at, reason };
  p.history.push({ at: tx.at, actorId: tx.actorId, action: "rejected", detail: `${was} → rejected: ${reason}` });
  tx.log("journal.rejected", "journal_proposal", p.id, `Rejected (was ${was}) by ${tx.actorId}: ${reason.slice(0, 80)}; evidence ${evidenceIdsOf(p).join(", ")}`);
  return "applied";
}

function exportJournal(tx: Tx, periodId: string): string {
  requireRole(tx, ["operator", "approver"]);
  const b = tx.ws.accounting;
  const period = b?.periods.find((x) => x.id === periodId);
  if (!b || !period) fail("not_found", `Accounting period ${String(periodId)} not found.`, { entityId: periodId });
  const doc = buildJournalExport(tx.ws, { periodId });
  if (!doc.ok) fail(doc.error.code, doc.error.message, { field: doc.error.field, entityId: period.id });
  const proposals = b.proposals.filter((p) => p.periodId === period.id && p.status === "approved");
  const { accounts } = journalExportAccounts(tx.ws, proposals);
  const id = tx.id("acx");
  for (const p of proposals) {
    p.status = "exported";
    p.export = { exportId: id, by: tx.actorId, at: tx.at };
    p.history.push({ at: tx.at, actorId: tx.actorId, action: "exported", detail: `In journal export ${doc.value.documentId} (${id}); not posted until a person records the posting` });
  }
  b.exports.push({
    id, kind: "journal", documentId: doc.value.documentId, sha256: doc.value.sha256, from: period.from, to: period.to, periodId: period.id,
    proposalIds: proposals.map((p) => p.id), mappingRevision: b.mapping!.revision, accounts, rowCount: doc.value.entries.reduce((s, e) => s + e.lines.length, 0), by: tx.actorId, at: tx.at,
  });
  tx.created.push(id);
  tx.log("accounting.journal_exported", "accounting_export", id, `${doc.value.documentId} (sha256 ${doc.value.sha256}) for ${period.name}: ${proposals.length} entr${proposals.length === 1 ? "y" : "ies"} (${proposals.map((p) => p.id).join(", ")}), mapping revision ${b.mapping!.revision}. A file only; nothing was posted.`);
  return "applied";
}

function recordPosting(tx: Tx, proposalId: string, externalReference: string, note?: string): string {
  requireRole(tx, ["operator", "approver"]);
  const p = proposalById(tx, proposalId);
  if (p.status !== "exported") fail("invalid_transition", `NOT_EXPORTED: ${p.id} is ${p.status}; only an exported entry can be recorded as posted.`, { entityId: p.id });
  if (typeof externalReference !== "string" || !EXTERNAL_REF_RE.test(externalReference)) fail("invalid_field", "externalReference must be the ledger's journal reference: 2–64 letters, digits or . _ - / # :.", { field: "externalReference" });
  if (note !== undefined && !safeNote(note, 300)) fail("invalid_field", "note must be 1–300 plain characters.", { field: "note" });
  p.status = "posted";
  p.posting = { externalReference, recordedBy: tx.actorId, recordedAt: tx.at, ...(note !== undefined ? { note } : {}), simulated: true };
  p.history.push({ at: tx.at, actorId: tx.actorId, action: "posting_recorded", detail: `${tx.actorId} recorded that this entry was posted in the external ledger as ${externalReference} (simulated). Clearline posted nothing.` });
  tx.log("journal.posting_recorded", "journal_proposal", p.id, `Posting recorded by a person: external reference ${externalReference} (simulated; Clearline has no ledger connection); export ${p.export?.exportId}; evidence ${evidenceIdsOf(p).join(", ")}`);
  return "applied";
}

function recordReconciliationExport(tx: Tx, from: string, to: string): string {
  requireRole(tx, ["operator", "approver", "compliance"]);
  const bad = validRange(from, to);
  if (bad) fail("invalid_field", bad.message, { field: bad.field });
  const doc = buildReconciliationExport(tx.ws, { from, to });
  if (!doc.ok) fail(doc.error.code, doc.error.message, { field: doc.error.field });
  const b = bridge(tx);
  const id = tx.id("acx");
  b.exports.push({ id, kind: "reconciliation", documentId: doc.value.documentId, sha256: doc.value.sha256, from, to, rowCount: doc.value.rows.length, by: tx.actorId, at: tx.at });
  tx.created.push(id);
  const s = doc.value.summary;
  tx.log("accounting.reconciliation_exported", "accounting_export", id, `${doc.value.documentId} (sha256 ${doc.value.sha256}) for [${from}, ${to}): ${doc.value.rows.length} rows — ${s.evidenced.rows} evidenced, ${s.provider_reported_only.rows} provider-reported only, ${s.unresolved.rows} unresolved`);
  return "applied";
}

// ---------------------------------------------------------------------------------------------
// Evidence changes
// ---------------------------------------------------------------------------------------------

function changeReason(p: JournalProposal, c: JournalCandidate): string {
  if (c.ruleCode !== p.ruleCode) return `The evidence now gives "${JOURNAL_RULE[c.ruleCode]}" instead of "${JOURNAL_RULE[p.ruleCode]}".`;
  const before = linesText(p);
  const after = linesText(c);
  if (before !== after) return `The entry's lines changed: ${before} → ${after}.`;
  const was = new Set(evidenceIdsOf(p));
  const now = new Set(evidenceIdsOf(c));
  const added = [...now].filter((x) => !was.has(x));
  const removed = [...was].filter((x) => !now.has(x));
  return `Its evidence records changed${added.length ? `; added ${added.join(", ")}` : ""}${removed.length ? `; removed ${removed.join(", ")}` : ""}${!added.length && !removed.length ? " (dates or links)" : ""}.`;
}

function withdrawnReason(p: JournalProposal, notProposed: NotProposedItem[]): string {
  if (p.ruleCode === "JR_REVERSAL") return `The entry it reverses (${p.reverses}) matches its evidence again, so no reversal is needed.`;
  const ids = new Set([...evidenceIdsOf(p), p.intentId, p.advanceId, p.obligationId].filter((x): x is string => !!x));
  const why = notProposed.filter((n) => n.refs.some((r) => ids.has(r))).map((n) => n.text);
  return why.length ? `The evidence no longer supports an entry: ${[...new Set(why)].join(" ")}` : "The evidence no longer supports an entry (the allocation or observation it rested on no longer qualifies).";
}

/**
 * Run after every action (applyAction) and after a per-case reset. A proposed or approved proposal whose evidence
 * no longer gives exactly the same entry is superseded, with the reason; an exported or posted one is kept and
 * marked `evidenceChange` (a reversal is then proposed). Does nothing for a workspace without proposals.
 */
export function syncAccounting(tx: Tx): void {
  const b = tx.ws.accounting;
  if (!b || !b.proposals.length) return;
  const { candidates, notProposed } = deriveJournalCandidates(tx.ws);
  const bySource = new Map(candidates.map((c) => [c.sourceKey, c]));
  for (const p of b.proposals) {
    if (!isActiveProposal(p) && !(isStandingProposal(p) && !p.evidenceChange)) continue;
    const c = bySource.get(p.sourceKey);
    if (c && c.basisHash === p.basisHash) continue;
    const code = c ? ("SP_EVIDENCE_CHANGED" as const) : ("SP_EVIDENCE_WITHDRAWN" as const);
    const reason = c ? changeReason(p, c) : withdrawnReason(p, notProposed);
    if (isActiveProposal(p)) {
      const was = p.status;
      p.status = "superseded";
      p.supersession = { at: tx.at, causedBy: tx.actorId, code, reason };
      p.history.push({ at: tx.at, actorId: tx.actorId, action: "superseded", detail: `${was} → superseded: ${reason}` });
      tx.log("journal.superseded", "journal_proposal", p.id, `${was} → superseded (${code}): ${reason}`.slice(0, 400));
    } else {
      p.evidenceChange = { at: tx.at, causedBy: tx.actorId, code, reason };
      p.history.push({ at: tx.at, actorId: tx.actorId, action: "evidence_changed", detail: `Evidence changed after ${p.status === "posted" ? "posting" : "export"} (${code}): ${reason} The entry is unchanged; a reversal will be proposed.` });
      tx.log("journal.evidence_changed_after_export", "journal_proposal", p.id, `${p.status} entry kept; evidence changed (${code}): ${reason}`.slice(0, 400));
    }
  }
}

