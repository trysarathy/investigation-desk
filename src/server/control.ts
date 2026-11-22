import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildCaseReport, canResolveCase, canResolveException, caseReportToCsv, investigate,
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

async function serverAudit(tx: Tx, ctx: TenantContext, action: string, entityType: string | null, entityId: string | null, summary: string, details?: unknown) {
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

async function idempotent<T>(tx: Tx, ctx: TenantContext, key: string, request: unknown, run: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }> {
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
  return tenantTx(ctx, async (tx) => {
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
  return tenantTx(ctx, async (tx) => {
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
  return tenantTx(ctx, async (tx) => {
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
    };
  });
}

export async function auditHistory(ctx: TenantContext, limit = 200) {
  require(ctx, "read");
  return tenantTx(ctx, (tx) => tx.select().from(t.auditEvents).where(eq(t.auditEvents.orgId, ctx.orgId)).orderBy(desc(t.auditEvents.seq)).limit(Math.min(limit, 1000)));
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

/** Every evidence reference must name a record of this organisation's workspace that concerns the target. */
function checkEvidenceRefs(ws: Workspace, p: ResolutionProposal) {
  const ids = new Set<string>([
    ...ws.statementLines.map((x) => x.id), ...ws.chainObservations.map((x) => x.id), ...ws.evidence.map((x) => x.id),
    ...ws.providerEvents.map((x) => x.id), ...ws.allocations.map((x) => x.id),
  ]);
  const unknown = p.evidenceRefs.filter((r) => !ids.has(r));
  if (unknown.length) throw new RequestRefused(422, "EVIDENCE_NOT_FOUND", `Unknown evidence: ${unknown.join(", ")}`);
  const check = p.target.kind === "case" ? canResolveCase(ws, p.target.id) : canResolveException(ws, p.target.id);
  if (!check.allowed) throw new RequestRefused(422, check.code, check.reason);
}

export async function requestResolution(ctx: TenantContext, input: ResolutionProposal, idempotencyKey: string) {
  require(ctx, "request_approval");
  const p = ResolutionProposal.parse(input);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, idempotencyKey, p, async () => {
    const ws = await readWorkspace(tx, ctx.orgId);
    checkEvidenceRefs(ws, p);
    const subj = subjectId(p.target);
    // a new proposal supersedes the previous pending version (so an edit invalidates any approval in flight)
    const prior = await tx.select().from(t.approvalRequests).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.subjectKind, "investigation_resolution"), eq(t.approvalRequests.subjectId, subj))).for("update");
    for (const r of prior.filter((x) => x.status === "pending")) {
      await tx.update(t.approvalRequests).set({ status: "superseded", closedAt: new Date() }).where(and(eq(t.approvalRequests.orgId, ctx.orgId), eq(t.approvalRequests.id, r.id)));
    }
    const version = prior.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const payload = { target: p.target, note: p.note, evidenceRefs: [...p.evidenceRefs].sort(), version };
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
  return tenantTx(ctx, async (tx) => (await tx.select().from(t.approvalRequests).where(eq(t.approvalRequests.orgId, ctx.orgId)).orderBy(desc(t.approvalRequests.createdAt))).map(approvalView));
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
