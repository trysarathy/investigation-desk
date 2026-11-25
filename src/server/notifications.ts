import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "./db/schema";
import { can } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { AccessDenied, inEntityScope, requireEntity, type TenantContext, withTenant } from "./tenant";

/**
 * rc7 phase 3b: in-app notifications. The database raises them (triggers in drizzle/0027_notifications.sql); row-level
 * security shows each member only those for their current role in this organisation (or addressed to them). Reading
 * marks them read for that member only. An Approver who did not start the run acknowledges a rule-change notice.
 */

export interface NotificationView {
  id: string; kind: string; entityId: string | null; subjectType: string; subjectId: string; title: string; createdAt: string; read: boolean; href: string | null;
  /** Rule-change notices: the payment it is about and its acknowledgement (null until an Approver acknowledges it). */
  notice?: { orderId: string; acknowledged: { by: string; at: string } | null };
}

const hrefOf = (n: { subjectType: string; subjectId: string; entityId: string | null }) => {
  switch (n.subjectType) {
    case "run": return `/control/merchant/runs${n.entityId ? `?entity=${encodeURIComponent(n.entityId)}` : ""}`;
    case "exception": return `/control/merchant/exceptions/${encodeURIComponent(n.subjectId)}`;
    case "approval": return "/control/merchant/approvals";
    case "upload": return `/control/merchant/uploads/${encodeURIComponent(n.subjectId)}`;
    case "rule_change_notice": return `/control/merchant/notifications#notice-${encodeURIComponent(n.subjectId)}`;
    default: return null;
  }
};

export async function listNotifications(ctx: TenantContext, opts: { limit?: number } = {}): Promise<{ unread: number; notifications: NotificationView[] }> {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const rows = await tx.select().from(t.notifications).where(eq(t.notifications.orgId, ctx.orgId)).orderBy(desc(t.notifications.createdAt), desc(t.notifications.id)).limit(limit);
    const reads = rows.length ? new Set((await tx.select({ id: t.notificationReads.notificationId }).from(t.notificationReads)
      .where(and(eq(t.notificationReads.orgId, ctx.orgId), eq(t.notificationReads.userId, ctx.userId), inArray(t.notificationReads.notificationId, rows.map((r) => r.id))))).map((r) => r.id)) : new Set<string>();
    const noticeIds = rows.filter((r) => r.subjectType === "rule_change_notice").map((r) => r.subjectId);
    const acks = noticeIds.length ? await tx.select({ noticeId: t.ruleChangeAcks.noticeId, at: t.ruleChangeAcks.ackedAt, name: t.users.name }).from(t.ruleChangeAcks)
      .innerJoin(t.users, eq(t.users.id, t.ruleChangeAcks.ackedBy)).where(and(eq(t.ruleChangeAcks.orgId, ctx.orgId), inArray(t.ruleChangeAcks.noticeId, noticeIds))) : [];
    const notices = new Map((noticeIds.length ? await tx.select({ id: t.ruleChangeNotices.id, orderId: t.ruleChangeNotices.orderId }).from(t.ruleChangeNotices)
      .where(and(eq(t.ruleChangeNotices.orgId, ctx.orgId), inArray(t.ruleChangeNotices.id, noticeIds))) : []).map((n) => [n.id, n.orderId]));
    const [{ unread }] = await tx.select({ unread: sql<number>`count(*)::int` }).from(t.notifications).where(and(eq(t.notifications.orgId, ctx.orgId),
      sql`not exists (select 1 from notification_reads r where r.org_id = ${t.notifications.orgId} and r.notification_id = ${t.notifications.id} and r.user_id = ${ctx.userId})`));
    return {
      unread,
      // v1 phase 1.3: an entity's notification only within the member's scope (the database's entity_scope agrees;
      // organisation-level ones are filtered there by their subject)
      notifications: rows.filter((r) => r.entityId === null || inEntityScope(ctx, r.entityId)).map((r) => {
        const ack = acks.find((a) => a.noticeId === r.subjectId);
        return { id: r.id, kind: r.kind, entityId: r.entityId, subjectType: r.subjectType, subjectId: r.subjectId, title: r.title, createdAt: r.createdAt.toISOString(), read: reads.has(r.id), href: hrefOf(r),
          ...(r.subjectType === "rule_change_notice" ? { notice: { orderId: notices.get(r.subjectId) ?? "", acknowledged: ack ? { by: ack.name, at: ack.at.toISOString() } : null } } : {}) };
      }),
    };
  }, { read: true });
}

