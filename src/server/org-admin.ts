import "server-only";
import { and, count, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import * as t from "./db/schema";
import { can, isAppRole, ROLE_LABELS } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";

/**
 * rc7 phase 3b: the organisation Admin's page. An Admin (manage_members; no financial authority) sees the members and
 * their roles, can sign a member out everywhere (revoke their sessions), and reads the audit log page by page with ids
 * only (never summaries or details, which can quote what a person typed). Everything stays inside the organisation.
 */

function requireAdmin(ctx: TenantContext) {
  if (!can(ctx.role, "manage_members")) throw new AccessDenied(403, "Only an Admin manages members.");
}

export interface OrgUser { userId: string; name: string; email: string; role: string; roleLabel: string; revokedAt: string | null; activeSessions: number; you: boolean }

export async function listOrgUsers(ctx: TenantContext): Promise<OrgUser[]> {
  requireAdmin(ctx);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const ms = await tx.select({ userId: t.organizationMemberships.userId, name: t.users.name, email: t.users.email, role: t.organizationMemberships.role, revokedAt: t.organizationMemberships.revokedAt })
      .from(t.organizationMemberships).innerJoin(t.users, eq(t.users.id, t.organizationMemberships.userId)).where(eq(t.organizationMemberships.orgId, ctx.orgId)).orderBy(t.users.name);
    const ids = ms.map((m) => m.userId);
    const sessions = ids.length ? await tx.select({ userId: t.sessions.userId, n: count() }).from(t.sessions).where(and(inArray(t.sessions.userId, ids), gt(t.sessions.expiresAt, new Date()))).groupBy(t.sessions.userId) : [];
    return ms.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, roleLabel: isAppRole(m.role) ? ROLE_LABELS[m.role] : m.role, revokedAt: m.revokedAt?.toISOString() ?? null,
      activeSessions: Number(sessions.find((x) => x.userId === m.userId)?.n ?? 0), you: m.userId === ctx.userId }));
  }, { read: true });
}

/**
 * Sign a member of this organisation out everywhere: their sessions are deleted (they sign in again). Not your own
 * (use Sign out). A user who is not a member of this organisation is "not found". Audited with ids and a count.
 */
export async function revokeUserSessions(ctx: TenantContext, userId: string, idempotencyKey: string) {
  requireAdmin(ctx);
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!z.string().min(1).max(64).safeParse(userId).success) throw new AccessDenied(404, "Not found.");
  if (userId === ctx.userId) throw new RequestRefused(409, "OWN_SESSIONS", "Use Sign out for your own session.");
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => idempotent(tx, ctx, key, { op: "admin_revoke_sessions", userId }, async () => {
    const [m] = await tx.select({ userId: t.organizationMemberships.userId }).from(t.organizationMemberships)
      .where(and(eq(t.organizationMemberships.orgId, ctx.orgId), eq(t.organizationMemberships.userId, userId)));
    if (!m) throw new AccessDenied(404, "Not found.");
    const gone = await tx.delete(t.sessions).where(eq(t.sessions.userId, userId)).returning({ id: t.sessions.id });
    await serverAudit(tx, ctx, "member_sessions_revoked", "user", userId, `An Admin signed a member out everywhere (${gone.length} session(s))`, { userId, sessions: gone.length });
    return { status: 200, body: { userId, sessionsRevoked: gone.length } };
  }));
}

export const AuditPage = z.object({ before: z.number().int().positive().optional(), pageSize: z.number().int().min(1).max(200).default(50) }).strict();

/** One page of the organisation's audit log, newest first: ids, actions and times only. */
export async function auditLogPage(ctx: TenantContext, query: z.input<typeof AuditPage> = {}) {
  requireAdmin(ctx);
  const q = AuditPage.parse(query);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const rows = await tx.select({ seq: t.auditEvents.seq, at: t.auditEvents.at, actorUserId: t.auditEvents.actorUserId, source: t.auditEvents.source, action: t.auditEvents.action, entityType: t.auditEvents.entityType, entityId: t.auditEvents.entityId })
      .from(t.auditEvents).where(and(eq(t.auditEvents.orgId, ctx.orgId), ...(q.before ? [lt(t.auditEvents.seq, q.before)] : []))).orderBy(desc(t.auditEvents.seq)).limit(q.pageSize + 1);
    const page = rows.slice(0, q.pageSize);
    return {
      events: page.map((r) => ({ seq: Number(r.seq), at: r.at.toISOString(), actorUserId: r.actorUserId, source: r.source, action: r.action, entityType: r.entityType, entityId: r.entityId })),
      nextBefore: rows.length > q.pageSize ? Number(page.at(-1)!.seq) : null,
    };
  }, { read: true });
}
