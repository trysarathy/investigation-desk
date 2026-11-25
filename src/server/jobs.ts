import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";
import type { JobStatus } from "./db/ops-schema";
import { runReconciliation, type RunStage } from "./merchant";
import { RULE_SET_VERSION, errorCodeOf } from "./runs";
import { AccessDenied, resolveTenant, type TenantContext } from "./tenant";
import { RequestRefused } from "./errors";

/**
 * rc7 phase 3a, v1 phase 3: a job queue in PostgreSQL, the schedules, and the worker that runs them.
 *
 * - The queue and the scheduler use their own login, `clearline_jobs` (rc8, migrations 0029 and 0064): it reads and
 *   writes the jobs and job events, reads the schedules, and reaches merchant data only through narrow SECURITY
 *   DEFINER functions (what enqueueDue needs; who a job runs as; which organisations have uploads past retention). It is
 *   not the owner, has no BYPASSRLS and cannot change the schema; `assertJobsLogin` refuses any other login at worker
 *   start. Work itself runs on the runtime connection under row-level security, as the member the job is for; that
 *   member's access is checked again at every run (a revoked member's job dies).
 * - Kinds (v1 phase 3): `reconcile` (a daily schedule, a rule or policy change, or a member's "run in the background"),
 *   `revaluation` and `pickup` (a member's request), and `retention` (per organisation, daily, run with the retention
 *   login only when the worker is given one; see retentionHandler).
 * - Claiming is `SELECT … FOR UPDATE SKIP LOCKED`: two workers never take the same job. A running job sends a heartbeat;
 *   one whose heartbeat stopped for longer than the lease (its worker vanished) is taken again and counted as a
 *   recovery. Failures retry with exponential backoff; after max attempts, or on an error a retry cannot fix (access, a
 *   refused request), the job is dead (the dead-letter queue: status 'dead', kept with its last error code, re-queued
 *   only by an operator).
 * - Every step is a job event (claimed, stage, done, retry, dead, recovered): the progress members see.
 * - (org, entity, dedupe key) is unique: an entity's day is enqueued once, and so is each rule version.
 * - Logs and events carry ids, statuses, stages, codes and counts only.
 */

export type Job = typeof t.jobs.$inferSelect;
export type Conn = Db | Tx;
const MINUTE = 60_000;
/** A running job whose last heartbeat (or claim) is older than this is taken again. */
export const LEASE_MS = 15 * MINUTE;
/** How often a running job's heartbeat is written. */
export const HEARTBEAT_MS = 30_000;
/** Retry delay after the nth failed attempt: 1, 2, 4, 8 … minutes, at most one hour. */
export const backoffMs = (attempts: number) => Math.min(MINUTE * 2 ** Math.max(attempts - 1, 0), 60 * MINUTE);

