import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";
import type { JobStatus } from "./db/ops-schema";
import { runReconciliation } from "./merchant";
import { RULE_SET_VERSION, errorCodeOf, runState } from "./runs";
import { AccessDenied, resolveTenant } from "./tenant";
import { RequestRefused } from "./errors";

/**
 * rc7 phase 3a: a job queue in PostgreSQL, a daily schedule per entity and the worker that runs both.
 *
 * - The queue and the scheduler use the schema OWNER connection (like retention): they see every organisation's
 *   schedules and jobs. The reconciliation itself runs on the runtime connection under row-level security, as the
 *   member who set the schedule; that member's access is checked again at every run (a revoked member's job dies).
 * - Claiming is `SELECT … FOR UPDATE SKIP LOCKED`: two workers never take the same job. A running job whose worker
 *   vanished is taken again after its lease. Failures retry with exponential backoff; after max attempts, or on an
 *   error that cannot succeed on retry (access, a refused request), the job is dead.
 * - (org, entity, dedupe key) is unique: an entity's day is enqueued once, and so is each rule version.
 * - Logs carry ids, statuses, codes and counts only.
 */

export type Job = typeof t.jobs.$inferSelect;
type Conn = Db | Tx;
const MINUTE = 60_000;
export const LEASE_MS = 15 * MINUTE;
/** Retry delay after the nth failed attempt: 1, 2, 4, 8 … minutes, at most one hour. */
export const backoffMs = (attempts: number) => Math.min(MINUTE * 2 ** Math.max(attempts - 1, 0), 60 * MINUTE);

