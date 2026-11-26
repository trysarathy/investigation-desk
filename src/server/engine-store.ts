import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  applyAction, parseWorkspaceValue,
  type Actor, type ActionOutput, type AuditEvent, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { ENGINE_ROLE, isAppRole } from "./authz";
import { AccessDenied } from "./tenant";
import { stampNow } from "./live-clock";

/**
 * Maps the engine's workspace collections to authoritative PostgreSQL rows and back.
 *
 * Load: rows of ONE organisation (RLS-scoped) → engine Workspace → `parseWorkspaceValue` (the engine's own load-time
 * integrity checks; a workspace that fails them is refused, never repaired silently).
 * Save: diff the workspace after `applyAction` against the one loaded → INSERT new records, UPDATE changed ones. A
 * record that disappears is refused: no financial record is ever deleted by an action.
 */

type Rec = { id: string } & Record<string, unknown>;
type Extract = (r: Rec) => Record<string, unknown>;
interface Spec { key: CollectionKey; table: PgTable; where?: Record<string, string>; extract: Extract }

export type CollectionKey =
  | "intents" | "providerEvents" | "evidence" | "statementLines" | "chainObservations" | "allocations" | "exceptions"
  | "cases" | "advances" | "obligations" | "repaymentAllocations" | "routes" | "quotes" | "instructions" | "holds"
  | "liquidity" | "fundingDecisions";

const str = (v: unknown) => (typeof v === "string" ? v : null);
const big = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? BigInt(v) : null);

/** Where a new evidence row came from. Set per action by the caller; never taken from client input. */
export type Provenance = "engine_action" | "seed_fictional" | "csv_import";

function specs(provenance: Provenance, importId: string | null): Spec[] {
  const evidence = (kind: string): Extract => (r) => ({
    kind, intentId: str(r.intentId), amountMinor: big(r.amountMinor), currency: str(r.currency) ?? str(r.asset), provenance, importId,
  });
  const generic = (collection: string): Spec => ({ key: collection as CollectionKey, table: t.engineRecords, where: { collection }, extract: () => ({ collection }) });
  return [
    { key: "intents", table: t.paymentIntents, extract: (r) => {
      const st = r.status as { execution: string; settlement: string; reconciliation: string };
      return { internalReference: r.internalReference, beneficiaryName: r.beneficiaryName, amountMinor: BigInt(r.amountMinor as number),
        currency: r.sourceCurrency, execution: st.execution, settlement: st.settlement, reconciliation: st.reconciliation };
    } },
    { key: "providerEvents", table: t.providerEvents, extract: (r) => ({ intentId: str(r.intentId), eventType: String(r.normalizedType ?? "unknown") }) },
    { key: "statementLines", table: t.settlementEvidence, where: { kind: "statement_line" }, extract: evidence("statement_line") },
    { key: "chainObservations", table: t.settlementEvidence, where: { kind: "chain_observation" }, extract: evidence("chain_observation") },
    { key: "evidence", table: t.settlementEvidence, where: { kind: "evidence_record" }, extract: evidence("evidence_record") },
    { key: "allocations", table: t.reconciliationRecords, extract: (r) => {
      const target = r.target as { kind: string; intentId?: string };
      return { intentId: target.kind === "payment" ? target.intentId ?? null : null, lineId: String(r.statementLineId) };
    } },
    { key: "exceptions", table: t.exceptions, extract: (r) => ({ intentId: str(r.intentId), category: String(r.category), status: String(r.status), ownerId: str(r.ownerId) }) },
    { key: "cases", table: t.investigations, extract: (r) => ({ intentId: str(r.intentId), status: String(r.status), ownerId: str(r.ownerId) }) },
    { key: "advances", table: t.fundingObligations, where: { kind: "advance" }, extract: (r) => ({ kind: "advance", intentId: str(r.intentId) }) },
    { key: "obligations", table: t.fundingObligations, where: { kind: "obligation" }, extract: () => ({ kind: "obligation", intentId: null }) },
    { key: "repaymentAllocations", table: t.repaymentAllocations, extract: () => ({}) },
    generic("routes"), generic("quotes"), generic("instructions"), generic("holds"), generic("liquidity"), generic("fundingDecisions"),
  ];
}

/** Workspace fields kept in org_engine_state.state (not record collections). */
const STATE_KEYS = ["schemaVersion", "mode", "label", "asOf", "seq", "organization", "liquidityPolicy", "idempotency"] as const;

type Cols = Record<string, unknown> & { orgId: unknown; id: unknown; ord: unknown; record: unknown };
const cols = (table: PgTable) => table as unknown as Cols;

