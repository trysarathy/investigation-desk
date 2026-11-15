/**
 * rc3 — per-scenario reset for the five guided sample cases.
 *
 * `resetScenario(ws, scenario, ctx)` restores ONE guided case's records to their original sample state
 * and leaves every other case, every record the person created, and the global data (routes, liquidity,
 * policy, actors, clock) untouched. It is pure: it returns a new workspace or a typed error and never
 * changes its input.
 *
 * Ownership (how the engine decides what "belongs" to a case) — computed, never guessed from names:
 * - Anchors: each sample payment intent belongs to its scenario; a sample advance to its payment's
 *   scenario. An intent or advance the person created is its own anchor ("user").
 * - Every other record (quotes, instructions, provider events, evidence, statement lines, allocations,
 *   exceptions, cases, holds, chain observations, decisions, obligations, repayment allocations)
 *   belongs to the union of the anchors of the records it references by id, transitively.
 * - A record that belongs ONLY to case N is part of case N's state (including activity the person
 *   added on it: a statement line matched to its payment, a note, attached evidence, a resolution) and
 *   is replaced by the sample version. Audit events are never removed (history); one
 *   `scenario.reset` audit event is appended.
 *
 * Refusals (precondition_failed, nothing changed) — so a reset can never leave a dangling or
 * contradictory reference:
 * - REFERENCED_BY_OTHER_RECORDS: a record links case N AND another case or a person-created intent or
 *   advance (e.g. a correction intent for the returned payout, an advance on the case's payment, a
 *   statement line whose candidates span two payouts). Remove the link's cause or reset the whole sample.
 * - REFERENCE_IN_USE: an active payout the person created uses the internal reference that the restored
 *   payout would make active again (one active intent per internal reference).
 * - SCENARIO_NOT_IN_WORKSPACE / ID_CONFLICT: the workspace was not derived from the sample (its ids do
 *   not line up), so a per-case reset cannot be proven safe.
 *
 * Clock (review m-2): the workspace clock is neither rewound nor moved; ctx.at must be ≥ asOf and the audit
 * event is stamped at asOf. Restored records keep their sample timestamps, and the clock rules advance_clock
 * applies (quote expiry, execution-date expiry, provider timeout, missing statement, overdue repayment) are
 * applied to the restored records at the current clock, so a case restored "late" is in the state the clock
 * implies (e.g. s5 overdue with its FD_OUTSTANDING_AFTER_DUE_DATE exception). Nothing else changes.
 */
import { applyClockRules } from "./actions";
import { syncAccounting } from "./accounting/actions";
import type { JournalProposal } from "./accounting/types";
import { deriveAdvanceState } from "./funding";
import { formatMinor } from "./money";
import { SAMPLE_SCENARIOS, sampleWorkspace, type SampleScenario } from "./sample";
import { parseWorkspaceValue } from "./serialize";
import { Tx, isIsoInstant, referenceTokens } from "./tx";
import type { ActionContext, AuditEvent, Result, Workspace } from "./types";

/** Collections whose records carry sequential ids and can belong to a guided case. */
const COLLECTIONS = [
  "intents", "quotes", "instructions", "providerEvents", "evidence", "statementLines", "allocations", "exceptions",
  "cases", "holds", "chainObservations", "advances", "fundingDecisions", "obligations", "repaymentAllocations",
] as const;
type Collection = (typeof COLLECTIONS)[number];
type Rec = { id: string } & Record<string, unknown>;

export type ResetBlockCode = "NOT_A_SAMPLE_SCENARIO" | "SCENARIO_NOT_IN_WORKSPACE" | "ID_CONFLICT" | "REFERENCED_BY_OTHER_RECORDS" | "REFERENCE_IN_USE" | "ACCOUNTING_ENTRIES_RECORDED" | "RESETTABLE";

export interface ResetCheck {
  allowed: boolean;
  code: ResetBlockCode;
  reason: string;
  /** The scenario key the input resolved to (when it resolved). */
  scenario?: SampleScenario;
  /** Ids of the records that block the reset (empty when allowed). */
  blockers: string[];
}

export interface ResetScenarioOutput {
  workspace: Workspace;
  scenario: SampleScenario;
  /** Ids removed from the workspace (case N's current records, including activity added on them). */
  removedIds: string[];
  /** Ids restored from the sample (case N's original records). */
  restoredIds: string[];
  audit: AuditEvent[];
}

let pristineCache: Workspace | undefined;
const pristine = (): Workspace => (pristineCache ??= sampleWorkspace());