/** An entity's merchant-day clock (its fixed UTC offset, as the engine's merchant day). */
export function localClock(now: Date, utcOffsetMinutes: number) {
  const iso = new Date(now.getTime() + utcOffsetMinutes * MINUTE).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export interface ScheduleResult { daily: number; ruleChange: number }

/**
 * Enqueue every due run: an entity's daily run once its local time has passed the schedule's time (once per local
 * day), and a re-run when the rule-set version or the policy revision differs from the entity's last run.
 */
export async function enqueueDue(db: Conn, now: Date, ruleSetVersion = RULE_SET_VERSION): Promise<ScheduleResult> {
  const due = await db.select({ s: t.reconciliationSchedules, offset: t.merchantEntities.utcOffsetMinutes }).from(t.reconciliationSchedules)
    .innerJoin(t.merchantEntities, and(eq(t.merchantEntities.orgId, t.reconciliationSchedules.orgId), eq(t.merchantEntities.id, t.reconciliationSchedules.entityId)))
    .where(eq(t.reconciliationSchedules.enabled, true));
  const out: ScheduleResult = { daily: 0, ruleChange: 0 };
  for (const { s, offset } of due) {
    const base = { orgId: s.orgId, entityId: s.entityId, runAs: s.runAs, runAfter: now };
    const clock = localClock(now, offset);
    if (clock.time >= s.localTime) {
      const r = await db.insert(t.jobs).values({ ...base, trigger: "schedule", dedupeKey: `day:${clock.date}` }).onConflictDoNothing().returning({ id: t.jobs.id });
      out.daily += r.length;
    }
    const { prev, policyRevision } = await runState(db as Tx, s.orgId, s.entityId);
    if (prev && (prev.ruleSetVersion !== ruleSetVersion || prev.policyRevision !== policyRevision)) {
      const r = await db.insert(t.jobs).values({ ...base, trigger: "rule_change", dedupeKey: `rules:${ruleSetVersion}/p${policyRevision}` }).onConflictDoNothing().returning({ id: t.jobs.id });
      out.ruleChange += r.length;
    }
  }
  return out;
}

/** Take the next due job (or a running one whose lease ran out). Never returns a job another worker holds. */
export async function claimJob(db: Conn, workerId: string, now: Date): Promise<Job | null> {
  const r = await db.execute(sql`
    with next as (
      select id from jobs
      where (status = 'queued' and run_after <= ${now}) or (status = 'running' and locked_at < ${new Date(now.getTime() - LEASE_MS)})
      order by run_after, created_at, id
      limit 1
      for update skip locked
    )
    update jobs set status = 'running', attempts = least(jobs.attempts + 1, jobs.max_attempts), locked_at = ${now}, locked_by = ${workerId}
    from next where jobs.id = next.id
    returning jobs.id`);
  const id = r.rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(t.jobs).where(eq(t.jobs.id, String(id)));
  return job ?? null;
}

const mine = (job: Job) => and(eq(t.jobs.id, job.id), eq(t.jobs.status, "running"), eq(t.jobs.lockedBy, job.lockedBy ?? ""));

export async function completeJob(db: Conn, job: Job, now: Date, outcome: { runId?: string | null; status?: Extract<JobStatus, "done" | "cancelled">; code?: string } = {}) {
  await db.update(t.jobs).set({ status: outcome.status ?? "done", runId: outcome.runId ?? null, lastErrorCode: outcome.code ?? null, finishedAt: now, lockedAt: null, lockedBy: null }).where(mine(job));
}

/** Retry later with backoff, or dead after the last attempt (or at once for a failure a retry cannot fix). */
export async function failJob(db: Conn, job: Job, now: Date, code: string, permanent: boolean): Promise<"queued" | "dead"> {
  const dead = permanent || job.attempts >= job.maxAttempts;
  await db.update(t.jobs).set(dead
    ? { status: "dead", lastErrorCode: code, finishedAt: now, lockedAt: null, lockedBy: null }
    : { status: "queued", lastErrorCode: code, runAfter: new Date(now.getTime() + backoffMs(job.attempts)), lockedAt: null, lockedBy: null }).where(mine(job));
  return dead ? "dead" : "queued";
}

export type JobOutcome = { runId: string | null; status: "done" | "cancelled"; code?: string; counts?: Record<string, number> };
export type JobHandler = (job: Job) => Promise<JobOutcome>;

/** A failure that a retry cannot fix: access refused, or the request itself refused. */
export const isPermanent = (e: unknown) => e instanceof AccessDenied || e instanceof RequestRefused;

/**
 * The reconcile handler: re-check the schedule (still on, still this member), act as that member through
 * resolveTenant (active membership; runReconciliation checks the permission) and run. The job id is the run's
 * idempotency key, so a job retried after its run committed replays it instead of writing twice.
 */
export function reconcileHandler(owner: Conn): JobHandler {
  return async (job) => {
    const [s] = await owner.select().from(t.reconciliationSchedules).where(and(eq(t.reconciliationSchedules.orgId, job.orgId), eq(t.reconciliationSchedules.entityId, job.entityId)));
    if (!s || !s.enabled || s.runAs !== job.runAs) return { runId: null, status: "cancelled", code: "SCHEDULE_CHANGED" };
    const [o] = await owner.select({ slug: t.organizations.slug }).from(t.organizations).where(eq(t.organizations.id, job.orgId));
    const [u] = await owner.select({ id: t.users.id, name: t.users.name, email: t.users.email }).from(t.users).where(eq(t.users.id, job.runAs));
    if (!o || !u) throw new AccessDenied(404, "Not found.");
    const ctx = await resolveTenant({ userId: u.id, name: u.name, email: u.email }, o.slug);
    const r = await runReconciliation(ctx, job.entityId, `job-${job.id}`, { trigger: job.trigger, jobId: job.id });
    const c = r.body.runCounts;
    return { runId: r.body.runId, status: "done", ...(c ? { counts: { ...c } } : {}) };
  };
}

/** One structured log line: ids, statuses, codes and counts only (never a message, a name or file content). */
export interface WorkerLog {
  event: "scheduled" | "job_claimed" | "job_done" | "job_cancelled" | "job_retry" | "job_dead";
  jobId?: string; orgId?: string; entityId?: string; runId?: string | null; attempt?: number; status?: string; code?: string;
  counts?: Record<string, number>;
}
const ID = /^[A-Za-z0-9._:@#/-]{1,128}$/;
/** Keeps only the fields above, and only values shaped like ids, codes or numbers. */
export function safeLog(e: WorkerLog): WorkerLog {
  const out: Record<string, unknown> = { event: e.event };
  for (const k of ["jobId", "orgId", "entityId", "runId", "status", "code"] as const) { const v = e[k]; if (typeof v === "string" && ID.test(v)) out[k] = v; }
  if (typeof e.attempt === "number") out.attempt = e.attempt;
  if (e.counts) out.counts = Object.fromEntries(Object.entries(e.counts).filter(([k, v]) => /^[a-zA-Z]{1,32}$/.test(k) && Number.isFinite(v)));
  return out as unknown as WorkerLog;
}

export interface WorkerOptions { owner: Conn; handler?: JobHandler; now?: () => Date; workerId?: string; maxJobs?: number; log?: (line: WorkerLog) => void }

/** One worker pass: enqueue due runs, then run due jobs until none is left (or maxJobs). */
export async function runWorkerOnce(o: WorkerOptions) {
  const now = o.now ?? (() => new Date());
  const workerId = o.workerId ?? `worker-${randomUUID()}`;
  const handler = o.handler ?? reconcileHandler(o.owner);
  const log = (l: WorkerLog) => o.log?.(safeLog(l));
  const scheduled = await enqueueDue(o.owner, now());
  if (scheduled.daily || scheduled.ruleChange) log({ event: "scheduled", counts: { ...scheduled } });
  const summary = { scheduled, done: 0, cancelled: 0, retried: 0, dead: 0 };
  for (let i = 0; i < (o.maxJobs ?? 100); i++) {
    const job = await claimJob(o.owner, workerId, now());
    if (!job) break;
    const ids = { jobId: job.id, orgId: job.orgId, entityId: job.entityId, attempt: job.attempts };
    log({ event: "job_claimed", ...ids });
    try {
      const r = await handler(job);
      await completeJob(o.owner, job, now(), r);
      log({ event: r.status === "done" ? "job_done" : "job_cancelled", ...ids, runId: r.runId, status: r.status, ...(r.code ? { code: r.code } : {}), ...(r.counts ? { counts: r.counts } : {}) });
      summary[r.status === "done" ? "done" : "cancelled"]++;
    } catch (e) {
      const code = errorCodeOf(e);
      const st = await failJob(o.owner, job, now(), code, isPermanent(e));
      log({ event: st === "dead" ? "job_dead" : "job_retry", ...ids, code });
      summary[st === "dead" ? "dead" : "retried"]++;
    }
  }
  return summary;
}