/** An entity's merchant-day clock (its fixed UTC offset, as the engine's merchant day). */
export function localClock(now: Date, utcOffsetMinutes: number) {
  const iso = new Date(now.getTime() + utcOffsetMinutes * MINUTE).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export interface ScheduleResult { daily: number; ruleChange: number }
interface DueSchedule {
  org_id: string; entity_id: string; local_time: string; run_as: string; utc_offset_minutes: number;
  prev_rule_set_version: string | null; prev_policy_revision: number | null; policy_revision: number;
}

/**
 * Enqueue every due run: an entity's daily run once its local time has passed the schedule's time (once per local
 * day), and a re-run when the rule-set version or the policy revision differs from the entity's last run.
 */
export async function enqueueDue(db: Conn, now: Date, ruleSetVersion = RULE_SET_VERSION): Promise<ScheduleResult> {
  // Every enabled schedule with its entity's offset, the last run that did not fail and the current policy revision
  // (the same reads as runState, through the jobs login's one function).
  const due = (await db.execute(sql`select * from jobs_due_schedules()`)).rows as unknown as DueSchedule[];
  const out: ScheduleResult = { daily: 0, ruleChange: 0 };
  for (const s of due) {
    const base = { orgId: s.org_id, entityId: s.entity_id, runAs: s.run_as, runAfter: now };
    const clock = localClock(now, Number(s.utc_offset_minutes));
    if (clock.time >= s.local_time) {
      const r = await db.insert(t.jobs).values({ ...base, trigger: "schedule", dedupeKey: `day:${clock.date}` }).onConflictDoNothing().returning({ id: t.jobs.id });
      out.daily += r.length;
    }
    const policyRevision = Number(s.policy_revision);
    if (s.prev_rule_set_version !== null && (s.prev_rule_set_version !== ruleSetVersion || Number(s.prev_policy_revision) !== policyRevision)) {
      const r = await db.insert(t.jobs).values({ ...base, trigger: "rule_change", dedupeKey: `rules:${ruleSetVersion}/p${policyRevision}` }).onConflictDoNothing().returning({ id: t.jobs.id });
      out.ruleChange += r.length;
    }
  }
  return out;
}

/** v1 phase 3: one retention job per organisation and UTC day, for each organisation with an upload past its date. */
export async function enqueueRetention(db: Conn, now: Date): Promise<number> {
  const due = (await db.execute(sql`select org_id from jobs_retention_due(${now})`)).rows as { org_id: string }[];
  let n = 0;
  for (const d of due) {
    n += (await db.insert(t.jobs).values({ orgId: d.org_id, entityId: null, runAs: null, kind: "retention", trigger: "schedule", dedupeKey: `retention:${now.toISOString().slice(0, 10)}`, runAfter: now })
      .onConflictDoNothing().returning({ id: t.jobs.id })).length;
  }
  return n;
}

/** Append a job event (ids, stage, code and counts only). */
export async function jobEvent(db: Conn, job: Pick<Job, "id" | "orgId">, event: (typeof t.JOB_EVENTS)[number], extra: { stage?: string; attempt?: number; code?: string; counts?: Record<string, number> } = {}) {
  await db.insert(t.jobEvents).values({ orgId: job.orgId, jobId: job.id, event, stage: extra.stage ?? null, attempt: extra.attempt ?? null, code: extra.code ?? null, counts: extra.counts ?? null });
}

/**
 * Take the next due job (or a running one whose heartbeat stopped longer than the lease ago: its worker vanished).
 * Never returns a job another live worker holds. A job taken back is counted as a recovery, with an event.
 */
export async function claimJob(db: Conn, workerId: string, now: Date): Promise<Job | null> {
  const stale = new Date(now.getTime() - LEASE_MS);
  const r = await db.execute(sql`
    with next as (
      select id, status as was from jobs
      where (status = 'queued' and run_after <= ${now}) or (status = 'running' and coalesce(heartbeat_at, locked_at) < ${stale})
      order by run_after, created_at, id
      limit 1
      for update skip locked
    )
    update jobs set status = 'running', attempts = least(jobs.attempts + 1, jobs.max_attempts), locked_at = ${now}, locked_by = ${workerId}, heartbeat_at = ${now},
      recoveries = jobs.recoveries + case when next.was = 'running' then 1 else 0 end, stage = null
    from next where jobs.id = next.id
    returning jobs.id, next.was`);
  const row = r.rows[0] as { id?: string; was?: string } | undefined;
  if (!row?.id) return null;
  const [job] = await db.select().from(t.jobs).where(eq(t.jobs.id, String(row.id)));
  if (!job) return null;
  if (row.was === "running") await jobEvent(db, job, "recovered", { attempt: job.attempts });
  await jobEvent(db, job, "claimed", { attempt: job.attempts });
  return job;
}

const mine = (job: Job) => and(eq(t.jobs.id, job.id), eq(t.jobs.status, "running"), eq(t.jobs.lockedBy, job.lockedBy ?? ""));

/** The worker still holds the job: refresh its heartbeat (and the stage it is at). False when it no longer holds it. */
export async function heartbeat(db: Conn, job: Job, now: Date, stage?: string): Promise<boolean> {
  const r = await db.update(t.jobs).set({ heartbeatAt: now, ...(stage ? { stage } : {}) }).where(mine(job)).returning({ id: t.jobs.id });
  return r.length > 0;
}

export async function completeJob(db: Conn, job: Job, now: Date, outcome: { runId?: string | null; status?: Extract<JobStatus, "done" | "cancelled">; code?: string; result?: unknown; counts?: Record<string, number> } = {}) {
  const status = outcome.status ?? "done";
  const r = await db.update(t.jobs).set({ status, runId: outcome.runId ?? null, lastErrorCode: outcome.code ?? null, finishedAt: now, lockedAt: null, lockedBy: null, stage: status === "done" ? "done" : null,
    ...(outcome.result !== undefined ? { result: outcome.result } : {}) }).where(mine(job)).returning({ id: t.jobs.id });
  if (r.length) await jobEvent(db, job, status === "done" ? "done" : "cancelled", { attempt: job.attempts, ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.counts ? { counts: outcome.counts } : {}) });
}

/** Retry later with backoff, or dead after the last attempt (or at once for a failure a retry cannot fix). */
export async function failJob(db: Conn, job: Job, now: Date, code: string, permanent: boolean): Promise<"queued" | "dead"> {
  const dead = permanent || job.attempts >= job.maxAttempts;
  const r = await db.update(t.jobs).set(dead
    ? { status: "dead", lastErrorCode: code, finishedAt: now, lockedAt: null, lockedBy: null }
    : { status: "queued", lastErrorCode: code, runAfter: new Date(now.getTime() + backoffMs(job.attempts)), lockedAt: null, lockedBy: null }).where(mine(job)).returning({ id: t.jobs.id });
  if (r.length) await jobEvent(db, job, dead ? "dead" : "retry", { attempt: job.attempts, code });
  return dead ? "dead" : "queued";
}