const seqOf = (id: string): number => {
  const m = /_(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

function records(ws: Workspace): { coll: Collection; rec: Rec }[] {
  const out: { coll: Collection; rec: Rec }[] = [];
  for (const coll of COLLECTIONS) for (const rec of ws[coll] as unknown as Rec[]) out.push({ coll, rec });
  return out;
}

/** Every id (other than its own) that a record mentions as an exact string value, at any depth. */
function linksOf(rec: Rec, known: Set<string>): string[] {
  const out = new Set<string>();
  const stack: unknown[] = [rec];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string") {
      if (v !== rec.id && known.has(v)) out.add(v);
    } else if (v && typeof v === "object") for (const c of Array.isArray(v) ? v : Object.values(v)) stack.push(c);
  }
  return [...out];
}

/** Anchor-based ownership: id → set of roots (scenario keys, "user:<id>"). */
function ownership(ws: Workspace): Map<string, Set<string>> {
  const p = pristine();
  const sampleIntentScenario = new Map(p.intents.map((i) => [i.id, i.scenario]));
  const all = records(ws);
  const known = new Set(all.map((r) => r.rec.id));
  const roots = new Map<string, Set<string>>(all.map((r) => [r.rec.id, new Set<string>()]));
  for (const { coll, rec } of all) {
    if (coll === "intents") {
      const sc = sampleIntentScenario.get(rec.id);
      roots.get(rec.id)!.add(sc && rec.scenario === sc ? sc : `user:${rec.id}`);
    }
    if (coll === "advances") {
      const sampleAdv = p.advances.find((a) => a.id === rec.id && a.intentId === rec.intentId);
      const sc = sampleAdv ? sampleIntentScenario.get(sampleAdv.intentId) : undefined;
      roots.get(rec.id)!.add(sc ?? `user:${rec.id}`);
    }
  }
  const links = new Map(all.map((r) => [r.rec.id, linksOf(r.rec, known)]));
  // A statement line is also linked by its reference text, exactly as reconciliation reads it: a provider
  // payment id links it to that instruction, a repayment reference to that obligation (a provider report
  // recorded as evidence has no allocation or exception that would otherwise link it).
  const byPpid = new Map(ws.instructions.filter((i) => i.providerPaymentId).map((i) => [i.providerPaymentId!.toUpperCase(), i.id]));
  const byRef = new Map(ws.obligations.map((o) => [o.reference.toUpperCase(), o.id]));
  for (const l of ws.statementLines)
    for (const t of referenceTokens(l.reference)) {
      const hit = byPpid.get(t) ?? byRef.get(t);
      if (hit) links.get(l.id)!.push(hit);
    }
  // Fixed point: roots flow both ways along every reference (a record and what it references share an owner).
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, ls] of links)
      for (const l of ls) {
        const a = roots.get(id)!;
        const b = roots.get(l)!;
        for (const x of b) if (!a.has(x)) { a.add(x); changed = true; }
        for (const x of a) if (!b.has(x)) { b.add(x); changed = true; }
      }
  }
  return roots;
}

/** Internal (tests): owner set of every record id in the workspace (scenario keys and "user:<id>"). */
export function scenarioOwnership(ws: Workspace): Map<string, Set<string>> {
  return ownership(ws);
}

function resolveScenario(input: string): SampleScenario | undefined {
  if (Object.prototype.hasOwnProperty.call(SAMPLE_SCENARIOS, input)) return input as SampleScenario;
  const p = pristine();
  const byIntent = p.intents.find((i) => i.id === input)?.scenario;
  const byCase = p.intents.find((i) => i.id === p.cases.find((c) => c.id === input)?.intentId)?.scenario;
  const sc = byIntent ?? byCase;
  return sc && Object.prototype.hasOwnProperty.call(SAMPLE_SCENARIOS, sc) ? (sc as SampleScenario) : undefined;
}

const ACTIVE = (exec: string) => !["cancelled", "expired", "failed", "returned"].includes(exec);

interface Plan { check: ResetCheck; remove: Set<string>; restore: { coll: Collection; rec: Rec }[]; bridgeRemove: Set<string>; bridgeRestore: JournalProposal[] }

/**
 * rc4: journal proposals belong to the owners of the evidence they rest on (they are not in COLLECTIONS, so the
 * five cases' ownership — and their fingerprints — are unchanged). Returns each proposal's owner set.
 */
