import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { MERCHANT_ACCOUNTS, fmtFiat, localDate, reconcile, type FiatCurrency } from "@/lib/clearline/merchant";
import { safeTheme, type SafeTheme } from "@/lib/clearline/merchant/theme";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, isAppRole, type Permission } from "./authz";
import { Decision, IdempotencyKey, canonical, idempotent, serverAudit } from "./control";
import { decideWriteoff, entityOnly, monthEnd } from "./merchant";
import { MissingEntity, loadReconcileInput } from "./merchant-store";
import { dataModeOf } from "./mapping-templates";
import { DEMO_DATA_LABEL, labelUsesUploadPipeline, type DataLabel, type DataMode } from "@/lib/clearline/data-mode";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";

/**
 * rc6 phase 7: read models and the few mutations behind the merchant reconciliation screens (/control/merchant/**).
 * Same rules as src/server/merchant.ts: a TenantContext built on the server from the session, one RLS-scoped
 * transaction per call, the permission matrix first, an Idempotency-Key on every mutation, audit on every change.
 * Read-only domain: nothing here holds, sends, converts or settles money or tokens. Test mode · illustrative data.
 */

/** rc7 phase 3b: every response and export carries the organisation's data label (dataLabel), never a fixed one. */
export const orgLabel = async (tx: Tx, orgId: string): Promise<DataLabel> => (await dataModeOf(tx, orgId)).label;
const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
const big = (v: unknown) => BigInt(typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? v : 0);
const money = (minor: unknown, cur: string) => fmtFiat(big(minor), cur as FiatCurrency);

async function load(tx: Tx, ctx: TenantContext, entityId: string) {
  try { return await loadReconcileInput(tx, ctx.orgId, entityId); } catch (e) {
    if (e instanceof MissingEntity) throw new AccessDenied(404, "Not found.");
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Stored match records (JSON parts as persisted by runReconciliation)
// ---------------------------------------------------------------------------------------------

export interface StoredTransfer { network: string; txHash: string; logIndex: number; timestamp: string; to: string; from: string; symbol: string; tokenContract: string; amountBaseUnits: string; decimals: number; confirmations: number; block: number; senderFacts: string[]; quoteId?: string; linkId?: string }
export interface StoredProviderRecord { providerPaymentId: string; statusClaim: string; displayedStatus?: string; creditedMinor: string; receivedBaseUnits: string; executedRate: string; feeMinor?: string; batchId?: string; ref: { quoteId?: string; linkId?: string } }
export interface StoredBank { status: string; batchIds: string[]; bankLineIds: string[]; batchTied: boolean; settlementVerified: boolean; bankLineLabels: string[] }
export interface StoredLedger { invoice: { orderId: string; amountMinor: string; currency: string; entityId: string; status: string }; creditedMinor: string; openBalanceMinor: string; customerOverpaymentMinor: string; balanceState: string; balanceLabel: string }
export interface StoredDifference { id: string; persistedId?: string; type: string; amountMinor: string; currency: string; reason: string; ruleId: string }
export interface StoredExplanation { decision: string; decidingStep: number; ruleId: string; differences: StoredDifference[]; history: { step: number; ruleId: string; outcome: string; detail: string }[]; attention: { owner: string; reason: string; nextStep: string } | null }

export function partsOf(m: typeof t.matchRecords.$inferSelect) {
  return {
    chain: m.chain as { transfers: StoredTransfer[]; pending: { network: string; txHash: string; logIndex: number }[] },
    provider: m.provider as { records: StoredProviderRecord[]; note: string },
    bank: m.bank as StoredBank,
    ledger: m.ledger as StoredLedger,
    explanation: m.explanation as StoredExplanation,
  };
}

// ---------------------------------------------------------------------------------------------
// Shell: white-label theme, the organisation's kind, its entities and the dates that have data
// ---------------------------------------------------------------------------------------------

export interface EntitySummary { id: string; name: string; currency: string; timezone: string; utcOffsetMinutes: number; ledger: string; days: string[]; months: string[]; dataAsOf: string | null }

/** rc7: the data label comes from the organisation's data mode ("Your data" for a live merchant, the demo label for sample data). */
export async function merchantShell(ctx: TenantContext): Promise<{ label: DataLabel; dataMode: DataMode; kind: "merchant" | "provider"; providerName: string | null; theme: SafeTheme; entities: EntitySummary[] }> {
  return tenantRead(ctx, async (tx) => {
    const r = await tx.execute(sql`select provider_name, theme, org_kind from merchant_provider_theme()`);
    const row = (r.rows[0] ?? {}) as { provider_name?: string | null; theme?: unknown; org_kind?: string };
    const kind = row.org_kind === "provider" ? "provider" : "merchant";
    const theme = safeTheme(row.theme, row.provider_name ?? null);
    const { label, dataMode } = await dataModeOf(tx, ctx.orgId);
    if (kind === "provider" || !can(ctx.role, "read")) return { label, dataMode, kind, providerName: row.provider_name ?? null, theme, entities: [] };
    return { label, dataMode, kind, providerName: row.provider_name ?? null, theme, entities: await entitySummaries(tx, ctx.orgId) };
  });
}

async function entitySummaries(tx: Tx, orgId: string): Promise<EntitySummary[]> {
  const ents = await tx.select().from(t.merchantEntities).where(eq(t.merchantEntities.orgId, orgId)).orderBy(asc(t.merchantEntities.id));
  // only the stored chain transfers' timestamps (every page's shell needs the days, not the records)
  const rows = (await tx.execute(sql`select i.entity_id, x->>'timestamp' as ts from match_records m
    join invoices i on i.org_id = m.org_id and i.order_id = m.order_id cross join lateral jsonb_array_elements(m.chain->'transfers') x
    where m.org_id = ${orgId}`)).rows as { entity_id: string; ts: string }[];
  return ents.map((e) => {
    const ts = rows.filter((r) => r.entity_id === e.id).map((r) => r.ts);
    const days = [...new Set(ts.map((x) => localDate(x, e.utcOffsetMinutes)))].sort();
    return {
      id: e.id, name: e.name, currency: e.functionalCurrency, timezone: e.timezone, utcOffsetMinutes: e.utcOffsetMinutes, ledger: e.ledger,
      days, months: [...new Set(days.map((d) => d.slice(0, 7)))], dataAsOf: ts.length ? ts.sort().at(-1)! : null,
    };
  });
}

/** The latest data instant of the organisation: ages are measured from it, so illustrative data ages the same way every day. */
export function dataAsOf(entities: EntitySummary[]): string | null {
  return entities.map((e) => e.dataAsOf).filter((x): x is string => !!x).sort().at(-1) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------------------------

/**
 * The overview's counts, one per record kind in the order Clearline follows a payment: the provider's records, the
 * chain transfers (chain facts only, never a provider's claim of one), the orders, the settlement batches and the bank
 * lines; and the decisions so far. Counts only.
 */
export async function overviewCounts(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const n = async (q: ReturnType<typeof sql>) => Number(((await tx.execute(q)).rows[0] as { n: string | number }).n);
    const o = ctx.orgId;
    const decisions = (await tx.execute(sql`select decision, count(*)::int as n from match_records where org_id = ${o} group by decision`)).rows as { decision: string; n: number }[];
    return {
      providerRecords: await n(sql`select count(*)::int as n from provider_payment_records where org_id = ${o}`),
      chainTransfers: await n(sql`select count(*)::int as n from chain_transfers where org_id = ${o} and source <> 'provider_export'`),
      orders: await n(sql`select count(*)::int as n from invoices where org_id = ${o}`),
      batches: await n(sql`select count(*)::int as n from settlement_batches where org_id = ${o}`),
      bankLines: await n(sql`select count(*)::int as n from bank_lines where org_id = ${o}`),
      decisions: Object.fromEntries(decisions.map((d) => [d.decision, d.n])) as Partial<Record<"matched" | "matched_with_difference" | "suggested_for_review" | "exception", number>>,
    };
  });
}

/** The open exceptions of some orders (id, order, reason), for pages that show where a person is needed. */
export async function openExceptionsOf(ctx: TenantContext, orderIds: string[]) {
  require(ctx, "read");
  if (orderIds.length === 0) return [];
  return tenantRead(ctx, async (tx) => tx.select({ id: t.reconExceptions.id, orderId: t.reconExceptions.orderId, reason: t.reconExceptions.reason, status: t.reconExceptions.status }).from(t.reconExceptions)
    .where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.orderId, orderIds), sql`${t.reconExceptions.status} <> 'resolved'`)).orderBy(asc(t.reconExceptions.id)));
}