function whereFor(table: PgTable, orgId: string, extra?: Record<string, string>) {
  const c = cols(table) as unknown as Record<string, never>;
  const conds = [eq(c.orgId, orgId)];
  for (const [k, v] of Object.entries(extra ?? {})) conds.push(eq(c[k], v));
  return and(...conds);
}

export interface LoadedWorkspace { workspace: Workspace; version: number }

/** Locks the organisation's engine state row (serialising every financial action of that organisation). */
export async function loadWorkspaceForUpdate(tx: Tx, orgId: string, lock = true): Promise<LoadedWorkspace> {
  const q = tx.select().from(t.orgEngineState).where(eq(t.orgEngineState.orgId, orgId));
  const rows = lock ? await q.for("update") : await q;
  // RLS hides the row from a non-member (e.g. a membership revoked after the request's context was resolved)
  if (rows.length !== 1) throw new AccessDenied(404, "Not found.");
  const state = rows[0].state as Record<string, unknown> & { seedActors?: Actor[]; accounting?: Record<string, unknown> };
  const ws: Record<string, unknown> = {};
  for (const k of STATE_KEYS) ws[k] = state[k];
  for (const s of specs("engine_action", null)) {
    const c = cols(s.table) as unknown as Record<string, never>;
    const r = await tx.select({ record: c.record }).from(s.table).where(whereFor(s.table, orgId, s.where)).orderBy(asc(c.ord));
    ws[s.key] = r.map((x) => x.record);
  }
  const audit = await tx.select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, orgId), eq(t.auditEvents.source, "engine"))).orderBy(asc(t.auditEvents.seq));
  ws.audit = audit.map((a): AuditEvent => ({ id: a.engineId!, at: a.at.toISOString(), actorId: (a.details as { actorId: string }).actorId, action: a.action, entityType: a.entityType ?? "", entityId: a.entityId ?? "", summary: a.summary }));
  if (state.accounting) {
    const props = await tx.select({ record: t.accountingProposals.record }).from(t.accountingProposals).where(eq(t.accountingProposals.orgId, orgId)).orderBy(asc(t.accountingProposals.ord));
    const exps = await tx.select({ record: t.accountingExports.record }).from(t.accountingExports).where(eq(t.accountingExports.orgId, orgId)).orderBy(asc(t.accountingExports.ord));
    ws.accounting = { ...state.accounting, proposals: props.map((x) => x.record), exports: exps.map((x) => x.record) };
  }
  ws.actors = [...(state.seedActors ?? []), ...(await memberActors(tx, orgId))];
  const parsed = parseWorkspaceValue(ws);
  if (!parsed.ok) throw new Error(`stored workspace failed the engine's integrity checks: ${parsed.error.code} ${parsed.error.message}`);
  return { workspace: parsed.value, version: rows[0].version };
}

/**
 * Members (including revoked ones) are engine actors, so records they made keep validating after a revocation.
 * A revoked member has no authority: no tenant context resolves for them, RLS (app_is_member) hides the org's rows
 * from their transactions, and the database triggers refuse their decisions.
 */
async function memberActors(tx: Tx, orgId: string): Promise<Actor[]> {
  const ms = await tx.select({ userId: t.organizationMemberships.userId, role: t.organizationMemberships.role, name: t.users.name })
    .from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId))
    .where(eq(t.organizationMemberships.orgId, orgId));
  return ms.filter((m) => isAppRole(m.role)).map((m) => ({ id: m.userId, name: m.name, role: ENGINE_ROLE[m.role as keyof typeof ENGINE_ROLE] }));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The org_engine_state.state of a workspace (everything but its record collections). v1: also the platform console's empty state. */
export function engineStateOf(ws: Workspace): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const k of STATE_KEYS) state[k] = (ws as unknown as Record<string, unknown>)[k];
  if (ws.accounting) { const { proposals: _p, exports: _e, ...rest } = ws.accounting as unknown as Record<string, unknown>; void _p; void _e; state.accounting = rest; }
  return state;
}

