/**
 * v1 phase 5.5: what the job worker does for operations after each pass (scripts/jobs/worker.ts):
 *   1. records its heartbeat (drizzle/0081, was 0075: ops_worker_heartbeats, through the limited jobs login);
 *   2. reads the alert metrics (ops_alert_metrics: counts only) and the backup status file;
 *   3. evaluates the alert rules (./alerts.ts) and dispatches what changed to the configured sinks (./alert-sinks.ts).
 * Every step logs ids, codes and counts only.
 */
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { dispatch, evaluate, thresholdsFromEnv, type AlertMetrics, type AlertSink, type AlertStateStore, type BackupStatus, type DispatchResult } from "./alerts";

type Conn = Db | Tx;
const WORKER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const HEARTBEAT_KEEP_DAYS = 7;

/** Upsert this worker's heartbeat and forget workers silent for a week. */
export async function recordHeartbeat(db: Conn, workerId: string, now: Date): Promise<void> {
  if (!WORKER_ID.test(workerId)) throw new Error("invalid worker id");
  await db.execute(sql`insert into ops_worker_heartbeats (worker_id, started_at, last_seen_at, passes) values (${workerId}, ${now}, ${now}, 1)
    on conflict (worker_id) do update set last_seen_at = greatest(ops_worker_heartbeats.last_seen_at, excluded.last_seen_at), passes = ops_worker_heartbeats.passes + 1`);
  await db.execute(sql`delete from ops_worker_heartbeats where last_seen_at < ${new Date(now.getTime() - HEARTBEAT_KEEP_DAYS * 86_400_000)}`);
}

/**
 * The backup job's status file (scripts/ops/backup.sh writes it): {"lastRunAt","lastStatus":"ok"|"failed","lastSuccessAt"}.
 * Missing or unreadable: lastStatus "unknown" (the rule then reports that no successful backup is recorded).
 */
export async function readBackupStatus(file: string): Promise<BackupStatus> {
  try {
    const j = JSON.parse(await readFile(file, "utf8")) as Partial<Record<keyof BackupStatus, unknown>>;
    const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
    return { lastRunAt: date(j.lastRunAt), lastStatus: j.lastStatus === "ok" || j.lastStatus === "failed" ? j.lastStatus : "unknown", lastSuccessAt: date(j.lastSuccessAt) };
  } catch {
    return { lastRunAt: null, lastStatus: "unknown", lastSuccessAt: null };
  }
}

export async function collectMetrics(db: Conn, now: Date, opts: { windowMinutes?: number; backupStatusFile?: string } = {}): Promise<AlertMetrics> {
  const windowMinutes = opts.windowMinutes ?? 15;
  const since = new Date(now.getTime() - windowMinutes * 60_000);
  const r = (await db.execute(sql`select ops_alert_metrics(${since}, ${now}) as m`)).rows[0] as { m: Record<string, unknown> };
  const m = r.m;
  const num = (k: string) => Number(m[k] ?? 0);
  const chain: AlertMetrics["chain"] = {};
  for (const [network, c] of Object.entries((m.chain ?? {}) as Record<string, { total: unknown; unavailable: unknown }>)) {
    chain[network] = { total: Number(c.total), unavailable: Number(c.unavailable) };
  }
  return {
    at: now, windowMinutes,
    failedRuns: num("failed_runs"), deadJobs: num("dead_jobs"), loginFailures: num("login_failures"), mfaFailures: num("mfa_failures"),
    queuedDue: num("queued_due"), oldestDueSeconds: num("oldest_due_seconds"),
    workerLastSeen: m.worker_last_seen ? new Date(String(m.worker_last_seen)) : null,
    chain,
    backup: opts.backupStatusFile ? await readBackupStatus(opts.backupStatusFile) : null,
  };
}

export interface AlertRunOptions {
  db: Conn;
  now: Date;
  sink: AlertSink;
  store: AlertStateStore;
  env?: Record<string, string | undefined>;
}

/** Collect, evaluate, dispatch. Returns the rule ids firing and the dispatch counts. */
export async function runAlertsOnce(o: AlertRunOptions): Promise<{ rules: string[] } & DispatchResult> {
  const env = o.env ?? process.env;
  const windowMinutes = Number(env.CLEARLINE_ALERT_WINDOW_MINUTES) >= 1 ? Math.min(Number(env.CLEARLINE_ALERT_WINDOW_MINUTES), 1440) : 15;
  const metrics = await collectMetrics(o.db, o.now, { windowMinutes, backupStatusFile: env.CLEARLINE_BACKUP_STATUS_FILE || undefined });
  const alerts = evaluate(metrics, thresholdsFromEnv(env));
  const renotify = Number(env.CLEARLINE_ALERT_RENOTIFY_MINUTES);
  const r = await dispatch(alerts, o.store, o.sink, { now: o.now, renotifyMinutes: renotify >= 5 ? renotify : 240, environment: env.CLEARLINE_DEPLOY_ENV || "local" });
  return { rules: alerts.map((a) => a.key), ...r };
}