/** The settlement batch ids, in the batches page's order (for a filter list; no bridge is computed). */
export async function batchIds(ctx: TenantContext): Promise<string[]> {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => (await tx.select({ batchId: t.settlementBatches.batchId }).from(t.settlementBatches).where(eq(t.settlementBatches.orgId, ctx.orgId))
    .orderBy(asc(t.settlementBatches.dayStart), asc(t.settlementBatches.batchId))).map((b) => b.batchId));
}

export async function listBatches(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const bs = await tx.select().from(t.settlementBatches).where(eq(t.settlementBatches.orgId, ctx.orgId)).orderBy(asc(t.settlementBatches.dayStart), asc(t.settlementBatches.batchId));
    const ids = [...new Set(bs.map((b) => b.entityId).filter((x): x is string => !!x))];
    const bridges = new Map<string, { tied: boolean; settlementVerified: boolean; bankLineId: string | null }>();
    for (const id of ids) for (const b of reconcile(await load(tx, ctx, id)).bridges) bridges.set(b.batchId, { tied: b.tied, settlementVerified: b.settlementVerified, bankLineId: b.bankLineId });
    const label = await orgLabel(tx, ctx.orgId);
    return bs.map((b) => ({
      label, batchId: b.batchId, entityId: b.entityId, providerDay: b.dayStart.toISOString().slice(0, 10), currency: b.currency,
      grossMinor: b.grossMinor.toString(), feesMinor: b.feesMinor.toString(), refundsMinor: b.refundsMinor.toString(), netMinor: b.netMinor.toString(),
      tied: bridges.get(b.batchId)?.tied ?? false, settlementVerified: bridges.get(b.batchId)?.settlementVerified ?? false, bankLineId: bridges.get(b.batchId)?.bankLineId ?? null,
    }));
  });
}

// ---------------------------------------------------------------------------------------------
// Payment detail extras: the evidence timeline and the audit history
// ---------------------------------------------------------------------------------------------

export interface TimelineEntry { at: string; kind: "chain" | "provider" | "settlement" | "bank" | "reconciliation" | "exception" | "note" | "evidence" | "approval" | "decision"; title: string; detail: string; independent: boolean }

export async function paymentContext(ctx: TenantContext, orderId: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const [m] = await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, orderId)));
    if (!m) throw new AccessDenied(404, "Not found.");
    const [inv] = await tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, ctx.orgId), eq(t.invoices.orderId, orderId)));
    const p = partsOf(m);
    const chainRows = p.chain.transfers.length ? await tx.select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, ctx.orgId), inArray(t.chainTransfers.txHash, p.chain.transfers.map((x) => x.txHash)))) : [];
    const batchIds = [...new Set([...p.bank.batchIds, ...p.provider.records.map((r) => r.batchId).filter((x): x is string => !!x)])];
    const batches = batchIds.length ? await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), inArray(t.settlementBatches.batchId, batchIds))) : [];
    const banks = p.bank.bankLineIds.length ? await tx.select().from(t.bankLines).where(and(eq(t.bankLines.orgId, ctx.orgId), inArray(t.bankLines.lineId, p.bank.bankLineIds))) : [];
    const exceptions = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.orderId, orderId)));
    const exIds = exceptions.map((e) => e.id);
    const notes = exIds.length ? await tx.select().from(t.reconExceptionNotes).where(and(eq(t.reconExceptionNotes.orgId, ctx.orgId), inArray(t.reconExceptionNotes.exceptionId, exIds))) : [];
    const wos = await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.orderId, orderId)));
    const subjects = [...exIds, ...wos.map((w) => w.id)];
    const reqs = subjects.length ? await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), inArray(t.approvalRequests.subjectKind, ["merchant_writeoff", "merchant_resolution"]), inArray(t.approvalRequests.subjectId, subjects))).orderBy(asc(t.approvalRequests.createdAt)) : [];
    const decisions = reqs.length ? await tx.select().from(t.approvalDecisions).where(and(eq(t.approvalDecisions.orgId, ctx.orgId), inArray(t.approvalDecisions.requestId, reqs.map((r) => r.id)))) : [];
    const audit = await tx.select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, ctx.orgId), inArray(t.auditEvents.entityId, [orderId, ...subjects, ...reqs.map((r) => r.id)]))).orderBy(desc(t.auditEvents.seq)).limit(200);
    const names = await memberNames(tx, ctx.orgId);
    const who = (id: string | null) => (id ? names.get(id) ?? "A former member" : "Clearline");
    const tl: TimelineEntry[] = [];
    const label = await orgLabel(tx, ctx.orgId);
    for (const x of p.chain.transfers) {
      const row = chainRows.find((c) => c.txHash === x.txHash && c.logIndex === x.logIndex);
      tl.push({ at: x.timestamp, kind: "chain", title: `On-chain transfer on ${x.network}`, detail: `${x.txHash} · ${x.confirmations} confirmations${row ? (row.finalised ? " · final" : " · not final") : ""}${labelUsesUploadPipeline(label) ? ` · ${row?.source ?? "chain data"}` : " · recorded fixture"}`, independent: true });
    }
    for (const r of p.provider.records) tl.push({ at: m.computedAt.toISOString(), kind: "provider", title: `Provider record ${r.providerPaymentId}`, detail: `Provider claims "${r.statusClaim}"${r.displayedStatus ? ` (shown as "${r.displayedStatus}")` : ""}; credited ${money(r.creditedMinor, inv.currency)}. A claim, not proof.`, independent: false });
    for (const b of batches) tl.push({ at: b.dayEnd.toISOString(), kind: "settlement", title: `Settlement batch ${b.batchId}`, detail: `Provider day ${b.dayStart.toISOString().slice(0, 10)} (provider day = UTC); net ${money(b.netMinor, b.currency)}. Provider report, not proof.`, independent: false });
    for (const l of banks) tl.push({ at: `${l.valueDate}T23:59:59.000Z`, kind: "bank", title: `Bank line ${l.lineId}`, detail: `${money(l.amountMinor, l.currency)} credited, value date ${l.valueDate}${l.source === "csv_import" ? " · imported, not bank-authenticated" : ""}`, independent: l.source !== "csv_import" });
    tl.push({ at: m.computedAt.toISOString(), kind: "reconciliation", title: "Reconciled by Clearline", detail: `Decision ${m.decision} at step ${m.decidingStep} (rule ${m.ruleId}); engine ${m.engineVersion}; input sha256 ${m.inputSha256.slice(0, 12)}…`, independent: false });
    for (const e of exceptions) {
      tl.push({ at: e.openedAt.toISOString(), kind: "exception", title: `Exception ${e.id} opened`, detail: `${e.reason} Owner: ${e.ownerRole}.`, independent: false });
      if (e.closedAt) tl.push({ at: e.closedAt.toISOString(), kind: "exception", title: `Exception ${e.id} resolved`, detail: "Closed.", independent: false });
    }
    for (const n of notes) tl.push({ at: n.createdAt.toISOString(), kind: n.kind === "evidence" ? "evidence" : "note", title: n.kind === "evidence" ? "Evidence attached by a person" : "Note", detail: `${who(n.authorUserId)}: ${n.body}${n.reference ? ` (ref ${n.reference})` : ""}`, independent: false });
    for (const r of reqs) tl.push({ at: r.createdAt.toISOString(), kind: "approval", title: `${r.subjectKind === "merchant_writeoff" ? "Write-off" : "Resolution"} v${r.version} submitted for approval`, detail: `By ${who(r.requestedBy)} · sha256 ${r.payloadSha256.slice(0, 12)}… · ${r.status}`, independent: false });
    for (const d of decisions) tl.push({ at: d.createdAt.toISOString(), kind: "decision", title: `${d.decision === "approve" ? "Approved" : "Rejected"} by a second person`, detail: `${who(d.decidedBy)}: ${d.reason}`, independent: false });
    tl.sort((a, b) => a.at.localeCompare(b.at));
    return {
      label, issuedAt: inv.issuedAt.toISOString(), entityId: inv.entityId, timeline: tl,
      chainRows: chainRows.map((c) => ({ txHash: c.txHash, logIndex: c.logIndex, network: c.network, block: c.block, confirmations: c.confirmations, finalised: c.finalised, source: c.source })),
      batches: batches.map((b) => ({ batchId: b.batchId, providerDay: b.dayStart.toISOString().slice(0, 10), netMinor: b.netMinor.toString(), currency: b.currency })),
      bankLines: banks.map((l) => ({ lineId: l.lineId, valueDate: l.valueDate, amountMinor: l.amountMinor.toString(), currency: l.currency, source: l.source, provenance: l.provenance })),
      requests: reqs.map((r) => ({ id: r.id, kind: r.subjectKind, subjectId: r.subjectId, version: r.version, status: r.status, requestedBy: who(r.requestedBy), payloadSha256: r.payloadSha256 })),
      audit: audit.map((a) => ({ seq: a.seq, at: a.at.toISOString(), actor: a.actorUserId ? who(a.actorUserId) : "Clearline", action: a.action, summary: a.summary })),
    };
  });
}

