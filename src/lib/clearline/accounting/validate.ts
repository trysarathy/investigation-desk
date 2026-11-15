/**
 * Accounting Bridge (rc4) — load-time validation (called by serialize.ts for every parse, load and action).
 *
 * A workspace WITHOUT `accounting` (every v2 / rc3 workspace) is never checked or changed: absent means empty.
 * A workspace WITH it is refused (never repaired) when a record breaks a bridge invariant — no engine version
 * produces such a record, so it was crafted or damaged:
 * - every proposal balances per currency (BigInt), has ≥ 2 lines in its own currency, and its lines have the shape
 *   its rule produces (a returned / not-delivered payout never debits the supplier payable; a stablecoin entry never
 *   touches a bank account; a reversal mirrors the entry it reverses);
 * - every line names evidence that exists in the workspace (no entry without evidence);
 * - approval by an existing approver who is not the proposer (maker ≠ checker); "posted" only with a person's
 *   recorded posting and an export record (proposed ≠ posted);
 * - a proposed or approved entry never sits in a closed period, and a prior-period item names the closed period;
 * - periods do not overlap; the mapping is valid; export records name existing periods and proposals, and every
 *   proposal an export record lists names that record back (review F4);
 * - review F3 — stored lines are never trusted: every entry's lines re-derive from the evidence records it names
 *   (the statement line / chain observation, its allocation, the amount, currency, bank account and direction), its
 *   basisHash is recomputed from the stored fields, and a proposed or approved entry must equal the entry the current
 *   evidence gives;
 * - review F1 / F5 — over all counted entries, the net debit to the supplier payable (or customer receivable) per
 *   payout never exceeds the payout, and no bank line is booked more than once;
 * - review F12 — every line memo carries the [SANDBOX] marking.
 *
 * The approver's identity in a client-held workspace cannot be authenticated: these checks prove the records are
 * consistent with the evidence and with each other, not who clicked.
 */
import { MAX_AMOUNT_MINOR, isCurrency } from "../money";
import { isIsoDate, isIsoInstant } from "../tx";
import { basisOf, bankKey, deriveJournalCandidates, isBalanced } from "./derive";
import { mappingProblem, roleOfKey } from "./periods";
import type { AccountRole, JournalRuleCode } from "./types";
import type { StatusDimensions, WorkspaceMigration } from "../types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const JOURNAL_RULE_CODES: readonly JournalRuleCode[] = ["JR_SUPPLIER_PAYOUT_DEBIT", "JR_PAYOUT_DEBIT_NOT_DELIVERED", "JR_PAYOUT_RETURN_CREDIT", "JR_ADVANCE_DISBURSED", "JR_REPAYMENT_BY_REFERENCE", "JR_STABLECOIN_FINAL_TRANSFER", "JR_STABLECOIN_ONRAMP_FUNDING", "JR_REVERSAL"];
/** Bank rules: the statement line direction each needs (the bank line's side is the opposite of the money's direction). */
const BANK_DIRECTION: Partial<Record<JournalRuleCode, "debit" | "credit">> = {
  JR_SUPPLIER_PAYOUT_DEBIT: "debit", JR_PAYOUT_DEBIT_NOT_DELIVERED: "debit", JR_ADVANCE_DISBURSED: "debit", JR_STABLECOIN_ONRAMP_FUNDING: "debit",
  JR_PAYOUT_RETURN_CREDIT: "credit", JR_REPAYMENT_BY_REFERENCE: "credit",
};
const STATUSES = ["proposed", "approved", "exported", "posted", "rejected", "superseded"];

