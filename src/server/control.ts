import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildCaseReport, canResolveCase, canResolveException, caseReportToCsv, evidenceTimelineFor, investigate,
  type ActionOutput, type TargetRef, type Workspace, type WorkspaceAction,
} from "@/lib/clearline";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { ACTION_PERMISSION, can, type Permission } from "./authz";
import { EngineRefusal, readWorkspace, runEngineAction } from "./engine-store";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";

/**
 * Clearline Control services. Every function takes a TenantContext built on the server from the session
 * (src/server/tenant.ts:resolveTenant) and runs inside one RLS-scoped transaction. Financial rules live in the engine;
 * this layer adds permissions, idempotency, approvals and audit.
 */

export { RequestRefused };

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}

const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
/** Read-only views: one REPEATABLE READ snapshot (a page never sees half of a concurrent action). */
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });

export async function serverAudit(tx: Tx, ctx: TenantContext, action: string, entityType: string | null, entityId: string | null, summary: string, details?: unknown) {
  await tx.insert(t.auditEvents).values({ orgId: ctx.orgId, source: "server", actorUserId: ctx.userId, action, entityType, entityId, summary, at: new Date(), details: details ?? null });
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Canonical JSON (sorted keys) so a hash identifies content, not key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------------------------
// Idempotency: the same key + same request replays the stored response; the same key + a different request is a 409.
// ---------------------------------------------------------------------------------------------

export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);