export async function memberNames(tx: Tx, orgId: string) {
  const ms = await tx.select({ id: t.users.id, name: t.users.name }).from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId)).where(eq(t.organizationMemberships.orgId, orgId));
  return new Map(ms.map((m) => [m.id, m.name]));
}

// ---------------------------------------------------------------------------------------------
// Exceptions: queue, detail, assign, note, attach evidence
// ---------------------------------------------------------------------------------------------

export async function exceptionsView(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const ex = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`)).orderBy(asc(t.reconExceptions.openedAt), asc(t.reconExceptions.id));
    const ids = ex.map((e) => e.id);
    const notes = ids.length ? await tx.select({ exceptionId: t.reconExceptionNotes.exceptionId, kind: t.reconExceptionNotes.kind }).from(t.reconExceptionNotes).where(and(eq(t.reconExceptionNotes.orgId, ctx.orgId), inArray(t.reconExceptionNotes.exceptionId, ids))) : [];
    const pending = ids.length ? await tx.select({ subjectId: t.approvalRequests.subjectId, version: t.approvalRequests.version }).from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_resolution"), eq(t.approvalRequests.status, "pending"), inArray(t.approvalRequests.subjectId, ids))) : [];
    const inv = ex.some((e) => e.orderId) ? await tx.select({ orderId: t.invoices.orderId, entityId: t.invoices.entityId }).from(t.invoices).where(and(eq(t.invoices.orgId, ctx.orgId), inArray(t.invoices.orderId, ex.map((e) => e.orderId).filter((x): x is string => !!x)))) : [];
    const names = await memberNames(tx, ctx.orgId);
    const recs = await tx.select({ orderId: t.matchRecords.orderId, decision: t.matchRecords.decision, ruleId: t.matchRecords.ruleId, explanation: t.matchRecords.explanation }).from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.decision, "suggested_for_review"))).orderBy(asc(t.matchRecords.orderId));
    return {
      label: await orgLabel(tx, ctx.orgId),
      exceptions: ex.map((e) => ({
        id: e.id, orderId: e.orderId, entityId: inv.find((i) => i.orderId === e.orderId)?.entityId ?? null, ownerRole: e.ownerRole,
        ownerName: e.ownerUserId ? names.get(e.ownerUserId) ?? "A former member" : null, reason: e.reason, nextStep: e.nextStep, status: e.status, openedAt: e.openedAt.toISOString(),
        evidenceCount: notes.filter((n) => n.exceptionId === e.id && n.kind === "evidence").length, noteCount: notes.filter((n) => n.exceptionId === e.id && n.kind === "note").length,
        pendingResolutionVersion: pending.find((p) => p.subjectId === e.id)?.version ?? null,
      })),
      needsReview: recs.map((r) => ({ orderId: r.orderId, ruleId: r.ruleId, attention: (r.explanation as StoredExplanation).attention })),
    };
  });
}

export async function exceptionDetail(ctx: TenantContext, exceptionId: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const [e] = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.id, exceptionId)));
    if (!e) throw new AccessDenied(404, "Not found.");
    const notes = await tx.select().from(t.reconExceptionNotes).where(and(eq(t.reconExceptionNotes.orgId, ctx.orgId), eq(t.reconExceptionNotes.exceptionId, e.id))).orderBy(asc(t.reconExceptionNotes.createdAt));
    const reqs = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_resolution"), eq(t.approvalRequests.subjectId, e.id))).orderBy(desc(t.approvalRequests.version));
    const decisions = reqs.length ? await tx.select().from(t.approvalDecisions).where(and(eq(t.approvalDecisions.orgId, ctx.orgId), inArray(t.approvalDecisions.requestId, reqs.map((r) => r.id)))) : [];
    const [m] = e.orderId ? await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, e.orderId))) : [];
    const members = await tx.select({ userId: t.users.id, name: t.users.name, role: t.organizationMemberships.role }).from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId))
      .where(and(eq(t.organizationMemberships.orgId, ctx.orgId), isNull(t.organizationMemberships.revokedAt))).orderBy(asc(t.users.name));
    const names = new Map(members.map((x) => [x.userId, x.name]));
    const who = (id: string | null) => (id ? names.get(id) ?? "A former member" : null);
    return {
      label: await orgLabel(tx, ctx.orgId), exception: { id: e.id, orderId: e.orderId, ownerRole: e.ownerRole, ownerUserId: e.ownerUserId, ownerName: who(e.ownerUserId), reason: e.reason, nextStep: e.nextStep, status: e.status, openedAt: e.openedAt.toISOString(), closedAt: e.closedAt?.toISOString() ?? null },
      match: m ? { decision: m.decision, decidingStep: m.decidingStep, ruleId: m.ruleId, differences: (m.explanation as StoredExplanation).differences, ledger: m.ledger as StoredLedger } : null,
      notes: notes.map((n) => ({ id: n.id, kind: n.kind, body: n.body, reference: n.reference, author: who(n.authorUserId), createdAt: n.createdAt.toISOString() })),
      requests: reqs.map((r) => ({
        id: r.id, version: r.version, status: r.status, requestedBy: r.requestedBy, requestedByName: who(r.requestedBy), payloadSha256: r.payloadSha256, payload: r.payload, createdAt: r.createdAt.toISOString(),
        decisions: decisions.filter((d) => d.requestId === r.id).map((d) => ({ decision: d.decision, by: who(d.decidedBy), reason: d.reason, at: d.createdAt.toISOString() })),
      })),
      members: members.filter((x) => x.role === "payment_ops" || x.role === "finance").map((x) => ({ userId: x.userId, name: x.name, role: x.role })),
    };
  });
}

async function lockException(tx: Tx, ctx: TenantContext, id: string) {
  const [e] = await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.id, id))).for("update");
  if (!e) throw new AccessDenied(404, "Not found.");
  return e;
}

export const Assignment = z.object({ ownerUserId: z.string().min(1).max(64).nullable() }).strict();

export async function assignException(ctx: TenantContext, exceptionId: string, input: z.input<typeof Assignment>, idempotencyKey: string) {
  require(ctx, "merchant_investigate");
  const a = Assignment.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_exception_assign", exceptionId, ...a }, async () => {
    const e = await lockException(tx, ctx, exceptionId);
    if (e.status === "resolved") throw new RequestRefused(409, "EXCEPTION_RESOLVED", "This exception is resolved.");
    let name: string | null = null;
    if (a.ownerUserId) {
      const [m] = await tx.select({ name: t.users.name, role: t.organizationMemberships.role }).from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId))
        .where(and(eq(t.organizationMemberships.orgId, ctx.orgId), eq(t.organizationMemberships.userId, a.ownerUserId), isNull(t.organizationMemberships.revokedAt)));
      if (!m) throw new RequestRefused(422, "NOT_A_MEMBER", "That person is not an active member of this organisation.");
      if (!isAppRole(m.role) || !can(m.role, "merchant_investigate")) throw new RequestRefused(422, "OWNER_ROLE", "Only Payment Operations or Finance can own an exception.");
      name = m.name;
    }
    await tx.update(t.reconExceptions).set({ ownerUserId: a.ownerUserId }).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.id, exceptionId)));
    await serverAudit(tx, ctx, "merchant_exception_assigned", "exception", exceptionId, a.ownerUserId ? `Assigned to ${name}` : "Unassigned", a);
    return { status: 200, body: { label: await orgLabel(tx, ctx.orgId), exceptionId, ownerUserId: a.ownerUserId, ownerName: name } };
  }));
}

export const ExceptionNote = z.object({
  kind: z.enum(["note", "evidence"]),
  body: z.string().trim().min(3).max(2000),
  reference: z.string().trim().min(1).max(120).optional(),
}).strict();

export async function addExceptionNote(ctx: TenantContext, exceptionId: string, input: z.input<typeof ExceptionNote>, idempotencyKey: string) {
  require(ctx, "merchant_investigate");
  const n = ExceptionNote.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_exception_note", exceptionId, ...n }, async () => {
    const e = await lockException(tx, ctx, exceptionId);
    if (e.status === "resolved") throw new RequestRefused(409, "EXCEPTION_RESOLVED", "This exception is resolved.");
    const [row] = await tx.insert(t.reconExceptionNotes).values({ orgId: ctx.orgId, exceptionId, kind: n.kind, body: n.body, reference: n.reference ?? null, authorUserId: ctx.userId }).returning({ id: t.reconExceptionNotes.id });
    await serverAudit(tx, ctx, n.kind === "evidence" ? "merchant_exception_evidence_attached" : "merchant_exception_noted", "exception", exceptionId,
      n.kind === "evidence" ? `Evidence attached by a person (not independent): ${n.body.slice(0, 120)}` : `Note: ${n.body.slice(0, 120)}`, { id: row.id, reference: n.reference ?? null });
    return { status: 201, body: { label: await orgLabel(tx, ctx.orgId), exceptionId, id: row.id, kind: n.kind } };
  }));
}

// ---------------------------------------------------------------------------------------------
// Resolutions: a person proposes; a DIFFERENT Approver approves the exact version by its hash (rc5 two-person flow,
// approval_requests subject_kind 'merchant_resolution', the same database triggers as every other request).
// ---------------------------------------------------------------------------------------------

export const ResolutionRequest = z.object({
  exceptionId: z.string().min(1).max(64),
  note: z.string().trim().min(10).max(2000),
  evidenceIds: z.array(z.uuid()).min(1).max(20),
}).strict();

async function resolutionBinding(tx: Tx, ctx: TenantContext, e: typeof t.reconExceptions.$inferSelect, note: string, evidenceIds: string[]) {
  const ids = [...new Set(evidenceIds)].sort();
  const ev = await tx.select().from(t.reconExceptionNotes).where(and(eq(t.reconExceptionNotes.orgId, ctx.orgId), eq(t.reconExceptionNotes.exceptionId, e.id), inArray(t.reconExceptionNotes.id, ids)));
  const found = new Map(ev.filter((x) => x.kind === "evidence").map((x) => [x.id, x]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new RequestRefused(422, "EVIDENCE_NOT_FOR_TARGET", `Evidence is not attached to ${e.id}: ${missing.join(", ")}`);
  const [m] = e.orderId ? await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, e.orderId))) : [];
  return {
    label: await orgLabel(tx, ctx.orgId), exceptionId: e.id,
    exception: { id: e.id, orderId: e.orderId, ownerRole: e.ownerRole, reason: e.reason, nextStep: e.nextStep },
    match: m ? { decision: m.decision, ruleId: m.ruleId, inputSha256: m.inputSha256, engineVersion: m.engineVersion } : null,
    note,
    evidence: ids.map((id) => { const x = found.get(id)!; return { id, body: x.body, reference: x.reference, sha256: sha256(canonical({ id, body: x.body, reference: x.reference, author: x.authorUserId, at: x.createdAt.toISOString() })) }; }),
  };
}

export async function requestMerchantResolution(ctx: TenantContext, input: z.input<typeof ResolutionRequest>, idempotencyKey: string) {
  require(ctx, "merchant_investigate");
  const p = ResolutionRequest.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_resolution_request", ...p }, async () => {
    const prior = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "merchant_resolution"), eq(t.approvalRequests.subjectId, p.exceptionId))).for("update");
    const e = await lockException(tx, ctx, p.exceptionId);
    if (e.status === "resolved") throw new RequestRefused(409, "EXCEPTION_RESOLVED", "This exception is resolved.");
    const binding = await resolutionBinding(tx, ctx, e, p.note, p.evidenceIds);
    for (const r of prior.filter((x) => x.status === "pending")) await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, r.id)));
    const version = prior.reduce((mx, r) => Math.max(mx, r.version), 0) + 1;
    const payload = { ...binding, version };
    const payloadSha256 = sha256(canonical(payload));
    const [req] = await tx.insert(t.approvalRequests).values({ orgId: ctx.orgId, subjectKind: "merchant_resolution", subjectId: e.id, version, payload, payloadSha256, requestedBy: ctx.userId }).returning();
    await tx.update(t.reconExceptions).set({ status: "in_review" }).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.id, e.id)));
    await serverAudit(tx, ctx, "merchant_resolution_requested", "exception", e.id, `Resolution v${version} for ${e.id} submitted for a second person's approval (sha256 ${payloadSha256.slice(0, 12)}…)`, { requestId: req.id, evidenceIds: binding.evidence.map((x) => x.id) });
    return { status: 201, body: { label: await orgLabel(tx, ctx.orgId), requestId: req.id, exceptionId: e.id, version, payloadSha256, payload } };
  }));
}

