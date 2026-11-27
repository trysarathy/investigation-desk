import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { AccessDenied, requireEntity, type TenantContext, withTenant } from "./tenant";
import { stampNow } from "./live-clock";

/**
 * v1 phase 3: period close. After the month-end review, Finance or an Admin asks for an entity's month to be locked;
 * a DIFFERENT person, an Admin, locks it (maker-checker) or rejects the request. A locked month never changes: the
 * database refuses every insert or update of its payments' decisions, differences, exceptions, write-offs and journal
 * proposals (migration 0080, was 0065). A later run that would decide such a payment differently files a correction in the
 * next open month, naming the payment, the locked month and the decision it corrects; nothing in the locked month moves.
 */

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const RequestLock = z.object({ period: Period, reason: z.string().trim().min(3).max(500) }).strict();
export const DecideLock = z.object({ decision: z.enum(["lock", "reject"]), reason: z.string().trim().min(3).max(500) }).strict();

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);

/** The month after `period` (YYYY-MM). */
export const nextPeriod = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export async function requestPeriodLock(ctx: TenantContext, entityId: string, input: z.input<typeof RequestLock>, idempotencyKey: string) {
  require(ctx, "period_close_request");
  requireEntity(ctx, entityId);
  const v = RequestLock.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "period_lock_request", entityId, ...v }, async () => {
    const [ent] = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    const [cur] = await tx.select().from(t.periodLocks).where(and(eq(t.periodLocks.orgId, ctx.orgId), eq(t.periodLocks.entityId, entityId), eq(t.periodLocks.period, v.period))).for("update");
    if (cur && cur.status !== "rejected") throw new RequestRefused(409, cur.status === "locked" ? "PERIOD_LOCKED" : "PERIOD_LOCK_PENDING", cur.status === "locked" ? "This month is already locked." : "A sign-off for this month is already waiting.");
    const now = stampNow();
    if (cur) await tx.update(t.periodLocks).set({ status: "requested", requestedBy: ctx.userId, requestedAt: now, reason: v.reason, decidedBy: null, decidedAt: null, decisionReason: null })
      .where(and(eq(t.periodLocks.orgId, ctx.orgId), eq(t.periodLocks.entityId, entityId), eq(t.periodLocks.period, v.period)));
    else await tx.insert(t.periodLocks).values({ orgId: ctx.orgId, entityId, period: v.period, requestedBy: ctx.userId, requestedAt: now, reason: v.reason });
    await serverAudit(tx, ctx, "period_lock_requested", "merchant_entity", entityId, `Month-end sign-off of ${v.period} requested`, { period: v.period });
    return { status: 200, body: { entityId, period: v.period, status: "requested" as const } };
  }));
}

export async function decidePeriodLock(ctx: TenantContext, entityId: string, period: string, input: z.input<typeof DecideLock>, idempotencyKey: string) {
  require(ctx, "period_close_approve");
  requireEntity(ctx, entityId);
  const p = Period.parse(period);
  const v = DecideLock.parse(input);
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "period_lock_decide", entityId, period: p, ...v }, async () => {
    const [cur] = await tx.select().from(t.periodLocks).where(and(eq(t.periodLocks.orgId, ctx.orgId), eq(t.periodLocks.entityId, entityId), eq(t.periodLocks.period, p))).for("update");
    if (!cur) throw new AccessDenied(404, "Not found.");
    if (cur.status !== "requested") throw new RequestRefused(409, "PERIOD_NOT_REQUESTED", "No sign-off of this month is waiting.");
    if (cur.requestedBy === ctx.userId) throw new RequestRefused(403, "PREPARER_CANNOT_APPROVE", "You asked for this sign-off; another Admin locks the month.");
    const status = v.decision === "lock" ? "locked" as const : "rejected" as const;
    await tx.update(t.periodLocks).set({ status, decidedBy: ctx.userId, decidedAt: stampNow(), decisionReason: v.reason })
      .where(and(eq(t.periodLocks.orgId, ctx.orgId), eq(t.periodLocks.entityId, entityId), eq(t.periodLocks.period, p)));
    await serverAudit(tx, ctx, status === "locked" ? "period_locked" : "period_lock_rejected", "merchant_entity", entityId, `Month ${p} ${status === "locked" ? "locked" : "sign-off rejected"}`, { period: p });
    return { status: 200, body: { entityId, period: p, status } };
  }));
}

export async function listPeriods(ctx: TenantContext, entityId: string) {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  requireEntity(ctx, entityId);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [ent] = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    const locks = await tx.select().from(t.periodLocks).where(and(eq(t.periodLocks.orgId, ctx.orgId), eq(t.periodLocks.entityId, entityId))).orderBy(desc(t.periodLocks.period));
    const corrections = await tx.select().from(t.periodCorrections).where(and(eq(t.periodCorrections.orgId, ctx.orgId), eq(t.periodCorrections.entityId, entityId)))
      .orderBy(desc(t.periodCorrections.createdAt), asc(t.periodCorrections.orderId)).limit(200);
    return {
      entityId,
      periods: locks.map((l) => ({ period: l.period, status: l.status, requestedBy: l.requestedBy, requestedAt: l.requestedAt.toISOString(), reason: l.reason, decidedBy: l.decidedBy, decidedAt: l.decidedAt?.toISOString() ?? null, mine: l.requestedBy === ctx.userId })),
      corrections: corrections.map((c) => ({ id: c.id, orderId: c.orderId, correctsPeriod: c.correctsPeriod, correctionPeriod: c.correctionPeriod, runId: c.runId, storedDecision: c.storedDecision, storedRuleId: c.storedRuleId, newDecision: c.newDecision, newRuleId: c.newRuleId, at: c.createdAt.toISOString() })),
    };
  }, { read: true });
}

/**
 * For a run: the entity's payments in a locked month (with that month), and the locked months themselves. Read in the
 * run's transaction (the lock check the database repeats on every write).
 */
export async function lockedPayments(tx: Tx, orgId: string, entityId: string): Promise<{ orders: Map<string, string>; periods: Set<string> }> {
  const periods = new Set((await tx.select({ p: t.periodLocks.period }).from(t.periodLocks)
    .where(and(eq(t.periodLocks.orgId, orgId), eq(t.periodLocks.entityId, entityId), eq(t.periodLocks.status, "locked")))).map((x) => x.p));
  if (!periods.size) return { orders: new Map(), periods };
  const r = await tx.execute(sql`select i.order_id, to_char((i.issued_at at time zone 'UTC') + make_interval(mins => e.utc_offset_minutes), 'YYYY-MM') as period
    from invoices i join merchant_entities e on e.org_id = i.org_id and e.id = i.entity_id where i.org_id = ${orgId} and i.entity_id = ${entityId}`);
  const orders = new Map<string, string>();
  for (const x of r.rows as { order_id: string; period: string }[]) if (periods.has(x.period)) orders.set(x.order_id, x.period);
  return { orders, periods };
}

/** The first month after `period` that is not locked: where a correction of `period` goes. */
export function correctionPeriod(period: string, locked: ReadonlySet<string>) {
  let p = nextPeriod(period);
  while (locked.has(p)) p = nextPeriod(p);
  return p;
}