/**
 * The dead-letter queue: an operator puts a dead job back in the queue (fresh attempts, due now), with an event. Only
 * a dead job; its history is kept. (CLI only: `npm run worker -- --requeue <job id>`, with the jobs login.)
 */
export async function requeueDeadJob(db: Conn, jobId: string, now: Date): Promise<boolean> {
  const r = await db.update(t.jobs).set({ status: "queued", attempts: 0, runAfter: now, finishedAt: null, lockedAt: null, lockedBy: null, stage: null })
    .where(and(eq(t.jobs.id, jobId), eq(t.jobs.status, "dead"))).returning();
  if (r[0]) await jobEvent(db, r[0], "requeued", { code: r[0].lastErrorCode ?? undefined });
  return r.length > 0;
}

export type JobOutcome = { runId: string | null; status: "done" | "cancelled"; code?: string; counts?: Record<string, number>; result?: unknown };
/** What a handler may do while it runs: report the stage it starts (an event, and the job's stage for the UI). */
export interface JobContext { stage: (stage: string) => Promise<void> }
export type JobHandler = (job: Job, run: JobContext) => Promise<JobOutcome>;

/** A failure that a retry cannot fix: access refused, or the request itself refused. */
export const isPermanent = (e: unknown) => e instanceof AccessDenied || e instanceof RequestRefused;

type Principal = { slug: string; user_id: string; name: string; email: string };

/**
 * Who a job acts as. A scheduled or rule-change job: the member on the entity's schedule, while it is enabled and still
 * names them (else the job is cancelled: SCHEDULE_CHANGED). A manual job: the member who asked, while their
 * membership is active. Then resolveTenant signs in as them (active membership, entity scope) and the work checks
 * the permission: a revoked member's job dies (ACCESS_*).
 */
export async function principalOf(queue: Conn, job: Job): Promise<TenantContext | "schedule_changed"> {
  if (!job.entityId || !job.runAs) throw new AccessDenied(404, "Not found.");
  let p: Principal | undefined;
  if (job.trigger === "manual") {
    p = (await queue.execute(sql`select * from jobs_requester_principal(${job.orgId}::uuid, ${job.runAs})`)).rows[0] as Principal | undefined;
  } else {
    const [s] = await queue.select().from(t.reconciliationSchedules).where(and(eq(t.reconciliationSchedules.orgId, job.orgId), eq(t.reconciliationSchedules.entityId, job.entityId)));
    if (!s || !s.enabled || s.runAs !== job.runAs) return "schedule_changed";
    p = (await queue.execute(sql`select * from jobs_run_principal(${job.orgId}::uuid, ${job.entityId}, ${job.runAs})`)).rows[0] as Principal | undefined;
  }
  if (!p) throw new AccessDenied(404, "Not found.");
  return resolveTenant({ userId: p.user_id, name: p.name, email: p.email }, p.slug);
}

/**
 * The reconcile handler: act as the job's member and run. The job id is the run's idempotency key, so a job retried
 * after its run committed replays it instead of writing twice. Each stage of the run becomes a job event.
 */