export async function decideMerchantResolution(ctx: TenantContext, requestId: string, input: z.infer<typeof Decision>, idempotencyKey: string) {
  require(ctx, "decide_approval");
  const d = Decision.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!z.uuid().safeParse(requestId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "merchant_resolution_decide", requestId, ...d }, async () => {
    const [req] = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId))).for("update");
    if (!req || req.subjectKind !== "merchant_resolution") throw new AccessDenied(404, "Not found.");
    if (req.requestedBy === ctx.userId) throw new RequestRefused(409, "MAKER_CANNOT_APPROVE", "You proposed this resolution; another approver must decide it.");
    if (req.status !== "pending") throw new RequestRefused(409, "REQUEST_CLOSED", `This request is ${req.status}.`);
    if (req.payloadSha256 !== d.payloadSha256) throw new RequestRefused(409, "VERSION_MISMATCH", "The proposal changed since you reviewed it. Review the current version.");
    const e = await lockException(tx, ctx, req.subjectId);
    const pl = req.payload as Awaited<ReturnType<typeof resolutionBinding>> & { version: number };
    if (d.decision === "approve") {
      if (e.status === "resolved") throw new RequestRefused(409, "STALE_RESOLUTION", "The exception was closed by a later reconciliation. Ask for a new version.");
      const now = await resolutionBinding(tx, ctx, e, pl.note, pl.evidence.map((x) => x.id));
      if (canonical({ ...now, version: pl.version }) !== canonical(pl)) throw new RequestRefused(409, "STALE_RESOLUTION", "The exception, its payment or the cited evidence changed after this request was made. Ask for a new version.");
    }
    await tx.insert(t.approvalDecisions).values({ orgId: ctx.orgId, requestId, decidedBy: ctx.userId, decision: d.decision, reason: d.reason, payloadSha256: d.payloadSha256 });
    const status = d.decision === "approve" ? "approved" : "rejected";
    await tx.update(t.approvalRequests).set({ status, closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId)));
    if (e.status !== "resolved") {
      await tx.update(t.reconExceptions).set(d.decision === "approve" ? { status: "resolved", closedAt: new Date() } : { status: "open" }).where(and(eq(t.reconExceptions.orgId, ctx.orgId), eq(t.reconExceptions.id, e.id)));
    }
    await serverAudit(tx, ctx, d.decision === "approve" ? "merchant_resolution_approved" : "merchant_resolution_rejected", "exception", e.id,
      `${d.decision === "approve" ? "Approved" : "Rejected"} resolution v${req.version} of ${e.id} by a second person: ${d.reason}`, { requestId, payloadSha256: d.payloadSha256 });
    return { status: 200, body: { label: await orgLabel(tx, ctx.orgId), requestId, exceptionId: e.id, status } };
  }));
}