function proposalOwners(ws: Workspace, roots: Map<string, Set<string>>): { p: JournalProposal; owners: Set<string> }[] {
  const known = new Set(roots.keys());
  return (ws.accounting?.proposals ?? []).map((p) => {
    const owners = new Set<string>();
    for (const id of linksOf(p as unknown as Rec, known)) for (const o of roots.get(id) ?? []) owners.add(o);
    return { p, owners };
  });
}

function plan(ws: Workspace, input: string): Plan {
  const none = { remove: new Set<string>(), restore: [], bridgeRemove: new Set<string>(), bridgeRestore: [] };
  const scenario = typeof input === "string" ? resolveScenario(input) : undefined;
  if (!scenario) return { check: { allowed: false, code: "NOT_A_SAMPLE_SCENARIO", reason: `"${String(input)}" is not one of the five guided sample cases (${Object.keys(SAMPLE_SCENARIOS).join(", ")}), or their payment or case id.`, blockers: [] }, ...none };
  const p = pristine();
  const pIntent = p.intents.find((i) => i.scenario === scenario)!;
  const cur = ws.intents.find((i) => i.id === pIntent.id);
  if (!cur || cur.scenario !== scenario || cur.idempotencyKey !== pIntent.idempotencyKey || ws.organization.id !== p.organization.id)
    return { check: { allowed: false, code: "SCENARIO_NOT_IN_WORKSPACE", reason: `This workspace does not contain the sample's ${scenario} payment (${pIntent.id}); reset the whole workspace to the sample instead.`, scenario, blockers: [] }, ...none };

  const pRoots = ownership(p);
  const restore = records(p).filter((r) => { const s = pRoots.get(r.rec.id)!; return s.size === 1 && s.has(scenario); });
  const roots = ownership(ws);
  const all = records(ws);
  const remove = new Set(all.filter((r) => { const s = roots.get(r.rec.id)!; return s.size === 1 && s.has(scenario); }).map((r) => r.rec.id));
  // rc4: the case's journal proposals. Proposed, rejected or superseded ones are replaced like the case's records;
  // an approved, exported or posted one blocks the reset (it may already be in the customer's ledger).
  const mine = proposalOwners(ws, roots).filter((x) => x.owners.has(scenario));
  const bridgeRemove = new Set(mine.filter((x) => x.owners.size === 1).map((x) => x.p.id));
  const pPeriods = new Map((p.accounting?.periods ?? []).map((x) => [x.id, x]));
  const samePeriod = (id: string) => { const a = pPeriods.get(id); const b = ws.accounting?.periods.find((x) => x.id === id); return !!a && !!b && a.from === b.from && a.to === b.to && b.status === "open"; };
  const bridgeRestore = proposalOwners(p, pRoots).filter((x) => x.owners.size === 1 && x.owners.has(scenario) && samePeriod(x.p.periodId)).map((x) => x.p);
  const bridge = { bridgeRemove, bridgeRestore };
  const crossing = [...all.filter((r) => { const s = roots.get(r.rec.id)!; return s.has(scenario) && s.size > 1; }).map((r) => r.rec.id), ...mine.filter((x) => x.owners.size > 1).map((x) => x.p.id)];
  if (crossing.length) {
    const ownersOf = (id: string) => roots.get(id) ?? mine.find((x) => x.p.id === id)?.owners ?? new Set<string>();
    const others = [...new Set(crossing.flatMap((id) => [...ownersOf(id)]).filter((x) => x !== scenario))];
    // Name the person-created anchors first: they are what the person has to change.
    const users = others.filter((x) => x.startsWith("user:")).map((x) => x.slice(5));
    const blockers = [...users, ...crossing.filter((id) => !users.includes(id))].slice(0, 25);
    return { check: { allowed: false, code: "REFERENCED_BY_OTHER_RECORDS", reason: `Case ${scenario} cannot be reset on its own: ${crossing.length} record(s) also belong to ${others.map((x) => (x.startsWith("user:") ? `your record ${x.slice(5)}` : `case ${x}`)).join(", ")}. Resetting would leave them pointing at changed data. Reset the whole workspace to the sample instead.`, scenario, blockers }, remove, restore, ...bridge };
  }
  // Review F4: an entry that was ever in an export file (exported, posted, or withdrawn after export) keeps its id for
  // good, so the file always re-renders to its recorded hash and a journal id is never reused.
  const named = new Set((ws.accounting?.exports ?? []).flatMap((x) => x.proposalIds ?? []));
  const decided = mine.filter((x) => ["approved", "exported", "posted"].includes(x.p.status) || !!x.p.export || named.has(x.p.id)).map((x) => x.p.id);
  if (decided.length)
    return { check: { allowed: false, code: "ACCOUNTING_ENTRIES_RECORDED", reason: `Case ${scenario} cannot be reset: its journal entr${decided.length === 1 ? "y" : "ies"} ${decided.join(", ")} ${decided.length === 1 ? "is" : "are"} approved, or ${decided.length === 1 ? "was" : "were"} in an export file and may already be in your ledger. Reject an approved entry first; an exported one keeps its journal id for good. Or reset the whole workspace.`, scenario, blockers: decided }, remove, restore, ...bridge };
  const restoredIds = new Set([...restore.map((r) => r.rec.id), ...bridgeRestore.map((x) => x.id)]);
  const idClash = [...all.map((r) => r.rec.id).filter((id) => !remove.has(id)), ...(ws.accounting?.proposals ?? []).map((x) => x.id).filter((id) => !bridgeRemove.has(id))].filter((id) => restoredIds.has(id));
  if (idClash.length)
    return { check: { allowed: false, code: "ID_CONFLICT", reason: `Ids of case ${scenario}'s sample records are used by other records (${idClash.slice(0, 5).join(", ")}); this workspace was not derived from the sample.`, scenario, blockers: idClash.slice(0, 25) }, remove, restore, ...bridge };
  const restoredActive = restore.filter((r) => r.coll === "intents" && ACTIVE((r.rec.status as { execution: string }).execution)).map((r) => r.rec.internalReference);
  const inUse = ws.intents.filter((i) => !remove.has(i.id) && ACTIVE(i.status.execution) && restoredActive.includes(i.internalReference)).map((i) => i.id);
  if (inUse.length)
    return { check: { allowed: false, code: "REFERENCE_IN_USE", reason: `Your active payment ${inUse.join(", ")} uses internal reference ${restoredActive.join(", ")}, which the restored case would make active again (one active payment per internal reference).`, scenario, blockers: inUse }, remove, restore, ...bridge };
  return { check: { allowed: true, code: "RESETTABLE", reason: `Case ${scenario} can be reset: ${remove.size + bridgeRemove.size} record(s) replaced by ${restore.length + bridgeRestore.length} sample record(s); other cases and your own records are unchanged.`, scenario, blockers: [] }, remove, restore, ...bridge };
}