export function reconcileHandler(queue: Conn): JobHandler {
  return async (job, run) => {
    const ctx = await principalOf(queue, job);
    if (ctx === "schedule_changed") return { runId: null, status: "cancelled", code: "SCHEDULE_CHANGED" };
    const r = await runReconciliation(ctx, job.entityId!, `job-${job.id}`, { trigger: job.trigger, jobId: job.id, onStage: (s: RunStage) => run.stage(s) });
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

export interface WorkerOptions {
  queue: Conn;
  /** One handler for every job (tests), or handlers by kind (the worker). Default: reconcile only. */
  handler?: JobHandler; handlers?: Partial<Record<Job["kind"], JobHandler>>;
  now?: () => Date; workerId?: string; maxJobs?: number; log?: (line: WorkerLog) => void;
  /** Checked before each claim: true stops the pass after the job in hand (graceful shutdown). */
  shouldStop?: () => boolean;
  /** Enqueue retention jobs too (only a worker that has the retention login). */
  retention?: boolean;
  heartbeatMs?: number;
}

/**
 * The worker's queue login must be the limited `clearline_jobs` role: not a superuser, no BYPASSRLS, no CREATEROLE or
 * CREATEDB, owns no table, schema or database, cannot create in the schema, and is neither the owner nor the runtime
 * login. Anything else (the owner login above all) is refused before the worker does any work. Reasons are codes only.
 */
export async function assertJobsLogin(db: Conn): Promise<void> {
  const r = (await db.execute(sql`
    select r.rolsuper as super, r.rolbypassrls as bypass, r.rolcreaterole or r.rolcreatedb as create_roles_or_db,
      has_schema_privilege('public', 'CREATE') as schema_create,
      exists (select 1 from pg_class c where c.relowner = r.oid) or exists (select 1 from pg_namespace n where n.nspowner = r.oid)
        or exists (select 1 from pg_database d where d.datdba = r.oid) as owns,
      pg_has_role(current_user, 'clearline_owner', 'MEMBER') as owner_member,
      pg_has_role(current_user, 'clearline_app', 'MEMBER') as runtime_member,
      exists (select 1 from pg_roles j where j.rolname = 'clearline_jobs') and pg_has_role(current_user, 'clearline_jobs', 'MEMBER') as jobs_member
    from pg_roles r where r.rolname = current_user`)).rows[0] as Record<string, boolean> | undefined;
  if (!r) throw new JobsLoginRefused(["UNKNOWN_LOGIN"]);
  const reasons = [
    ...(r.super ? ["SUPERUSER"] : []), ...(r.bypass ? ["BYPASSRLS"] : []), ...(r.create_roles_or_db ? ["CREATEROLE_OR_CREATEDB"] : []),
    ...(r.schema_create ? ["SCHEMA_CREATE"] : []), ...(r.owns ? ["OWNS_OBJECTS"] : []), ...(r.owner_member ? ["OWNER_LOGIN"] : []),
    ...(r.runtime_member ? ["RUNTIME_LOGIN"] : []), ...(r.jobs_member ? [] : ["NOT_JOBS_LOGIN"]),
  ];
  if (reasons.length) throw new JobsLoginRefused(reasons);
}
export class JobsLoginRefused extends Error {
  readonly code = "JOBS_LOGIN_REFUSED";
  constructor(readonly reasons: string[]) { super(`JOBS_LOGIN_REFUSED: ${reasons.join(",")}`); }
}

/** Run one claimed job with its heartbeat; returns how it ended. */
async function runOne(o: WorkerOptions, job: Job, handler: JobHandler | undefined, now: () => Date, log: (l: WorkerLog) => void) {
  const ids = { jobId: job.id, orgId: job.orgId, ...(job.entityId ? { entityId: job.entityId } : {}), attempt: job.attempts };
  log({ event: "job_claimed", ...ids });
  let beat: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => { beat = beat.then(() => heartbeat(o.queue, job, now())).catch(() => undefined); }, o.heartbeatMs ?? HEARTBEAT_MS);
  try {
    if (!handler) throw new RequestRefused(422, "NO_HANDLER", "This worker does not run this kind of job.");
    const r = await handler(job, { stage: async (stage) => { await heartbeat(o.queue, job, now(), stage); await jobEvent(o.queue, job, "stage", { stage, attempt: job.attempts }); } });
    clearInterval(timer); await beat;
    await completeJob(o.queue, job, now(), r);
    log({ event: r.status === "done" ? "job_done" : "job_cancelled", ...ids, runId: r.runId, status: r.status, ...(r.code ? { code: r.code } : {}), ...(r.counts ? { counts: r.counts } : {}) });
    return r.status === "done" ? "done" : "cancelled";
  } catch (e) {
    clearInterval(timer); await beat;
    const code = errorCodeOf(e);
    const st = await failJob(o.queue, job, now(), code, isPermanent(e));
    log({ event: st === "dead" ? "job_dead" : "job_retry", ...ids, code });
    return st === "dead" ? "dead" : "retried";
  }
}

/** One worker pass: enqueue due runs, then run due jobs until none is left (or maxJobs, or a stop request). */
export async function runWorkerOnce(o: WorkerOptions) {
  const now = o.now ?? (() => new Date());
  const workerId = o.workerId ?? `worker-${randomUUID()}`;
  const handlers: Partial<Record<Job["kind"], JobHandler>> = o.handlers ?? { reconcile: reconcileHandler(o.queue) };
  const log = (l: WorkerLog) => o.log?.(safeLog(l));
  const scheduled = await enqueueDue(o.queue, now());
  const retention = o.retention ? await enqueueRetention(o.queue, now()) : 0;
  if (scheduled.daily || scheduled.ruleChange) log({ event: "scheduled", counts: { ...scheduled } });
  const summary = { scheduled, retention, done: 0, cancelled: 0, retried: 0, dead: 0 };
  for (let i = 0; i < (o.maxJobs ?? 100); i++) {
    if (o.shouldStop?.()) break;
    const job = await claimJob(o.queue, workerId, now());
    if (!job) break;
    summary[await runOne(o, job, o.handler ?? handlers[job.kind], now, log)]++;
  }
  return summary;
}