/** One decision endpoint for both merchant request kinds; each kind keeps its own server function and checks. */
export async function decideMerchantApproval(ctx: TenantContext, requestId: string, input: z.infer<typeof Decision>, idempotencyKey: string) {
  require(ctx, "decide_approval");
  if (!z.uuid().safeParse(requestId).success) throw new AccessDenied(404, "Not found.");
  const kind = await tenantRead(ctx, async (tx) => (await tx.select({ k: t.approvalRequests.subjectKind }).from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId))))[0]?.k);
  if (kind === "merchant_writeoff") return decideWriteoff(ctx, requestId, input, idempotencyKey);
  if (kind === "merchant_resolution") return decideMerchantResolution(ctx, requestId, input, idempotencyKey);
  throw new AccessDenied(404, "Not found.");
}

export async function listMerchantApprovals(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const reqs = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), inArray(t.approvalRequests.subjectKind, ["merchant_writeoff", "merchant_resolution"]))).orderBy(desc(t.approvalRequests.createdAt)).limit(200);
    const decisions = reqs.length ? await tx.select().from(t.approvalDecisions).where(and(eq(t.approvalDecisions.orgId, ctx.orgId), inArray(t.approvalDecisions.requestId, reqs.map((r) => r.id)))) : [];
    const proposed = await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), eq(t.writeoffProposals.status, "proposed"))).orderBy(asc(t.writeoffProposals.id));
    const names = await memberNames(tx, ctx.orgId);
    const who = (id: string | null) => (id ? names.get(id) ?? "A former member" : "—");
    return {
      label: await orgLabel(tx, ctx.orgId),
      requests: reqs.map((r) => {
        const pl = r.payload as { orderId?: string; exception?: { orderId: string | null }; amountMinor?: string; currency?: string };
        return {
          id: r.id, kind: r.subjectKind as "merchant_writeoff" | "merchant_resolution", subjectId: r.subjectId, orderId: pl.orderId ?? pl.exception?.orderId ?? null, version: r.version, status: r.status,
          requestedBy: r.requestedBy, requestedByName: who(r.requestedBy), payloadSha256: r.payloadSha256, payload: r.payload, createdAt: r.createdAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null,
          amount: pl.amountMinor && pl.currency ? money(pl.amountMinor, pl.currency) : null,
          decisions: decisions.filter((d) => d.requestId === r.id).map((d) => ({ decision: d.decision, by: who(d.decidedBy), reason: d.reason, at: d.createdAt.toISOString() })),
        };
      }),
      writeoffsToSubmit: proposed.map((w) => ({ id: w.id, orderId: w.orderId, amount: money(w.amountMinor, w.currency) })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Month-end
// ---------------------------------------------------------------------------------------------

const AGE_BUCKETS = [{ label: "Under 1 day", max: 1 }, { label: "1–7 days", max: 7 }, { label: "8–30 days", max: 30 }, { label: "Over 30 days", max: Infinity }] as const;

export async function monthEndView(ctx: TenantContext, entityId: string, month: string, asOf: string | null) {
  const base = await monthEnd(ctx, entityId, month);
  return tenantRead(ctx, async (tx) => {
    // the entity's own facts and its batches' currencies (the full reconcile input is not needed here)
    const ent = await entityOnly(tx, ctx, entityId);
    const batchCurrencies = (await tx.select({ c: t.settlementBatches.currency }).from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), eq(t.settlementBatches.entityId, entityId))).orderBy(asc(t.settlementBatches.batchId))).map((b) => b.c);
    const recs = await tx.select({ m: t.matchRecords }).from(t.matchRecords).innerJoin(t.invoices, and(eq(t.invoices.orgId, t.matchRecords.orgId), eq(t.invoices.orderId, t.matchRecords.orderId)))
      .where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.invoices.entityId, entityId))).orderBy(asc(t.matchRecords.orderId));
    const off = ent.utcOffsetMinutes;
    const receivable = new Map<string, { batchId: string; orderIds: string[]; creditedMinor: bigint; reason: string }>();
    for (const { m } of recs) {
      const p = partsOf(m);
      if (!p.chain.transfers.some((x) => localDate(x.timestamp, off).startsWith(month))) continue;
      for (const r of p.provider.records) {
        if (p.bank.settlementVerified || !r.creditedMinor || big(r.creditedMinor) === 0n) continue;
        const k = r.batchId ?? "(no settlement batch)";
        const g = receivable.get(k) ?? { batchId: k, orderIds: [], creditedMinor: 0n, reason: r.batchId ? "In a batch that is not yet verified against a bank line." : p.bank.status === "held_by_provider" ? "Held by the provider; in no settlement." : "In no settlement yet." };
        g.orderIds.push(m.orderId); g.creditedMinor += big(r.creditedMinor); receivable.set(k, g);
      }
    }
    const orders = new Set(recs.map((r) => r.m.orderId));
    const ex = (await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), sql`${t.reconExceptions.status} <> 'resolved'`))).filter((e) => e.orderId && orders.has(e.orderId));
    const ref = asOf ? Date.parse(asOf) : Date.now();
    const ages = AGE_BUCKETS.map((b, i) => ({ label: b.label, ids: ex.filter((e) => { const d = Math.max(0, (ref - e.openedAt.getTime()) / 86_400_000); return d < b.max && (i === 0 || d >= AGE_BUCKETS[i - 1].max); }).map((e) => e.id) }));
    const fx = (await tx.select().from(t.fxRates).where(eq(t.fxRates.orgId, ctx.orgId)).orderBy(desc(t.fxRates.observedAt))).filter((r) => r.observedAt.toISOString().startsWith(month) || !r.entityId || r.entityId === entityId);
    const foreign = [...new Set(batchCurrencies.filter((c) => c !== ent.functionalCurrency))];
    return {
      ...base,
      receivableFromProvider: [...receivable.values()].map((g) => ({ ...g, creditedMinor: g.creditedMinor.toString() })),
      exceptionAges: ages,
      fx: { functionalCurrency: ent.functionalCurrency, foreignCurrencies: foreign, rates: fx.slice(0, 6).map((r) => ({ pair: r.pair, rate: r.rate, source: r.source, observedAt: r.observedAt.toISOString() })) },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Evidence pack (per payment, per month): JSON, CSV (formula cells escaped) and a PDF summary
// ---------------------------------------------------------------------------------------------

/** One CSV cell. Text starting with = + - @ (or a tab/CR) is prefixed with ' so a spreadsheet never runs it. */
export function csvCell(v: unknown): string {
  let s = (v === null || v === undefined ? "" : String(v)).replace(/[\r\n\u2028\u2029]+/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n']|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export type PackScope = { kind: "payment"; orderId: string } | { kind: "month"; entityId: string; month: string };
export const PackFormat = z.enum(["json", "csv", "pdf"]);

export async function packData(tx: Tx, ctx: TenantContext, scope: PackScope) {
  let orderIds: string[];
  let entityId: string;
  if (scope.kind === "payment") {
    const [inv] = await tx.select().from(t.invoices).where(and(eq(t.invoices.orgId, ctx.orgId), eq(t.invoices.orderId, scope.orderId)));
    const [m] = await tx.select({ id: t.matchRecords.orderId }).from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.matchRecords.orderId, scope.orderId)));
    if (!inv || !m) throw new AccessDenied(404, "Not found.");
    orderIds = [scope.orderId]; entityId = inv.entityId;
  } else {
    if (!/^\d{4}-\d{2}$/.test(scope.month)) throw new RequestRefused(422, "BAD_MONTH", "Use YYYY-MM.");
    const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, scope.entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    entityId = ent.id;
    const rows = await tx.select({ m: t.matchRecords, inv: t.invoices }).from(t.matchRecords).innerJoin(t.invoices, and(eq(t.invoices.orgId, t.matchRecords.orgId), eq(t.invoices.orderId, t.matchRecords.orderId)))
      .where(and(eq(t.matchRecords.orgId, ctx.orgId), eq(t.invoices.entityId, ent.id))).orderBy(asc(t.matchRecords.orderId));
    orderIds = rows.filter(({ m, inv }) => { const ts = partsOf(m).chain.transfers.map((x) => localDate(x.timestamp, ent.utcOffsetMinutes)); return ts.length ? ts.some((d) => d.startsWith(scope.month)) : inv.issuedAt.toISOString().startsWith(scope.month); }).map(({ m }) => m.orderId);
  }
  const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
  const recs = orderIds.length ? await tx.select().from(t.matchRecords).where(and(eq(t.matchRecords.orgId, ctx.orgId), inArray(t.matchRecords.orderId, orderIds))).orderBy(asc(t.matchRecords.orderId)) : [];
  const parts = recs.map((m) => ({ m, p: partsOf(m) }));
  const txHashes = parts.flatMap(({ p }) => p.chain.transfers.map((x) => x.txHash));
  const chain = txHashes.length ? await tx.select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, ctx.orgId), inArray(t.chainTransfers.txHash, txHashes))).orderBy(asc(t.chainTransfers.blockTime)) : [];
  const ppIds = parts.flatMap(({ p }) => p.provider.records.map((r) => r.providerPaymentId));
  const provider = ppIds.length ? await tx.select().from(t.providerPaymentRecords).where(and(eq(t.providerPaymentRecords.orgId, ctx.orgId), inArray(t.providerPaymentRecords.providerPaymentId, ppIds))).orderBy(asc(t.providerPaymentRecords.providerPaymentId)) : [];
  const blIds = [...new Set(parts.flatMap(({ p }) => p.bank.bankLineIds))];
  const bank = blIds.length ? await tx.select().from(t.bankLines).where(and(eq(t.bankLines.orgId, ctx.orgId), inArray(t.bankLines.lineId, blIds))).orderBy(asc(t.bankLines.lineId)) : [];
  const bIds = [...new Set(parts.flatMap(({ p }) => p.bank.batchIds))];
  const batches = bIds.length ? await tx.select().from(t.settlementBatches).where(and(eq(t.settlementBatches.orgId, ctx.orgId), inArray(t.settlementBatches.batchId, bIds))).orderBy(asc(t.settlementBatches.batchId)) : [];
  const diffs = orderIds.length ? await tx.select().from(t.differences).where(and(eq(t.differences.orgId, ctx.orgId), inArray(t.differences.orderId, orderIds))).orderBy(asc(t.differences.id)) : [];
  const exs = orderIds.length ? await tx.select().from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, ctx.orgId), inArray(t.reconExceptions.orderId, orderIds))).orderBy(asc(t.reconExceptions.id)) : [];
  const notes = exs.length ? await tx.select().from(t.reconExceptionNotes).where(and(eq(t.reconExceptionNotes.orgId, ctx.orgId), inArray(t.reconExceptionNotes.exceptionId, exs.map((e) => e.id)))).orderBy(asc(t.reconExceptionNotes.createdAt)) : [];
  const wos = orderIds.length ? await tx.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, ctx.orgId), inArray(t.writeoffProposals.orderId, orderIds))).orderBy(asc(t.writeoffProposals.id)) : [];
  const subjects = [...exs.map((e) => e.id), ...wos.map((w) => w.id)];
  const reqs = subjects.length ? await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), inArray(t.approvalRequests.subjectKind, ["merchant_writeoff", "merchant_resolution"]), inArray(t.approvalRequests.subjectId, subjects))).orderBy(asc(t.approvalRequests.createdAt)) : [];
  const decisions = reqs.length ? await tx.select().from(t.approvalDecisions).where(and(eq(t.approvalDecisions.orgId, ctx.orgId), inArray(t.approvalDecisions.requestId, reqs.map((r) => r.id)))) : [];
  const audit = await tx.select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, ctx.orgId), inArray(t.auditEvents.entityId, [...orderIds, ...subjects, ...reqs.map((r) => r.id), entityId, ...bIds]))).orderBy(asc(t.auditEvents.seq)).limit(2000);
  const names = await memberNames(tx, ctx.orgId);
  const who = (id: string | null) => (id ? names.get(id) ?? "A former member" : "Clearline");
  const label = await orgLabel(tx, ctx.orgId);
  return {
    label, organisation: ctx.orgName, entity: { id: ent.id, name: ent.name, currency: ent.functionalCurrency, timezone: ent.timezone, ledger: ent.ledger },
    scope, cutOffNote: "provider day = UTC",
    note: labelUsesUploadPipeline(label) ? "Read-only evidence. Provider statuses are claims, not proof; each chain fact names its source; imported bank statements are not bank-authenticated; nothing moves money."
      : "Read-only evidence. Provider statuses are claims, not proof; chain data is a recorded fixture; nothing moves money.",
    payments: parts.map(({ m, p }) => ({ orderId: m.orderId, decision: m.decision, decidingStep: m.decidingStep, ruleId: m.ruleId, engineVersion: m.engineVersion, inputSha256: m.inputSha256, ledger: p.ledger, bank: p.bank, explanation: { history: p.explanation.history, differences: p.explanation.differences } })),
    chainProof: chain.map((c) => ({ network: c.network, txHash: c.txHash, logIndex: c.logIndex, block: c.block, blockTime: c.blockTime.toISOString(), tokenContract: c.tokenContract, from: c.fromAddress, to: c.toAddress, amountBaseUnits: c.amountBaseUnits, decimals: c.decimals, confirmations: c.confirmations, finalised: c.finalised, source: c.source })),
    providerRecords: provider.map((r) => ({ providerPaymentId: r.providerPaymentId, statusClaim: r.statusClaim, creditedMinor: r.creditedMinor?.toString() ?? null, currency: r.creditedCurrency, executedRate: r.executedRate, feeMinor: r.feeMinor?.toString() ?? null, batchId: r.batchId, note: "a claim, not proof", record: r.record })),
    settlementBatches: batches.map((b) => ({ batchId: b.batchId, providerDay: b.dayStart.toISOString().slice(0, 10), currency: b.currency, grossMinor: b.grossMinor.toString(), feesMinor: b.feesMinor.toString(), refundsMinor: b.refundsMinor.toString(), netMinor: b.netMinor.toString(), targetBankAccount: b.targetBankAccount })),
    bankLines: bank.map((l) => ({ lineId: l.lineId, account: l.account, valueDate: l.valueDate, amountMinor: l.amountMinor.toString(), currency: l.currency, source: l.source, provenance: l.provenance, label: l.source === "csv_import" ? "imported, not bank-authenticated" : null })),
    differences: diffs.map((d) => ({ id: d.id, orderId: d.orderId, type: d.type, amountMinor: d.amountMinor.toString(), currency: d.currency, reason: d.reason, ruleId: d.ruleId })),
    exceptions: exs.map((e) => ({ id: e.id, orderId: e.orderId, owner: e.ownerRole, reason: e.reason, nextStep: e.nextStep, status: e.status, openedAt: e.openedAt.toISOString(), closedAt: e.closedAt?.toISOString() ?? null,
      notes: notes.filter((n) => n.exceptionId === e.id).map((n) => ({ kind: n.kind, body: n.body, reference: n.reference, by: who(n.authorUserId), at: n.createdAt.toISOString(), class: n.kind === "evidence" ? "attached by a person, not independent" : "note" })) })),
    writeoffs: wos.map((w) => ({ id: w.id, orderId: w.orderId, amountMinor: w.amountMinor.toString(), currency: w.currency, status: w.status })),
    approvals: reqs.map((r) => ({ id: r.id, kind: r.subjectKind, subjectId: r.subjectId, version: r.version, status: r.status, requestedBy: who(r.requestedBy), payloadSha256: r.payloadSha256, createdAt: r.createdAt.toISOString(),
      decisions: decisions.filter((d) => d.requestId === r.id).map((d) => ({ decision: d.decision, by: who(d.decidedBy), reason: d.reason, payloadSha256: d.payloadSha256, at: d.createdAt.toISOString() })) })),
    auditTrail: audit.map((a) => ({ seq: a.seq, at: a.at.toISOString(), actor: a.actorUserId ? who(a.actorUserId) : "Clearline", action: a.action, entity: `${a.entityType ?? ""}:${a.entityId ?? ""}`, summary: a.summary })),
  };
}