export async function idempotent<T>(tx: Tx, ctx: TenantContext, key: string, request: unknown, run: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }> {
  const fingerprint = sha256(canonical({ userId: ctx.userId, request }));
  // serialise concurrent requests with the same key inside this organisation
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.orgId + "|" + key}))`);
  const [prev] = await tx.select().from(t.idempotencyRecords).where(and(eq(t.idempotencyRecords.orgId, ctx.orgId), eq(t.idempotencyRecords.key, key)));
  if (prev) {
    if (prev.fingerprint !== fingerprint) throw new RequestRefused(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request.");
    return { status: prev.statusCode, body: prev.response as T, replayed: true };
  }
  const r = await run();
  await tx.insert(t.idempotencyRecords).values({ orgId: ctx.orgId, key, userId: ctx.userId, fingerprint, statusCode: r.status, response: r.body as object });
  return { ...r, replayed: false };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export async function overview(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const openExceptions = ws.exceptions.filter((e) => e.status !== "resolved");
    const openCases = ws.cases.filter((c) => c.status !== "resolved");
    const pending = await tx.select({ n: sql<number>`count(*)::int` }).from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.status, "pending")));
    return {
      org: { slug: ctx.orgSlug, name: ctx.orgName },
      payments: ws.intents.length,
      openExceptions: openExceptions.length,
      openInvestigations: openCases.length,
      pendingApprovals: pending[0]?.n ?? 0,
      settlementVerified: ws.intents.filter((i) => i.status.settlement === "verified").length,
      returned: ws.intents.filter((i) => i.status.execution === "returned").length,
    };
  });
}

export async function listPayments(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    return ws.intents.map((i) => ({
      id: i.id, reference: i.internalReference, beneficiary: i.beneficiaryName, amountMinor: i.amountMinor, currency: i.sourceCurrency,
      execution: i.status.execution, settlement: i.status.settlement, reconciliation: i.status.reconciliation,
      openExceptions: ws.exceptions.filter((e) => e.intentId === i.id && e.status !== "resolved").length,
    }));
  });
}

export async function paymentDetail(ctx: TenantContext, intentId: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const v = investigate(ws, intentId);
    if (!v.ok) throw new AccessDenied(404, "Not found.");
    const caseRows = await tx.select().from(t.investigations).where(and(eq(t.investigations.orgId, ctx.orgId), eq(t.investigations.intentId, intentId)));
    const approvals = await tx.select().from(t.approvalRequests).where(eq(t.approvalRequests.orgId, ctx.orgId)).orderBy(desc(t.approvalRequests.createdAt));
    const exceptionIds = new Set(ws.exceptions.filter((e) => e.intentId === intentId).map((e) => e.id));
    const caseIds = new Set(caseRows.map((c) => c.id));
    return {
      view: v.value,
      exceptions: ws.exceptions.filter((e) => e.intentId === intentId),
      cases: caseRows.map((c) => ({ ...(c.record as object), priority: c.priority, nextAction: c.nextAction, dueDate: c.dueDate })),
      approvals: approvals.filter((a) => exceptionIds.has(a.subjectId.split(":")[1]) || caseIds.has(a.subjectId.split(":")[1])).map(approvalView),
      members: ws.actors.filter((a) => !a.id.startsWith("usr_")).map((a) => ({ id: a.id, name: a.name, role: a.role })),
      // rc5 UI (read-only): the engine's evidence timeline for this payment, its evidence records (what a resolution
      // request may cite) and display names for every actor id in the history (members and fictional seed actors).
      timeline: evidenceTimelineFor(ws, intentId),
      evidence: ws.evidence.filter((e) => e.intentId === intentId),
      actorNames: Object.fromEntries(ws.actors.map((a) => [a.id, a.name])) as Record<string, string>,
    };
  });
}

/** rc5 UI (read-only): every exception and investigation of this organisation, for the work queue and case list. */
export async function workQueue(ctx: TenantContext) {
  require(ctx, "read");
  return tenantTx(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const caseRows = await tx.select({ id: t.investigations.id, priority: t.investigations.priority, nextAction: t.investigations.nextAction, dueDate: t.investigations.dueDate })
      .from(t.investigations).where(eq(t.investigations.orgId, ctx.orgId));
    const control = new Map(caseRows.map((c) => [c.id, c]));
    const names = new Map(ws.actors.map((a) => [a.id, a.name]));
    const ref = (intentId?: string) => ws.intents.find((i) => i.id === intentId)?.internalReference ?? null;
    return {
      exceptions: ws.exceptions.map((e) => ({
        id: e.id, intentId: e.intentId ?? null, reference: ref(e.intentId), category: e.category, severity: e.severity, status: e.status,
        ownerName: e.ownerId ? names.get(e.ownerId) ?? null : null, dueDate: e.dueDate ?? null, requiredAction: e.requiredAction, caseId: e.caseId ?? null,
      })),
      cases: ws.cases.map((c) => ({
        id: c.id, intentId: c.intentId ?? null, reference: ref(c.intentId), title: c.title, status: c.status,
        ownerName: c.ownerId ? names.get(c.ownerId) ?? null : null, priority: control.get(c.id)?.priority ?? "normal",
        nextAction: control.get(c.id)?.nextAction ?? null, dueDate: control.get(c.id)?.dueDate ?? null, updatedAt: c.updatedAt,
      })),
    };
  });
}

/** rc5 UI (read-only): this organisation's members and their roles (revoked members are listed as revoked). */
export async function listMembers(ctx: TenantContext) {
  require(ctx, "read");
  return tenantTx(ctx, (tx) => tx.select({ userId: t.organizationMemberships.userId, name: t.users.name, email: t.users.email, role: t.organizationMemberships.role, revokedAt: t.organizationMemberships.revokedAt })
    .from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId))
    .where(eq(t.organizationMemberships.orgId, ctx.orgId)).orderBy(t.users.name));
}

export async function auditHistory(ctx: TenantContext, limit = 200) {
  require(ctx, "read");
  return tenantRead(ctx, (tx) => tx.select().from(t.auditEvents).where(eq(t.auditEvents.orgId, ctx.orgId)).orderBy(desc(t.auditEvents.seq)).limit(Math.min(limit, 1000)));
}

// ---------------------------------------------------------------------------------------------
// Engine actions (investigation, accounting) — permission matrix first, then the engine's own rules
// ---------------------------------------------------------------------------------------------

export async function runAction(ctx: TenantContext, action: WorkspaceAction, idempotencyKey: string) {
  const perm = ACTION_PERMISSION[action.type];
  if (!perm) throw new RequestRefused(422, "ACTION_NOT_AVAILABLE", `"${action.type}" is not available in Clearline Control.`);
  require(ctx, perm);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, idempotencyKey, action, async () => {
    const out = await engine(tx, ctx, action);
    if (action.type === "add_note") {
      await tx.insert(t.investigationNotes).values({ orgId: ctx.orgId, targetKind: action.target.kind, targetId: action.target.id, authorUserId: ctx.userId, body: action.text });
    }
    return { status: 200, body: summary(out) };
  }));
}

async function engine(tx: Tx, ctx: TenantContext, action: WorkspaceAction): Promise<ActionOutput> {
  try { return await runEngineAction(tx, ctx.orgId, ctx.userId, action); }
  catch (e) {
    if (e instanceof EngineRefusal) throw new RequestRefused(422, e.code, e.message);
    throw e;
  }
}

const summary = (o: ActionOutput) => ({ outcome: o.outcome, createdIds: o.createdIds, audit: o.audit.map((a) => ({ id: a.id, action: a.action, summary: a.summary })) });

export const CaseDetails = z.object({
  priority: z.enum(["low", "normal", "high", "urgent"]),
  nextAction: z.string().trim().min(1).max(500).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict();

/** Priority, next action and due date (Control fields; audited). */
export async function updateCaseDetails(ctx: TenantContext, caseId: string, input: z.infer<typeof CaseDetails>) {
  require(ctx, "investigate");
  const d = CaseDetails.parse(input);
  return tenantTx(ctx, async (tx) => {
    const r = await tx.update(t.investigations).set({ priority: d.priority, nextAction: d.nextAction, dueDate: d.dueDate, updatedAt: new Date() })
      .where(and(eq(t.investigations.orgId, ctx.orgId), eq(t.investigations.id, caseId))).returning({ id: t.investigations.id });
    if (r.length === 0) throw new AccessDenied(404, "Not found.");
    await serverAudit(tx, ctx, "case_details_updated", "case", caseId, `Priority ${d.priority}; due ${d.dueDate ?? "none"}; next action ${d.nextAction ?? "none"}`, d);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Maker-checker: a proposed resolution is an immutable, hashed version; a different Approver decides it.
// ---------------------------------------------------------------------------------------------

export const ResolutionProposal = z.object({
  target: z.discriminatedUnion("kind", [z.object({ kind: z.literal("case"), id: z.string().min(1).max(64) }), z.object({ kind: z.literal("exception"), id: z.string().min(1).max(64) })]),
  note: z.string().trim().min(10).max(2000),
  evidenceRefs: z.array(z.string().min(1).max(64)).min(1).max(50),
}).strict();
export type ResolutionProposal = z.infer<typeof ResolutionProposal>;

const subjectId = (target: TargetRef) => `${target.kind}:${target.id}`;

function approvalView(a: typeof t.approvalRequests.$inferSelect) {
  return { id: a.id, subject: a.subjectId, version: a.version, status: a.status, requestedBy: a.requestedBy, payloadSha256: a.payloadSha256, payload: a.payload, createdAt: a.createdAt, closedAt: a.closedAt };
}

/**
 * Every evidence reference must name a record of this organisation that concerns the TARGET's payment (or is attached
 * to the target), and the target must be resolvable now. Returns what the approval binds: the content hash of every
 * cited record and the target's current state, so an approval is for exactly the evidence that was reviewed.
 */
function bindEvidence(ws: Workspace, p: ResolutionProposal) {
  const target = p.target.kind === "case" ? ws.cases.find((c) => c.id === p.target.id) : ws.exceptions.find((e) => e.id === p.target.id);
  if (!target) throw new AccessDenied(404, "Not found.");
  const intentId = target.intentId;
  const attached = new Set<string>((target as { supportingEvidenceIds?: string[] }).supportingEvidenceIds ?? []);
  if (p.target.kind === "case") for (const e of ws.exceptions.filter((x) => x.intentId === intentId)) for (const id of e.supportingEvidenceIds ?? []) attached.add(id);
  const lineIntent = (lineId: string) => ws.allocations.filter((a) => a.statementLineId === lineId && a.target.kind === "payment").map((a) => (a.target as { intentId: string }).intentId);
  const find = (id: string): { record: unknown; intents: (string | undefined)[] } | undefined => {
    const l = ws.statementLines.find((x) => x.id === id); if (l) return { record: l, intents: lineIntent(id) };
    const c = ws.chainObservations.find((x) => x.id === id); if (c) return { record: c, intents: [c.intentId] };
    const e = ws.evidence.find((x) => x.id === id); if (e) return { record: e, intents: [e.intentId] };
    const pe = ws.providerEvents.find((x) => x.id === id); if (pe) return { record: pe, intents: [pe.intentId] };
    const a = ws.allocations.find((x) => x.id === id); if (a) return { record: a, intents: [a.target.kind === "payment" ? a.target.intentId : undefined] };
    return undefined;
  };
  const unknown: string[] = []; const foreign: string[] = []; const evidence: { id: string; sha256: string }[] = [];
  for (const id of [...p.evidenceRefs].sort()) {
    const f = find(id);
    if (!f) { unknown.push(id); continue; }
    if (!attached.has(id) && !(intentId && f.intents.includes(intentId))) { foreign.push(id); continue; }
    evidence.push({ id, sha256: sha256(canonical(f.record)) });
  }
  if (unknown.length) throw new RequestRefused(422, "EVIDENCE_NOT_FOUND", `Unknown evidence: ${unknown.join(", ")}`);
  if (foreign.length) throw new RequestRefused(422, "EVIDENCE_NOT_FOR_TARGET", `Evidence does not concern this ${p.target.kind}: ${foreign.join(", ")}`);
  const check = p.target.kind === "case" ? canResolveCase(ws, p.target.id) : canResolveException(ws, p.target.id);
  if (!check.allowed) throw new RequestRefused(422, check.code, check.reason);
  return { evidence, targetState: sha256(canonical(target)) };
}

export async function requestResolution(ctx: TenantContext, input: ResolutionProposal, idempotencyKey: string) {
  require(ctx, "request_approval");
  const p = ResolutionProposal.parse(input);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, idempotencyKey, p, async () => {
    const subj = subjectId(p.target);
    // lock this subject's requests FIRST, then check (review L3); a new proposal supersedes the pending version
    const prior = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "investigation_resolution"), eq(t.approvalRequests.subjectId, subj))).for("update");
    const ws = await readWorkspace(tx, ctx.orgId);
    const bound = bindEvidence(ws, p);
    for (const r of prior.filter((x) => x.status === "pending")) {
      await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, r.id)));
    }
    const version = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const payload = { target: p.target, note: p.note, evidenceRefs: [...p.evidenceRefs].sort(), evidence: bound.evidence, targetState: bound.targetState, version };
    const payloadSha256 = sha256(canonical(payload));
    const [row] = await tx.insert(t.approvalRequests).values({ orgId: ctx.orgId, subjectKind: "investigation_resolution", subjectId: subj, version, payload, payloadSha256, requestedBy: ctx.userId }).returning();
    await serverAudit(tx, ctx, "resolution_requested", p.target.kind, p.target.id, `Resolution v${version} proposed for approval (sha256 ${payloadSha256.slice(0, 12)}…)`, { requestId: row.id, evidenceRefs: payload.evidenceRefs });
    return { status: 201, body: approvalView(row) };
  }));
}

export const Decision = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(3).max(1000),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

/**
 * Approve or reject. The approver states the hash of the version they reviewed; the database trigger refuses a
 * decision by the requester, by a non-approver, on a closed request, or on a different hash. Approval applies the
 * engine's `resolve` as the approver, which re-checks the evidence (canResolve*) at that moment.
 */
export async function decideApproval(ctx: TenantContext, requestId: string, input: z.infer<typeof Decision>, idempotencyKey: string) {
  require(ctx, "decide_approval");
  const d = Decision.parse(input);
  if (!z.uuid().safeParse(requestId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, idempotencyKey, { requestId, ...d }, async () => {
    const [req] = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId))).for("update");
    if (!req) throw new AccessDenied(404, "Not found.");
    if (req.requestedBy === ctx.userId) throw new RequestRefused(409, "MAKER_CANNOT_APPROVE", "You proposed this resolution; another approver must decide it.");
    if (req.status !== "pending") throw new RequestRefused(409, "REQUEST_CLOSED", `This request is ${req.status}.`);
    if (req.payloadSha256 !== d.payloadSha256) throw new RequestRefused(409, "VERSION_MISMATCH", "The proposal changed since you reviewed it. Review the current version.");
    if (d.decision === "approve") {
      // the cited evidence and the target must still be exactly what was requested (and reviewed)
      const pl = req.payload as { target: TargetRef; note: string; evidenceRefs: string[]; evidence: { id: string; sha256: string }[]; targetState: string };
      const now = bindEvidence(await readWorkspace(tx, ctx.orgId), { target: pl.target, note: pl.note, evidenceRefs: pl.evidenceRefs });
      if (canonical(now.evidence) !== canonical(pl.evidence) || now.targetState !== pl.targetState) {
        throw new RequestRefused(409, "EVIDENCE_CHANGED", "The cited evidence or the case changed after this request was made. Ask for a new version.");
      }
    }
    await tx.insert(t.approvalDecisions).values({ orgId: ctx.orgId, requestId, decidedBy: ctx.userId, decision: d.decision, reason: d.reason, payloadSha256: d.payloadSha256 });
    let outcome: unknown = null;
    if (d.decision === "approve") {
      const payload = req.payload as { target: TargetRef; note: string; evidenceRefs: string[]; version: number };
      const note = `${payload.note} — approved by a second person (request ${requestId} v${payload.version}; evidence ${payload.evidenceRefs.join(", ")})`;
      outcome = summary(await engine(tx, ctx, { type: "resolve", target: payload.target, note }));
    }
    await tx.update(t.approvalRequests).set({ status: d.decision === "approve" ? "approved" : "rejected", closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, requestId)));
    await serverAudit(tx, ctx, d.decision === "approve" ? "resolution_approved" : "resolution_rejected", "approval_request", requestId, `${d.decision === "approve" ? "Approved" : "Rejected"} v${req.version}: ${d.reason}`, { payloadSha256: d.payloadSha256 });
    return { status: 200, body: { requestId, decision: d.decision, outcome } };
  }));
}

export async function listApprovals(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => (await tx.select().from(t.approvalRequests).where(eq(t.approvalRequests.orgId, ctx.orgId)).orderBy(desc(t.approvalRequests.createdAt))).map(approvalView));
}

// ---------------------------------------------------------------------------------------------
// Evidence-backed export
// ---------------------------------------------------------------------------------------------

export async function investigationReport(ctx: TenantContext, intentId: string, format: "json" | "csv") {
  require(ctx, "read");
  return tenantTx(ctx, async (tx) => {
    const ws = await readWorkspace(tx, ctx.orgId);
    const r = buildCaseReport(ws, { paymentId: intentId });
    if (!r.ok) throw new AccessDenied(404, "Not found.");
    const approvals = (await tx.select().from(t.approvalRequests).where(eq(t.approvalRequests.orgId, ctx.orgId))).filter((a) => ws.exceptions.some((e) => e.intentId === intentId && a.subjectId === `exception:${e.id}`) || ws.cases.some((c) => c.intentId === intentId && a.subjectId === `case:${c.id}`));
    const decisions = await tx.select().from(t.approvalDecisions).where(eq(t.approvalDecisions.orgId, ctx.orgId));
    const report = { ...r.value, organisation: ctx.orgName, generatedBy: ctx.email, approvals: approvals.map((a) => ({ ...approvalView(a), decisions: decisions.filter((d) => d.requestId === a.id).map((d) => ({ decision: d.decision, decidedBy: d.decidedBy, reason: d.reason, at: d.createdAt })) })) };
    const body = format === "json" ? JSON.stringify(report, null, 2) + "\n" : caseReportToCsv(r.value);
    const digest = sha256(body);
    await serverAudit(tx, ctx, "investigation_report_exported", "payment", intentId, `Report exported (${format}, sha256 ${digest.slice(0, 12)}…)`, { sha256: digest, format });
    return { body, sha256: digest };
  });
}
