import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { IdempotencyKey, serverAudit } from "./control";
import { RequestRefused } from "./errors";
import { AccessDenied, inEntityScope, requireEntity, type TenantContext, withTenant } from "./tenant";

/**
 * v1 phase 3: the web app's side of the job queue. A member enqueues a job for themselves (the database allows the
 * runtime login nothing else on the queue: an INSERT of a queued, manual job naming the signed-in member, migration
 * 0064) and reads their organisation's jobs with their progress events. The worker (jobs.ts) does the work, acting as
 * that member and checking their access again.
 */

export const ENQUEUE_KINDS = ["reconcile", "revaluation", "pickup"] as const;
const PERMISSION: Record<(typeof ENQUEUE_KINDS)[number], Permission> = { reconcile: "merchant_reconcile", revaluation: "merchant_export", pickup: "merchant_upload" };
export const EnqueueInput = z.object({
  entityId: z.string().min(1).max(64),
  kind: z.enum(ENQUEUE_KINDS).default("reconcile"),
  /** Revaluation only: the balances and period end (validated again by the revaluation itself when it runs). */
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function enqueueJob(ctx: TenantContext, input: z.input<typeof EnqueueInput>, idempotencyKey: string) {
  const v = EnqueueInput.parse(input);
  if (!can(ctx.role, PERMISSION[v.kind])) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  requireEntity(ctx, v.entityId);
  if (v.params && JSON.stringify(v.params).length > 16_000) throw new RequestRefused(422, "PARAMS_TOO_LARGE", "The job parameters are too large.");
  const key = IdempotencyKey.parse(idempotencyKey);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [ent] = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, v.entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    const dedupeKey = `manual:${key}`.slice(0, 128).replace(/[^A-Za-z0-9:/._#-]/g, "_");
    // only the eight columns the runtime login may write (0064); every other column takes its default
    const ins = (await tx.execute(sql`insert into jobs (org_id, entity_id, kind, trigger, dedupe_key, run_as, run_after, params)
      values (${ctx.orgId}, ${v.entityId}, ${v.kind}, 'manual', ${dedupeKey}, ${ctx.userId}, now(), ${JSON.stringify(v.params ?? {})}::jsonb)
      on conflict do nothing returning id`)).rows;
    const [job] = await tx.select().from(t.jobs).where(and(eq(t.jobs.orgId, ctx.orgId), eq(t.jobs.entityId, v.entityId), eq(t.jobs.dedupeKey, dedupeKey)));
    if (!job || job.runAs !== ctx.userId || job.kind !== v.kind) throw new RequestRefused(409, "IDEMPOTENCY_KEY_REUSED", "That request key was used for another job.");
    if (ins.length) await serverAudit(tx, ctx, "job_enqueued", "merchant_entity", v.entityId, `Queued a ${v.kind} job for the worker`, { jobId: job.id, kind: v.kind });
    return { status: ins.length ? 202 : 200, body: { jobId: job.id, kind: job.kind, entityId: v.entityId, status: job.status, replayed: ins.length === 0 } };
  });
}

type JobRow = typeof t.jobs.$inferSelect;
const view = (j: JobRow, events: (typeof t.jobEvents.$inferSelect)[]) => ({
  id: j.id, kind: j.kind, trigger: j.trigger, entityId: j.entityId, status: j.status, stage: j.stage, attempts: j.attempts, maxAttempts: j.maxAttempts,
  recoveries: j.recoveries, lastErrorCode: j.lastErrorCode, runId: j.runId, createdAt: j.createdAt.toISOString(), runAfter: j.runAfter.toISOString(),
  heartbeatAt: j.heartbeatAt?.toISOString() ?? null, finishedAt: j.finishedAt?.toISOString() ?? null, mine: undefined as boolean | undefined,
  events: events.map((e) => ({ at: e.at.toISOString(), event: e.event, stage: e.stage, attempt: e.attempt, code: e.code, counts: e.counts as Record<string, number> | null })),
});

async function eventsOf(tx: Tx, orgId: string, ids: string[]) {
  if (!ids.length) return new Map<string, (typeof t.jobEvents.$inferSelect)[]>();
  const rows = await tx.select().from(t.jobEvents).where(and(eq(t.jobEvents.orgId, orgId), inArray(t.jobEvents.jobId, ids))).orderBy(asc(t.jobEvents.id));
  const out = new Map<string, (typeof t.jobEvents.$inferSelect)[]>();
  for (const r of rows) out.set(r.jobId, [...(out.get(r.jobId) ?? []), r]);
  return out;
}

/** The organisation's recent jobs (the member's entity scope applies) with their events, newest first. */
export async function listJobs(ctx: TenantContext, opts: { limit?: number } = {}) {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const jobs = (await tx.select().from(t.jobs).where(eq(t.jobs.orgId, ctx.orgId)).orderBy(desc(t.jobs.createdAt)).limit(limit))
      .filter((j) => j.entityId === null ? ctx.entityScope === null : inEntityScope(ctx, j.entityId));
    const ev = await eventsOf(tx, ctx.orgId, jobs.map((j) => j.id));
    return { jobs: jobs.map((j) => ({ ...view(j, ev.get(j.id) ?? []), mine: j.runAs === ctx.userId })) };
  }, { read: true });
}

export async function jobDetail(ctx: TenantContext, jobId: string) {
  if (!can(ctx.role, "read")) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
  if (!z.string().uuid().safeParse(jobId).success) throw new AccessDenied(404, "Not found.");
  return withTenant({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [j] = await tx.select().from(t.jobs).where(and(eq(t.jobs.orgId, ctx.orgId), eq(t.jobs.id, jobId)));
    if (!j || (j.entityId !== null && !inEntityScope(ctx, j.entityId)) || (j.entityId === null && ctx.entityScope !== null)) throw new AccessDenied(404, "Not found.");
    const ev = await eventsOf(tx, ctx.orgId, [j.id]);
    return { job: { ...view(j, ev.get(j.id) ?? []), mine: j.runAs === ctx.userId, result: j.result } };
  }, { read: true });
}