type Pack = Awaited<ReturnType<typeof packData>>;

function packCsv(p: Pack): string {
  const rows: unknown[][] = [["section", "id", "order_id", "field_1", "field_2", "field_3", "field_4", "detail", "marking"]];
  const M = p.label;
  rows.push(["meta", p.scope.kind === "payment" ? p.scope.orderId : `${p.entity.id} ${p.scope.month}`, "", p.organisation, p.entity.name, p.entity.currency, p.cutOffNote, p.note, M]);
  for (const x of p.payments) rows.push(["payment", x.orderId, x.orderId, x.decision, `step ${x.decidingStep}`, x.ruleId, x.ledger.balanceLabel, `input sha256 ${x.inputSha256}; engine ${x.engineVersion}`, M]);
  for (const c of p.chainProof) rows.push(["chain_proof", c.txHash, "", c.network, `block ${c.block}`, `${c.amountBaseUnits} base units (${c.decimals} dp)`, `${c.confirmations} confirmations${c.finalised ? " final" : " not final"}`, `to ${c.to}; contract ${c.tokenContract}; ${c.source}`, M]);
  for (const r of p.providerRecords) rows.push(["provider_record", r.providerPaymentId, "", r.statusClaim, r.creditedMinor, r.currency, r.batchId, "provider claim, not proof", M]);
  for (const b of p.settlementBatches) rows.push(["settlement_batch", b.batchId, "", b.providerDay, b.grossMinor, b.feesMinor, b.netMinor, `refunds ${b.refundsMinor} ${b.currency}`, M]);
  for (const l of p.bankLines) rows.push(["bank_line", l.lineId, "", l.valueDate, l.amountMinor, l.currency, l.source, l.label ?? l.provenance ?? "", M]);
  for (const d of p.differences) rows.push(["difference", d.id, d.orderId, d.type, d.amountMinor, d.currency, d.ruleId, d.reason, M]);
  for (const e of p.exceptions) {
    rows.push(["exception", e.id, e.orderId, e.owner, e.status, e.openedAt, e.closedAt, `${e.reason} Next: ${e.nextStep}`, M]);
    for (const n of e.notes) rows.push([n.kind === "evidence" ? "exception_evidence" : "exception_note", e.id, e.orderId, n.by, n.at, n.reference, n.class, n.body, M]);
  }
  for (const w of p.writeoffs) rows.push(["writeoff", w.id, w.orderId, w.amountMinor, w.currency, w.status, "", "", M]);
  for (const a of p.approvals) {
    rows.push(["approval_request", a.id, "", a.kind, a.subjectId, `v${a.version}`, a.status, `requested by ${a.requestedBy}; sha256 ${a.payloadSha256}`, M]);
    for (const d of a.decisions) rows.push(["approval_decision", a.id, "", d.decision, d.by, d.at, d.payloadSha256, d.reason, M]);
  }
  for (const a of p.auditTrail) rows.push(["audit", String(a.seq), "", a.at, a.actor, a.action, a.entity, a.summary, M]);
  return csv(rows);
}