/** Whether `scenario` (a SampleScenario key, or its sample payment id or case id) can be reset now, and why not. */
export function canResetScenario(ws: Workspace, scenario: string): ResetCheck {
  // Parse a copy: parsing may migrate an older workspace in place (review M-1); the input is never changed.
  const valid = parseWorkspaceValue(structuredClone(ws));
  if (!valid.ok) return { allowed: false, code: "SCENARIO_NOT_IN_WORKSPACE", reason: valid.error.message, blockers: [] };
  return plan(valid.value, scenario).check;
}

/**
 * Restore one guided case to its original sample state. Pure; returns a new workspace.
 * Errors: invalid_field (bad workspace or ctx.at earlier than the clock), unauthorized_actor (unknown
 * actor), not_found (NOT_A_SAMPLE_SCENARIO), precondition_failed (every other refusal; the message
 * starts with the ResetBlockCode, e.g. "REFERENCED_BY_OTHER_RECORDS: …", and entityId is the first blocker).
 */
export function resetScenario(input: Workspace, scenario: string, ctx: ActionContext): Result<ResetScenarioOutput> {
  // Parse a copy: parsing may migrate an older workspace in place (review M-1); the input is never changed.
  const valid = parseWorkspaceValue(structuredClone(input));
  if (!valid.ok) return valid;
  const ws = valid.value;
  if (!ctx || !isIsoInstant(ctx.at) || Date.parse(ctx.at) < Date.parse(ws.asOf))
    return { ok: false, error: { code: "invalid_field", message: "ctx.at must be an ISO-8601 instant not earlier than the workspace clock (asOf).", field: "at" } };
  if (!ws.actors.some((a) => a.id === ctx.actorId)) return { ok: false, error: { code: "unauthorized_actor", message: "Unknown actor.", field: "actorId" } };
  const { check, remove, restore, bridgeRemove, bridgeRestore } = plan(ws, scenario);
  if (!check.allowed)
    return { ok: false, error: { code: check.code === "NOT_A_SAMPLE_SCENARIO" ? "not_found" : "precondition_failed", message: `${check.code}: ${check.reason}${check.blockers.length ? ` Blocking records: ${check.blockers.join(", ")}.` : ""}`, entityId: check.blockers[0] } };
  const sc = check.scenario!;
  const out = structuredClone(ws);
  for (const coll of COLLECTIONS) {
    const kept = (out[coll] as unknown as Rec[]).filter((r) => !remove.has(r.id));
    const back = restore.filter((r) => r.coll === coll).map((r) => structuredClone(r.rec));
    (out as unknown as Record<string, Rec[]>)[coll] = [...kept, ...back].sort((a, b) => seqOf(a.id) - seqOf(b.id));
  }
  // Idempotency keys follow their intents (kept in intent creation order).
  const p = pristine();
  const entries = Object.entries(out.idempotency).filter(([, v]) => !remove.has(v.intentId));
  for (const [k, v] of Object.entries(p.idempotency)) if (restore.some((r) => r.coll === "intents" && r.rec.id === v.intentId)) entries.push([k, { ...v }]);
  entries.sort((a, b) => seqOf(a[1].intentId) - seqOf(b[1].intentId));
  out.idempotency = {};
  for (const [k, v] of entries) Object.defineProperty(out.idempotency, k, { value: v, enumerable: true, writable: true, configurable: true });
  // rc4: the case's journal proposals follow its records (only when the workspace has the sample's open period).
  if (out.accounting && (bridgeRemove.size || bridgeRestore.length))
    out.accounting.proposals = [...out.accounting.proposals.filter((x) => !bridgeRemove.has(x.id)), ...bridgeRestore.map((x) => structuredClone(x))].sort((a, b) => seqOf(a.id) - seqOf(b.id));

  // Review m-2: a reset is not a clock action, so the clock is NOT moved (ctx.at is validated, ≥ asOf, but the
  // event is stamped at the workspace clock). The restored records are brought to the state the CURRENT clock
  // implies, with the same rules advance_clock applies (quote expiry, execution-date expiry, provider
  // timeout, missing statement, overdue repayment), scoped to the restored records so nothing else changes.
  // Re-review R-B1: the restored ids come from the CURRENT sample. A workspace saved by an earlier sample
  // version (v2, efabe6a) may have a lower id counter than the highest restored id (rc3's s2 records reach
  // seq 180; a v2-saved sample stops at 164), so later actions would generate the same ids again. The counter
  // is raised past every restored id; the skipped numbers are simply never used. On an rc3-derived workspace
  // the restored ids are already at or below the counter, so nothing changes.
  out.seq = Math.max(out.seq, ...[...restore.map((r) => r.rec.id), ...bridgeRestore.map((x) => x.id)].map(seqOf).filter((n) => n < Number.MAX_SAFE_INTEGER));
  const tx = new Tx(out, { actorId: ctx.actorId, at: out.asOf });
  const restoredIds = new Set(restore.map((r) => r.rec.id));
  applyClockRules(tx, restoredIds);
  for (const adv of tx.ws.advances) if (restoredIds.has(adv.id)) adv.state = deriveAdvanceState(tx.ws, adv.id, tx.ws.asOf);
  // rc4: a proposal elsewhere whose evidence the restored records changed is superseded, as after any action.
  syncAccounting(tx);
  // Review m-4: the audit event names every removed record, and each removed statement line's own line id,
  // account, direction and amount, so the trail can say exactly what a person's reset discarded.
  const removedIds = [...remove, ...bridgeRemove].sort((a, b) => seqOf(a) - seqOf(b));
  const lines = ws.statementLines.filter((l) => remove.has(l.id)).map((l) => `${l.id} = ${l.lineId} @ ${l.accountRef}, ${l.direction} ${formatMinor(l.amountMinor, l.currency)}`);
  tx.log("scenario.reset", "scenario", sc,
    `Guided case ${sc} reset to the sample: ${remove.size + bridgeRemove.size} record(s) replaced by ${restore.length + bridgeRestore.length}; other cases and person-created records unchanged. ` +
    `Removed: ${removedIds.join(", ") || "none"}.` + (lines.length ? ` Removed statement lines: ${lines.join("; ")}.` : ""));
  const after = tx.ws;
  const again = parseWorkspaceValue(after);
  if (!again.ok) return again;
  return { ok: true, value: { workspace: after, scenario: sc, removedIds, restoredIds: [...restore.map((r) => r.rec.id), ...bridgeRestore.map((x) => x.id)], audit: tx.audit } };
}