/** The [debit roles, credit roles] each evidence rule produces (two lines). */
export const RULE_SHAPE: Readonly<Record<Exclude<JournalRuleCode, "JR_REVERSAL">, [AccountRole[], AccountRole[]]>> = {
  JR_SUPPLIER_PAYOUT_DEBIT: [["supplier_payable"], ["bank"]],
  JR_PAYOUT_DEBIT_NOT_DELIVERED: [["provider_clearing"], ["bank"]],
  JR_PAYOUT_RETURN_CREDIT: [["bank"], ["provider_clearing"]],
  JR_ADVANCE_DISBURSED: [["customer_receivable"], ["bank"]],
  JR_REPAYMENT_BY_REFERENCE: [["bank"], ["customer_receivable"]],
  JR_STABLECOIN_FINAL_TRANSFER: [["supplier_payable", "customer_receivable"], ["stablecoin_clearing"]],
  JR_STABLECOIN_ONRAMP_FUNDING: [["stablecoin_clearing"], ["bank"]],
};
/** Rules whose entry shows the supplier as paid (bank debit or final chain evidence of a live payout). */
export const SHOWS_SUPPLIER_PAID: readonly JournalRuleCode[] = ["JR_SUPPLIER_PAYOUT_DEBIT", "JR_ADVANCE_DISBURSED", "JR_STABLECOIN_FINAL_TRANSFER"];

export class AccountingInvalid extends Error {
  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

/** Re-review R1: why a load refuses accounting records (never "no engine version produces this"). */
export const ACCOUNTING_REFUSAL_TEXT =
  "Its accounting records contradict the evidence they name, or each other (crafted or damaged data), so they were not repaired.";
const need = (cond: unknown, field: string, what: string) => {
  if (!cond) throw new AccountingInvalid(field, what);
};

/**
 * Validates the bridge records and returns the load-time migrations it applied (re-review R1): a proposed or approved
 * entry that is self-consistent (evidence tie and basis hash hold) but that the current rules derive differently — a
 * workspace saved by an earlier engine version, before a rule change — is superseded (SP_RULES_CHANGED) and reported,
 * never refused. Exported and posted entries are never altered: sync flags them and propose adds their reversal.
 */
export function validateAccounting(ws: Obj): WorkspaceMigration[] {
  if (ws.accounting === undefined) return [];
  const b = ws.accounting;
  need(isObj(b), "accounting", "must be an object");
  const a = b as Obj;
  need(a.version === 1, "accounting.version", "must be 1");
  for (const k of ["periods", "proposals", "exports"]) need(Array.isArray(a[k]), `accounting.${k}`, "must be an array");
  const roleOf = new Map((ws.actors as Obj[]).map((x) => [x.id as string, x.role as string]));
  const hasRole = (id: unknown, roles: string[]) => typeof id === "string" && roles.includes(roleOf.get(id) ?? "");

  if (a.mapping !== undefined) {
    need(isObj(a.mapping), "accounting.mapping", "must be an object");
    const m = a.mapping as Obj;
    need(Number.isSafeInteger(m.revision) && (m.revision as number) >= 1, "accounting.mapping.revision", "must be an integer ≥ 1");
    const p = mappingProblem(m.entries);
    need(!p, `accounting.mapping.${p?.field ?? "entries"}`, p?.message ?? "");
    need(hasRole(m.updatedBy, ["operator", "approver"]), "accounting.mapping.updatedBy", "must be an existing operator or approver");
    need(isIsoInstant(m.updatedAt), "accounting.mapping.updatedAt", "must be an ISO-8601 instant");
  }

  const periods = a.periods as Obj[];
  const periodById = new Map<string, Obj>();
  periods.forEach((p, i) => {
    const f = `accounting.periods[${i}]`;
    need(isObj(p) && typeof p.id === "string" && p.id.length > 0, `${f}.id`, "must be a non-empty string");
    need(!periodById.has(p.id as string), `${f}.id`, "must be unique");
    need(typeof p.name === "string" && (p.name as string).length >= 2, `${f}.name`, "must be a name");
    need(isIsoDate(p.from) && isIsoDate(p.to) && (p.from as string) < (p.to as string), `${f}.from`, "from and to must be YYYY-MM-DD with from < to");
    need(p.status === "open" || p.status === "closed", `${f}.status`, "must be open or closed");
    need(hasRole(p.openedBy, ["operator", "approver"]) && isIsoInstant(p.openedAt), `${f}.openedBy`, "must be an existing operator or approver, with openedAt");
    if (p.status === "closed") need(hasRole(p.closedBy, ["approver"]) && isIsoInstant(p.closedAt), `${f}.closedBy`, "a closed period names the approver who closed it, with closedAt");
    for (const q of periodById.values()) need(!((p.from as string) < (q.to as string) && (q.from as string) < (p.to as string)), `${f}.from`, `overlaps period ${String(q.id)}`);
    periodById.set(p.id as string, p);
  });

  const evidenceIds = new Set<string>();
  for (const coll of ["statementLines", "allocations", "chainObservations", "repaymentAllocations", "providerEvents", "evidence"]) for (const r of ws[coll] as Obj[]) evidenceIds.add(r.id as string);
  const exports = a.exports as Obj[];
  const exportById = new Map<string, Obj>();
  const proposals = a.proposals as Obj[];
  const proposalById = new Map<string, Obj>();
  proposals.forEach((p, i) => {
    need(isObj(p) && typeof p.id === "string" && p.id.length > 0, `accounting.proposals[${i}].id`, "must be a non-empty string");
    need(!proposalById.has(p.id as string), `accounting.proposals[${i}].id`, "must be unique");
    proposalById.set(p.id as string, p);
  });
  exports.forEach((x, i) => {
    const f = `accounting.exports[${i}]`;
    need(isObj(x) && typeof x.id === "string" && !exportById.has(x.id as string), `${f}.id`, "must be a unique non-empty string");
    need(x.kind === "reconciliation" || x.kind === "journal", `${f}.kind`, "must be reconciliation or journal");
    need(typeof x.documentId === "string" && new RegExp(`^${x.kind === "journal" ? "jx" : "rx"}_[0-9a-f]{16}$`).test(x.documentId as string), `${f}.documentId`, "must be rx_/jx_ followed by 16 hex digits");
    need(typeof x.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256 as string) && (x.sha256 as string).startsWith((x.documentId as string).slice(3)), `${f}.sha256`, "must be the 64-hex SHA-256 its documentId abbreviates");
    need(isIsoDate(x.from) && isIsoDate(x.to) && (x.from as string) < (x.to as string), `${f}.from`, "from and to must be YYYY-MM-DD with from < to");
    need(Number.isSafeInteger(x.rowCount) && (x.rowCount as number) >= 0, `${f}.rowCount`, "must be an integer ≥ 0");
    need(hasRole(x.by, ["operator", "approver", "compliance"]) && isIsoInstant(x.at), `${f}.by`, "must be an existing staff member, with at");
    if (x.kind === "journal") {
      need(typeof x.periodId === "string" && periodById.has(x.periodId as string), `${f}.periodId`, "must name an accounting period");
      need(Array.isArray(x.proposalIds) && (x.proposalIds as unknown[]).length > 0 && (x.proposalIds as unknown[]).every((id) => proposalById.has(id as string)), `${f}.proposalIds`, "must list existing proposals");
      need(Array.isArray(x.accounts) && !mappingProblem(x.accounts), `${f}.accounts`, "must be the account codes the export used");
    }
    exportById.set(x.id as string, x);
  });