/** Helvetica (WinAnsi) cannot draw every character: map the few we use and replace anything else. */
function winAnsi(s: string): string {
  return s.replace(/[→]/g, "->").replace(/[−–—]/g, "-").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=").replace(/[…]/g, "...").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[⏎]/g, " ")
    .replace(/[^\x20-\x7E -ÿ]/g, "?");
}

async function packPdf(p: Pack): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const LABEL = p.label;
  doc.setTitle(`Clearline evidence pack — ${LABEL}`);
  doc.setSubject(LABEL);
  doc.setProducer(LABEL === DEMO_DATA_LABEL ? "Clearline (demo build)" : labelUsesUploadPipeline(LABEL) ? "Clearline" : "Clearline (test mode)");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const footer = () => page.drawText(winAnsi(`${LABEL} · powered by Clearline · read-only evidence, nothing moves money`), { x: M, y: 24, size: 8, font, color: rgb(0.34, 0.32, 0.29) });
  footer();
  const line = (text: string, o: { size?: number; b?: boolean; gap?: number } = {}) => {
    const size = o.size ?? 9;
    const f = o.b ? bold : font;
    const words = winAnsi(text).split(" ");
    let cur = "";
    const flush = () => {
      if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; footer(); }
      page.drawText(cur, { x: M, y, size, font: f, color: rgb(0.08, 0.08, 0.08) });
      y -= size + 4;
      cur = "";
    };
    for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(next, size) > W - 2 * M && cur) { flush(); cur = w; } else cur = next; }
    if (cur) flush();
    y -= o.gap ?? 0;
  };
  line(LABEL.toUpperCase(), { b: true, size: 10, gap: 4 });
  line(`Evidence pack — ${p.scope.kind === "payment" ? `payment ${p.scope.orderId}` : `${p.entity.name} (${p.entity.id}), ${p.scope.month}`}`, { size: 15, b: true, gap: 4 });
  line(`${p.organisation} · entity ${p.entity.id} · ${p.entity.currency} · ${p.cutOffNote}`);
  line(p.note, { gap: 8 });
  const head = (s: string) => { y -= 4; line(s, { b: true, size: 11, gap: 2 }); };
  head(`Payments (${p.payments.length})`);
  for (const x of p.payments) line(`${x.orderId}: ${x.decision} at step ${x.decidingStep} (rule ${x.ruleId}); invoice ${money(x.ledger.invoice.amountMinor, x.ledger.invoice.currency)}, credited ${money(x.ledger.creditedMinor, x.ledger.invoice.currency)}, ${x.ledger.balanceLabel}; bank ${x.bank.status}${x.bank.batchTied ? ", batch tied" : ""}.`);
  head(`Chain proof (${p.chainProof.length})${labelUsesUploadPipeline(LABEL) ? "" : " — recorded fixture"}`);
  for (const c of p.chainProof.slice(0, 60)) line(`${c.network} ${c.txHash} log ${c.logIndex}, block ${c.block}, ${c.blockTime}, ${c.confirmations} confirmations${c.finalised ? " (final)" : " (not final)"}, to ${c.to}`);
  if (p.chainProof.length > 60) line(`… ${p.chainProof.length - 60} more in the CSV and JSON files.`);
  head(`Provider records (${p.providerRecords.length}) — claims, not proof`);
  for (const r of p.providerRecords.slice(0, 60)) line(`${r.providerPaymentId}: claims "${r.statusClaim}", credited ${r.creditedMinor && r.currency ? money(r.creditedMinor, r.currency) : "—"}, batch ${r.batchId ?? "none"}`);
  if (p.providerRecords.length > 60) line(`… ${p.providerRecords.length - 60} more in the CSV and JSON files.`);
  head("Settlement and bank");
  for (const b of p.settlementBatches) line(`Batch ${b.batchId} (provider day ${b.providerDay}): gross ${money(b.grossMinor, b.currency)} − fees ${money(b.feesMinor, b.currency)} − refunds ${money(b.refundsMinor, b.currency)} = net ${money(b.netMinor, b.currency)}`);
  for (const l of p.bankLines) line(`Bank line ${l.lineId}: ${money(l.amountMinor, l.currency)}, value date ${l.valueDate}${l.label ? ` (${l.label})` : ""}`);
  head(`Differences (${p.differences.length})`);
  for (const d of p.differences) line(`${d.orderId} ${d.type} ${money(d.amountMinor, d.currency)}: ${d.reason}`);
  head(`Exceptions (${p.exceptions.length})`);
  for (const e of p.exceptions) { line(`${e.id} (${e.status}, owner ${e.owner}): ${e.reason}`); for (const n of e.notes) line(`  ${n.kind === "evidence" ? "Evidence (attached by a person)" : "Note"} by ${n.by}: ${n.body}${n.reference ? ` [${n.reference}]` : ""}`); }
  head(`Approvals (${p.approvals.length}) — two people, bound by hash`);
  for (const a of p.approvals) { line(`${a.kind === "merchant_writeoff" ? "Write-off" : "Resolution"} ${a.subjectId} v${a.version}: ${a.status}; requested by ${a.requestedBy}; sha256 ${a.payloadSha256}`); for (const d of a.decisions) line(`  ${d.decision} by ${d.by} at ${d.at}: ${d.reason}`); }
  head(`Audit trail (${p.auditTrail.length})`);
  for (const a of p.auditTrail.slice(-80)) line(`${a.at} ${a.actor} ${a.action}: ${a.summary}`);
  return doc.save({ useObjectStreams: false });
}