/** Persist the difference between two workspaces of the same organisation. */
export async function saveWorkspaceDiff(tx: Tx, orgId: string, before: Workspace | null, after: Workspace, opts: { provenance: Provenance; importId?: string | null; actorUserId: string | null; seedActors?: Actor[] }) {
  for (const s of specs(opts.provenance, opts.importId ?? null)) {
    const prev = new Map(((before?.[s.key] ?? []) as unknown as Rec[]).map((r, i) => [r.id, { r, i }]));
    const next = (after[s.key] ?? []) as unknown as Rec[];
    for (const id of prev.keys()) if (!next.some((r) => r.id === id)) throw new Error(`refused: ${s.key} record ${id} would be deleted`);
    for (let i = 0; i < next.length; i++) {
      const r = next[i];
      const old = prev.get(r.id);
      if (old && same(old.r, r)) continue;
      const values = { orgId, id: r.id, ord: old ? old.i : i, record: r, ...s.extract(r), updatedAt: stampNow() };
      if (old) {
        // provenance and import id describe where a record came from: they never change after insert
        const { provenance: _p, importId: _i, ...upd } = values as Record<string, unknown>;
        void _p; void _i;
        const c = cols(s.table) as unknown as Record<string, never>;
        await tx.update(s.table).set(upd as never).where(and(eq(c.orgId, orgId), eq(c.id, r.id), ...(s.where ? Object.entries(s.where).map(([k, v]) => eq(c[k], v)) : [])));
      } else {
        await tx.insert(s.table).values(values as never);
      }
    }
  }
  // accounting proposals and exports
  const acc = (w: Workspace | null) => w?.accounting;
  for (const [key, table, extract] of [
    ["proposals", t.accountingProposals, (r: Rec) => ({ status: String(r.status), rule: String(r.ruleCode) })],
    ["exports", t.accountingExports, () => ({})],
  ] as const) {
    const prev = new Map((((acc(before) as Record<string, unknown> | undefined)?.[key] ?? []) as Rec[]).map((r, i) => [r.id, { r, i }]));
    const next = (((acc(after) as Record<string, unknown> | undefined)?.[key] ?? []) as Rec[]);
    for (const id of prev.keys()) if (!next.some((r) => r.id === id)) throw new Error(`refused: accounting ${key} ${id} would be deleted`);
    for (let i = 0; i < next.length; i++) {
      const r = next[i]; const old = prev.get(r.id);
      if (old && same(old.r, r)) continue;
      const values = { orgId, id: r.id, ord: old ? old.i : i, record: r, ...extract(r), updatedAt: stampNow() };
      if (old) await tx.update(table).set(values as never).where(and(eq(table.orgId, orgId), eq(table.id, r.id)));
      else await tx.insert(table).values(values as never);
    }
  }
  // engine audit: append-only, in order
  const known = new Set((before?.audit ?? []).map((a) => a.id));
  if (before && after.audit.length < before.audit.length) throw new Error("refused: audit history would shrink");
  for (const a of after.audit) {
    if (known.has(a.id)) continue;
    await tx.insert(t.auditEvents).values({
      orgId, engineId: a.id, source: "engine", actorUserId: opts.actorUserId, action: a.action, entityType: a.entityType,
      entityId: a.entityId, summary: a.summary, at: new Date(a.at), details: { actorId: a.actorId },
    });
  }
  // the remaining state (actors are rebuilt from memberships on every load; seed actors are kept for history)
  const state = engineStateOf(after);
  if (before === null) {
    state.seedActors = opts.seedActors ?? [];
    await tx.insert(t.orgEngineState).values({ orgId, version: 1, state });
  } else {
    const cur = await tx.select({ state: t.orgEngineState.state }).from(t.orgEngineState).where(eq(t.orgEngineState.orgId, orgId));
    state.seedActors = (cur[0].state as { seedActors?: Actor[] }).seedActors ?? [];
    await tx.update(t.orgEngineState).set({ state, version: sql`${t.orgEngineState.version} + 1`, updatedAt: stampNow() }).where(eq(t.orgEngineState.orgId, orgId));
  }
}

export class EngineRefusal extends Error {
  constructor(readonly code: string, message: string, readonly field?: string) { super(message); }
}

/**
 * Run one engine action for the session user inside the caller's tenant transaction. The actor is always the
 * authenticated user: there is no parameter through which a caller could name another actor.
 */
export async function runEngineAction(tx: Tx, orgId: string, userId: string, action: WorkspaceAction, opts: { provenance?: Provenance; importId?: string } = {}): Promise<ActionOutput> {
  const { workspace } = await loadWorkspaceForUpdate(tx, orgId);
  const at = new Date(Math.max(stampNow().getTime(), Date.parse(workspace.asOf) + 1)).toISOString();
  const r = applyAction(workspace, action, { actorId: userId, at });
  if (!r.ok) throw new EngineRefusal(r.error.code, r.error.message, (r.error as { field?: string }).field);
  await saveWorkspaceDiff(tx, orgId, workspace, r.value.workspace, { provenance: opts.provenance ?? "engine_action", importId: opts.importId ?? null, actorUserId: userId });
  return r.value;
}

/** Read-only load (no lock) for page views. */
export async function readWorkspace(tx: Tx, orgId: string): Promise<Workspace> {
  return (await loadWorkspaceForUpdate(tx, orgId, false)).workspace;
}