  proposals.forEach((p, i) => {
    const f = `accounting.proposals[${i}]`;
    need(typeof p.sourceKey === "string" && (p.sourceKey as string).length > 0, `${f}.sourceKey`, "must be a non-empty string");
    need(JOURNAL_RULE_CODES.includes(p.ruleCode as JournalRuleCode), `${f}.ruleCode`, `must be one of ${JOURNAL_RULE_CODES.join(", ")}`);
    need(STATUSES.includes(p.status as string), `${f}.status`, `must be one of ${STATUSES.join(", ")}`);
    need(isIsoDate(p.entryDate) && isIsoDate(p.postingDate), `${f}.entryDate`, "entryDate and postingDate must be YYYY-MM-DD");
    need(isCurrency(p.currency), `${f}.currency`, "must be a supported currency");
    need(typeof p.basisHash === "string" && /^[0-9a-f]{64}$/.test(p.basisHash as string), `${f}.basisHash`, "must be a 64-hex SHA-256");
    need(typeof p.showsSupplierPaid === "boolean" && typeof p.narrative === "string" && Array.isArray(p.history) && isObj(p.evidence), `${f}`, "must carry showsSupplierPaid, narrative, evidence and history");
    need(hasRole(p.createdBy, ["operator", "approver"]) && isIsoInstant(p.createdAt), `${f}.createdBy`, "must be an existing operator or approver (propose_journal_entries), with createdAt");
    // Lines: exact, one currency, balanced, each with existing evidence.
    need(Array.isArray(p.lines) && (p.lines as unknown[]).length >= 2, `${f}.lines`, "must have at least two lines");
    const lines = p.lines as Obj[];
    lines.forEach((l, j) => {
      const g = `${f}.lines[${j}]`;
      need(isObj(l) && roleOfKey(l.accountKey) !== undefined, `${g}.accountKey`, "must be bank:<account ref> or a Clearline account role");
      need(l.side === "debit" || l.side === "credit", `${g}.side`, "must be debit or credit");
      need(typeof l.amountMinor === "number" && Number.isSafeInteger(l.amountMinor) && (l.amountMinor as number) >= 1 && (l.amountMinor as number) <= MAX_AMOUNT_MINOR, `${g}.amountMinor`, `must be an integer number of minor units from 1 to ${MAX_AMOUNT_MINOR}`);
      need(l.currency === p.currency, `${g}.currency`, "must equal the proposal's currency (one currency per entry)");
      need(JOURNAL_RULE_CODES.includes(l.ruleCode as JournalRuleCode) && typeof l.memo === "string", `${g}.ruleCode`, "must name the rule that produced it, with a memo");
      need((l.memo as string).startsWith("[SANDBOX] "), `${g}.memo`, "must start with the [SANDBOX] marking (fictional data)");
      need(Array.isArray(l.evidenceIds) && (l.evidenceIds as unknown[]).length > 0 && (l.evidenceIds as unknown[]).every((id) => typeof id === "string" && evidenceIds.has(id)), `${g}.evidenceIds`, "must name at least one evidence record that exists in this workspace (no entry without evidence)");
    });
    need(isBalanced(lines as never), `${f}.lines`, "debits must equal credits, per currency, exactly");
    // Shape per rule.
    if (p.ruleCode === "JR_REVERSAL") {
      const orig = proposalById.get(p.reverses as string);
      need(!!orig && orig.ruleCode !== "JR_REVERSAL", `${f}.reverses`, "a reversal reverses an existing non-reversal proposal");
      const o = (orig!.lines as Obj[]);
      need(o.length === lines.length && lines.every((l, j) => l.accountKey === o[j].accountKey && l.amountMinor === o[j].amountMinor && l.currency === o[j].currency && l.side !== o[j].side), `${f}.lines`, "a reversal mirrors the lines of the entry it reverses");
      need(isObj(orig!.export), `${f}.reverses`, "only an entry that was exported (or posted) is reversed");
    } else {
      need(p.reverses === undefined, `${f}.reverses`, "only a JR_REVERSAL reverses an entry");
      const [dr, cr] = RULE_SHAPE[p.ruleCode as Exclude<JournalRuleCode, "JR_REVERSAL">];
      need(lines.length === 2 && lines[0].side === "debit" && lines[1].side === "credit" && dr.includes(roleOfKey(lines[0].accountKey)!) && cr.includes(roleOfKey(lines[1].accountKey)!) && lines.every((l) => l.ruleCode === p.ruleCode),
        `${f}.lines`, `${String(p.ruleCode)} produces Dr ${dr.join("|")} / Cr ${cr.join("|")}`);
    }
    need(p.showsSupplierPaid === SHOWS_SUPPLIER_PAID.includes(p.ruleCode as JournalRuleCode), `${f}.showsSupplierPaid`, "only a live payout's bank-debit or final-chain entry shows the supplier as paid (never a return or a not-delivered payout)");
    if (p.ruleCode !== "JR_REVERSAL") evidenceTie(ws, p, f);
    need(p.basisHash === basisOf(p as never), `${f}.basisHash`, "must be the hash of its own rule, lines and evidence (a changed amount, account or evidence id is refused)");
    // Period.
    const period = periodById.get(p.periodId as string);
    need(!!period, `${f}.periodId`, "must name an accounting period");
    need((period!.from as string) <= (p.postingDate as string) && (p.postingDate as string) < (period!.to as string), `${f}.postingDate`, "must fall in its period");
    if (p.priorPeriodItem !== undefined) {
      const pp = p.priorPeriodItem as Obj;
      const orig = periodById.get(pp?.originalPeriodId as string);
      need(isObj(pp) && !!orig && orig.status === "closed" && pp.originalDate === p.entryDate && (orig.from as string) <= (p.entryDate as string) && (p.entryDate as string) < (orig.to as string) && p.postingDate === period!.from && typeof pp.reason === "string",
        `${f}.priorPeriodItem`, "must name the closed period its entry date falls in, and be proposed on the first day of a later period");
    } else need(p.postingDate === p.entryDate, `${f}.postingDate`, "equals the entry date unless the entry is a prior-period item");
    // Lifecycle records (proposed ≠ posted; maker ≠ checker).
    const st = p.status as string;
    const needsApproval = ["approved", "exported", "posted"].includes(st);
    if (needsApproval) need(isObj(p.approval), `${f}.approval`, `a ${st} entry carries its approval`);
    if (p.approval !== undefined) {
      const ap = p.approval as Obj;
      need(["approved", "exported", "posted", "rejected", "superseded"].includes(st), `${f}.approval`, `a ${st} entry has no approval`);
      need(isObj(ap) && ap.by !== p.createdBy, `${f}.approval.by`, "the approver must be a different person from the proposer (maker ≠ checker)");
      need(hasRole(ap.by, ["approver"]) && isIsoInstant(ap.at), `${f}.approval.by`, "must be an existing approver, with at");
    }
    if (st === "exported" || st === "posted") need(isObj(p.export), `${f}.export`, `a ${st} entry names its export`);
    if (p.export !== undefined) {
      const ex = p.export as Obj;
      const rec = exportById.get(ex?.exportId as string);
      need(["exported", "posted", "rejected"].includes(st) && !!rec && rec.kind === "journal" && (rec.proposalIds as unknown[]).includes(p.id), `${f}.export`, "must name the journal export record that lists it");
    }
    need((st === "posted") === (p.posting !== undefined), `${f}.posting`, "an entry is posted only when a person recorded the posting (record_posting), and a recorded posting means posted");
    if (st === "posted") {
      const ps = p.posting as Obj;
      need(isObj(ps) && ps.simulated === true && typeof ps.externalReference === "string" && /^[A-Za-z0-9][A-Za-z0-9._\-/#:]{1,63}$/.test(ps.externalReference as string), `${f}.posting.externalReference`, "must be the external ledger reference a person supplied");
      need(hasRole(ps.recordedBy, ["operator", "approver"]) && isIsoInstant(ps.recordedAt), `${f}.posting.recordedBy`, "must be an existing operator or approver, with recordedAt");
    }
    need((st === "rejected") === isObj(p.rejection), `${f}.rejection`, "a rejected entry (and only one) carries its rejection");
    need((st === "superseded") === isObj(p.supersession), `${f}.supersession`, "a superseded entry (and only one) carries why");
    if (isObj(p.rejection) && (p.rejection as Obj).notImported !== undefined) {
      const ni = (p.rejection as Obj).notImported as Obj;
      need(isObj(ni) && isObj(p.export) && hasRole(ni.by, ["approver"]) && ni.by !== (p.export as Obj).by && isIsoInstant(ni.at), `${f}.rejection.notImported`, "must be confirmed by an approver other than the exporter, on an exported entry");
    }
    if (isObj(p.approval) && (p.approval as Obj).accounts !== undefined) need(!mappingProblem((p.approval as Obj).accounts), `${f}.approval.accounts`, "must be the account codes the approver saw");
  });
  // Review F4: an export record and the proposals it lists name each other.
  exports.forEach((x, i) => {
    if (x.kind !== "journal") return;
    for (const id of x.proposalIds as string[]) need((proposalById.get(id)!.export as Obj | undefined)?.exportId === x.id, `accounting.exports[${i}].proposalIds`, `${id} does not name this export back. Engine a91dd11 could reuse an exported journal id after a per-case reset; that file can no longer be re-rendered, so this workspace is refused rather than repaired`);
  });
  // Review F3 + re-review R1: a proposed or approved entry is exactly the entry the current evidence gives. A
  // self-consistent one that the current rules derive differently is superseded and reported — not refused.
  const migrations: WorkspaceMigration[] = [];
  const isActive = (p: Obj) => p.status === "proposed" || p.status === "approved";
  if (proposals.some(isActive)) {
    const { candidates } = deriveJournalCandidates(ws as never);
    const asOf = ws.asOf as string;
    for (const p of proposals) {
      if (!isActive(p) || candidates.some((c) => c.sourceKey === p.sourceKey && c.basisHash === p.basisHash)) continue;
      const now = candidates.find((c) => c.sourceKey === p.sourceKey);
      const was = p.status as string;
      const reason = `This ${was} entry no longer matches the current posting rules: they give ${now ? `"${now.ruleCode}" with other lines or evidence` : "no entry"} for its evidence (it may have been saved by an earlier engine version, or edited). It was never exported; propose entries again.`;
      p.status = "superseded";
      p.supersession = { at: asOf, causedBy: "system", code: "SP_RULES_CHANGED", reason };
      (p.history as unknown[]).push({ at: asOf, actorId: "system", action: "superseded", detail: `${was} → superseded on load: ${reason}` });
      ws.seq = (ws.seq as number) + 1;
      const auditId = `aud_${String(ws.seq).padStart(5, "0")}`;
      (ws.audit as unknown[]).push({ id: auditId, at: asOf, actorId: "system", action: "workspace.migrated", entityType: "journal_proposal", entityId: p.id, summary: `rc4 migration (journal_proposal_superseded): ${p.id} ${was} → superseded (SP_RULES_CHANGED). ${reason}` });
      const intent = (ws.intents as Obj[]).find((x) => x.id === p.intentId);
      const dims = (intent?.status ?? { execution: "created", settlement: "none", settlementScope: "none", reconciliation: "not_started" }) as StatusDimensions;
      migrations.push({
        kind: "journal_proposal_superseded", intentId: (p.intentId as string) ?? "", internalReference: (intent?.internalReference as string) ?? "", from: { ...dims }, to: { ...dims },
        outcome: "proposal_superseded", proposalId: p.id as string, auditId,
        text: `Your saved journal entry ${p.id} (${String(p.ruleCode)}, ${was}) no longer matches the current posting rules for its evidence. It has been superseded; it was never exported or posted, and you can propose entries again.`,
      });
    }
  }
  // Pending-entry rules, on what is still pending after the migration.
  const activeSource = new Set<string>();
  proposals.forEach((p, i) => {
    if (!isActive(p)) return;
    const f = `accounting.proposals[${i}]`;
    need(periodById.get(p.periodId as string)!.status === "open", `${f}.periodId`, "a proposed or approved entry cannot sit in a closed period");
    need(!activeSource.has(p.sourceKey as string), `${f}.sourceKey`, "at most one proposed or approved entry per evidence source");
    activeSource.add(p.sourceKey as string);
  });
  // Final check K1: two un-reversed in-ledger copies of the SAME entry (same source key and basis hash) are refused. No
  // engine version produces them (propose never re-proposes an entry already in the ledger), and nothing would ever
  // correct them: both match the current evidence, so no reversal is derived.
  const reversed = new Set(proposals.filter((q) => q.ruleCode === "JR_REVERSAL" && q.status !== "rejected" && q.status !== "superseded").map((q) => q.reverses as string));
  const inLedger = (p: Obj) => p.status === "exported" || p.status === "posted" || (p.status === "rejected" && isObj(p.export) && !(isObj(p.rejection) && (p.rejection as Obj).notImported !== undefined));
  const seen = new Map<string, string>();
  proposals.forEach((p, i) => {
    if (p.ruleCode === "JR_REVERSAL" || !inLedger(p) || reversed.has(p.id as string)) return;
    const k = `${String(p.sourceKey)}\u0000${String(p.basisHash)}`;
    need(!seen.has(k), `accounting.proposals[${i}]`, `is a second copy of ${seen.get(k)} in the ledger (same evidence source and basis), with neither reversed; propose never creates this, and it could never be corrected`);
    seen.set(k, p.id as string);
  });
  // Other over-bookings are not refused: a bank line booked twice by a91dd11's rejected required reversal is corrected
  // by propose (a rejected reversal is proposed again), and a crafted copy under ANOTHER source key gets its own
  // reversal (its source has no current candidate). propose refuses only issues its new entries introduce or worsen.
  return migrations;
}

/** Review F3: the stored lines of an evidence rule re-derive from the evidence records they name. */
function evidenceTie(ws: Obj, p: Obj, f: string): void {
  const ev = p.evidence as Record<string, unknown>;
  const ids = (k: string) => (Array.isArray(ev[k]) ? (ev[k] as string[]) : []);
  const lines = p.lines as Obj[];
  const allocs = ws.allocations as Obj[];
  need(ids("allocationIds").length === 1, `${f}.evidence.allocationIds`, "an entry rests on exactly one allocation");
  const a = allocs.find((x) => x.id === ids("allocationIds")[0]);
  need(!!a, `${f}.evidence.allocationIds`, "must name an existing allocation");
  const t = a!.target as Obj;
  need(lines.every((l) => l.amountMinor === a!.amountMinor && l.currency === a!.currency), `${f}.lines`, "every line's amount and currency must equal its allocation's (stored amounts are never trusted)");
  for (const l of lines) need((l.evidenceIds as string[]).includes(a!.id as string), `${f}.lines`, "every line names its allocation");
  if (p.ruleCode === "JR_STABLECOIN_FINAL_TRANSFER") {
    const o = (ws.chainObservations as Obj[]).find((x) => x.id === ids("chainObservationIds")[0]);
    need(ids("chainObservationIds").length === 1 && !!o && a!.evidenceKind === "chain_observation" && a!.statementLineId === o.id && t.kind === "payment" && t.intentId === p.intentId && p.currency === "USDC",
      `${f}.evidence`, "a stablecoin entry rests on its payout's chain observation and that observation's allocation");
    return;
  }
  const line = (ws.statementLines as Obj[]).find((x) => x.id === ids("statementLineIds")[0]);
  need(ids("statementLineIds").length === 1 && !!line && line.source === "bank_statement" && a!.evidenceKind === "statement_line" && a!.statementLineId === line.id, `${f}.evidence`, "a bank entry rests on one bank statement line and its allocation");
  // The bank line is the statement line's own account, on the side the RULE gives. Whether the statement direction fits
  // the rule is not a load refusal (a91dd11 booked a debit "return" as a credit; rc3 stored such allocations): a pending
  // entry like that is superseded by the current-evidence check, an exported or posted one is reversed (re-review R1).
  const bankSide = BANK_DIRECTION[p.ruleCode as JournalRuleCode] === "debit" ? "credit" : "debit";
  need(lines.some((l) => l.side === bankSide && l.accountKey === bankKey(line!.accountRef as string)), `${f}.lines`, "the bank line must be the statement line's own account, on the side its rule gives");
  const isReturn = Array.isArray(a!.codes) && (a!.codes as string[]).includes("RC_RETURN_CONFIRMS_PROVIDER_RETURN");
  if (p.ruleCode === "JR_REPAYMENT_BY_REFERENCE") {
    const r = (ws.repaymentAllocations as Obj[]).find((x) => x.id === ids("repaymentAllocationIds")[0]);
    need(t.kind === "repayment" && t.obligationId === p.obligationId && !!r && r.statementLineId === line!.id && r.amountMinor === a!.amountMinor, `${f}.evidence`, "a repayment entry rests on the repayment allocation of its line and obligation");
  } else {
    need(t.kind === "payment" && t.intentId === p.intentId, `${f}.evidence`, "a payout entry rests on an allocation to its own payout");
    need(isReturn === (p.ruleCode === "JR_PAYOUT_RETURN_CREDIT"), `${f}.evidence`, "only a return confirmation gives a return-credit entry");
  }
}