/** The unread count for the bell (0 for anyone without read access to the merchant screens). */
export async function unreadCount(ctx: TenantContext): Promise<number> {
  if (!can(ctx.role, "read")) return 0;
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => (await tx.select({ n: sql<number>`count(*)::int` }).from(t.notifications).where(and(eq(t.notifications.orgId, ctx.orgId),
    sql`not exists (select 1 from notification_reads r where r.org_id = ${t.notifications.orgId} and r.notification_id = ${t.notifications.id} and r.user_id = ${ctx.userId})`)))[0].n, { read: true });
}

export const MarkRead = z.object({ ids: z.array(z.uuid()).min(1).max(500) }).strict();

/** Mark notifications read for the signed-in member (only ones they can see; others are ignored). */
export async function markNotificationsRead(ctx: TenantContext, input: z.input<typeof MarkRead>) {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const v = MarkRead.parse(input);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const visible = await tx.select({ id: t.notifications.id }).from(t.notifications).where(and(eq(t.notifications.orgId, ctx.orgId), inArray(t.notifications.id, v.ids)));
    if (visible.length) await tx.insert(t.notificationReads).values(visible.map((x) => ({ orgId: ctx.orgId, notificationId: x.id, userId: ctx.userId }))).onConflictDoNothing();
    return { marked: visible.length };
  });
}

export const Acknowledge = z.object({ note: z.string().trim().max(1000).optional() }).strict();

/**
 * An Approver acknowledges a rule-change notice (the payment stays as the person closed it). The member who started
 * the run that raised the notice cannot (also enforced by trigger). Audited with ids only.
 */
export async function acknowledgeRuleChange(ctx: TenantContext, noticeId: string, input: z.input<typeof Acknowledge>, idempotencyKey: string) {
  if (!can(ctx.role, "decide_approval")) throw new AccessDenied(403, "Only an Approver acknowledges a rule-change notice.");
  if (!z.uuid().safeParse(noticeId).success) throw new AccessDenied(404, "Not found.");
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = Acknowledge.parse(input);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, (tx) => idempotent(tx, ctx, key, { op: "rule_change_ack", noticeId }, async () => {
    const [n] = await tx.select({ id: t.ruleChangeNotices.id, runId: t.ruleChangeNotices.runId, orderId: t.ruleChangeNotices.orderId, entityId: t.ruleChangeNotices.entityId }).from(t.ruleChangeNotices)
      .where(and(eq(t.ruleChangeNotices.orgId, ctx.orgId), eq(t.ruleChangeNotices.id, noticeId)));
    if (!n) throw new AccessDenied(404, "Not found.");
    requireEntity(ctx, n.entityId);
    const [run] = await tx.select({ startedBy: t.reconciliationRuns.startedBy }).from(t.reconciliationRuns).where(and(eq(t.reconciliationRuns.orgId, ctx.orgId), eq(t.reconciliationRuns.id, n.runId)));
    if (!run || run.startedBy === ctx.userId) throw new RequestRefused(409, "PREPARER_CANNOT_ACKNOWLEDGE", "You started the run that raised this notice; another Approver must acknowledge it.");
    const [done] = await tx.select({ by: t.ruleChangeAcks.ackedBy }).from(t.ruleChangeAcks).where(and(eq(t.ruleChangeAcks.orgId, ctx.orgId), eq(t.ruleChangeAcks.noticeId, noticeId)));
    if (done) throw new RequestRefused(409, "ALREADY_ACKNOWLEDGED", "This notice was already acknowledged.");
    await tx.insert(t.ruleChangeAcks).values({ orgId: ctx.orgId, noticeId, ackedBy: ctx.userId, note: v.note ?? null });
    await serverAudit(tx, ctx, "rule_change_acknowledged", "rule_change_notice", noticeId, `Rule-change notice for ${n.orderId} acknowledged by an Approver`, { noticeId, runId: n.runId });
    return { status: 200, body: { noticeId, acknowledged: true } };
  }));
}