/** rc8 founder decision 3: Finance, an Approver or an Admin only (merchant_export), whatever the scope. */
export async function evidencePack(ctx: TenantContext, scope: PackScope, format: z.infer<typeof PackFormat>) {
  require(ctx, "merchant_export");
  return tenantTx(ctx, async (tx) => {
    const p = await packData(tx, ctx, scope);
    const body: string | Uint8Array = format === "json" ? JSON.stringify(p, null, 2) + "\n" : format === "csv" ? packCsv(p) : await packPdf(p);
    const digest = sha256(body);
    const id = scope.kind === "payment" ? scope.orderId : `${scope.entityId}-${scope.month}`;
    await serverAudit(tx, ctx, "merchant_evidence_pack_exported", scope.kind === "payment" ? "payment" : "merchant_entity", scope.kind === "payment" ? scope.orderId : scope.entityId, `Evidence pack exported (${format}, ${id}, sha256 ${digest.slice(0, 12)}…)`, { sha256: digest, format, scope });
    return { body, sha256: digest, fileName: `clearline-evidence-${ctx.orgSlug}-${id.replace(/[^A-Za-z0-9_-]/g, "")}.${format}`,
      contentType: format === "json" ? "application/json; charset=utf-8" : format === "csv" ? "text/csv; charset=utf-8" : "application/pdf" };
  });
}

// ---------------------------------------------------------------------------------------------
// Accounting export: a FILE only (sandbox / demo company); posting rules pending sign-off; nothing posts
// ---------------------------------------------------------------------------------------------

export const SANDBOX_EXPORT_LABEL = "sandbox/demo company only; posting rules pending sign-off";

/** rc8 founder decision 3: Finance, an Approver or an Admin only (merchant_export; was Finance only). */
export async function journalExport(ctx: TenantContext, entityId: string, month: string, format: "csv" | "json") {
  require(ctx, "merchant_export");
  const me = await monthEnd(ctx, entityId, month);
  return tenantTx(ctx, async (tx) => {
    const [ent] = await tx.select().from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    const journals = me.journals.filter((j) => j.status === "proposed");
    type L = { side: string; account: keyof typeof MERCHANT_ACCOUNTS; amountMinor: string; orderId?: string; batchId?: string };
    type Ev = { entryDate: string | null; memo: string; ruleId: string; requiresApprovalOf: string | null; orderIds?: string[]; txHashes?: string[]; batchId?: string; bankLineId?: string };
    const doc = {
      label: await orgLabel(tx, ctx.orgId), marking: SANDBOX_EXPORT_LABEL, target: ent.ledger === "quickbooks" ? "QuickBooks journal import layout (sandbox file; no connection)" : ent.ledger === "xero" ? "Xero manual journal import layout (sandbox file; no connection)" : "Generic journal layout (sandbox file)",
      organisation: ctx.orgName, entity: { id: ent.id, name: ent.name, currency: ent.functionalCurrency }, month, postingRuleStatus: "pending_sign_off",
      entries: journals.map((j) => {
        const ev = j.evidence as Ev;
        return { id: j.id, pattern: j.pattern, entryDate: ev.entryDate, memo: ev.memo, ruleId: ev.ruleId, requiresApprovalOf: ev.requiresApprovalOf, postingRuleStatus: j.postingRuleStatus,
          evidence: { orderIds: ev.orderIds ?? [], txHashes: ev.txHashes ?? [], batchId: ev.batchId ?? null, bankLineId: ev.bankLineId ?? null },
          lines: (j.lines as L[]).map((l) => ({ side: l.side, accountCode: l.account, accountName: MERCHANT_ACCOUNTS[l.account] ?? l.account, amountMinor: l.amountMinor, amount: money(l.amountMinor, ent.functionalCurrency) })) };
      }),
    };
    const body = format === "json" ? JSON.stringify(doc, null, 2) + "\n" : csv([
      ["journal_id", "entry_date", "account_code", "account_name", "debit", "credit", "currency", "memo", "pattern", "rule_id", "requires_approval_of", "evidence", "posting_rule_status", "marking"],
      ...doc.entries.flatMap((e) => e.lines.map((l) => {
        const amt = money(l.amountMinor, ent.functionalCurrency).split(" ")[1];
        return [`SANDBOX-${e.id}`, e.entryDate, l.accountCode, l.accountName, l.side === "debit" ? amt : "", l.side === "credit" ? amt : "", ent.functionalCurrency, e.memo, e.pattern, e.ruleId, e.requiresApprovalOf, [...e.evidence.orderIds, ...e.evidence.txHashes, e.evidence.batchId, e.evidence.bankLineId].filter(Boolean).join(" "), "pending_sign_off", `${doc.label}; ${SANDBOX_EXPORT_LABEL}`];
      })),
    ]);
    const digest = sha256(body);
    await serverAudit(tx, ctx, "merchant_journal_file_exported", "merchant_entity", entityId, `Journal file exported for ${entityId} ${month} (${format}, ${journals.length} proposals, ${SANDBOX_EXPORT_LABEL}; sha256 ${digest.slice(0, 12)}…)`, { sha256: digest, format, month, journalIds: journals.map((j) => j.id) });
    return { body, sha256: digest, fileName: `clearline-journals-${ctx.orgSlug}-${entityId}-${month}.${format}`, contentType: format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8", count: journals.length };
  });
}

// ---------------------------------------------------------------------------------------------
// Organisation kind (where a signed-in member lands) and the payments list with the five parts kept apart
// ---------------------------------------------------------------------------------------------

export async function orgKind(ctx: TenantContext): Promise<{ kind: "merchant" | "provider"; hasProvider: boolean }> {
  return tenantRead(ctx, async (tx) => {
    const r = (await tx.execute(sql`select provider_name, org_kind from merchant_provider_theme()`)).rows[0] as { provider_name?: string | null; org_kind?: string } | undefined;
    return { kind: r?.org_kind === "provider" ? "provider" : "merchant", hasProvider: r?.org_kind === "merchant" && !!r.provider_name };
  });
}

export interface PartsSummary { chain: { transfers: number; pending: number; networks: string[] }; provider: { claims: string[]; records: number }; bank: { status: string; tied: boolean; verified: boolean; imported: boolean }; ledger: { state: string; label: string } }

/** Per order: what each of the five parts says on its own (never merged into one status). */
export async function partsSummaries(ctx: TenantContext): Promise<Map<string, PartsSummary>> {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const ms = await tx.select().from(t.matchRecords).where(eq(t.matchRecords.orgId, ctx.orgId));
    return new Map(ms.map((m) => {
      const p = partsOf(m);
      return [m.orderId, {
        chain: { transfers: p.chain.transfers.length, pending: p.chain.pending.length, networks: [...new Set(p.chain.transfers.map((x) => x.network))] },
        provider: { claims: [...new Set(p.provider.records.map((r) => r.statusClaim))], records: p.provider.records.length },
        bank: { status: p.bank.status, tied: p.bank.batchTied, verified: p.bank.settlementVerified, imported: p.bank.bankLineLabels.length > 0 },
        ledger: { state: p.ledger.balanceState, label: p.ledger.balanceLabel },
      }];
    }));
  });
}
