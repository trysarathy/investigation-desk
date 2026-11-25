/**
 * rc7 phase 3a, v1 phase 3: the job worker (no paid services, no external cron). Each pass enqueues due runs (every
 * entity's daily schedule, re-runs after a rule or policy change, and retention when this worker has the retention
 * login), then runs due jobs: reconciliations, revaluation proposals, file pickups and retention.
 *   DATABASE_URL=<runtime login> DATABASE_JOBS_URL=<jobs login> npm run worker -- [--once] [--interval-seconds 60]
 *   optional: DATABASE_RETENTION_URL=<owner login, retention only>  CLEARLINE_PICKUP_DIR=<folder of files to pick up>
 *   dead-letter: npm run worker -- --requeue <job id>   (puts one dead job back in the queue)
 * The queue uses the limited jobs login (rc8: `clearline_jobs`, never the owner; the worker refuses to start with any
 * other login). Work runs on the runtime connection under row-level security, as the job's member. Retention needs the
 * owner's rights (as the admin CLI's purge-uploads): its connection is separate and used by the retention handler only.
 *
 * Shutdown is graceful: SIGTERM or SIGINT stops claiming; the job in hand finishes (its heartbeat keeps it), then the
 * worker exits. A second signal exits at once: the job's heartbeat stops and another worker takes it back after the
 * lease (a recovery). Prints one JSON line per event with ids, codes and counts only.
 *
 * v1 phase 5.5: after each pass the worker records its heartbeat (/api/ready and the status page read it) and evaluates
 * the alert rules (src/server/ops/alerts.ts) against counts read through the same jobs login, sending what changed to
 * the configured sinks: a log line always, CLEARLINE_ALERT_FILE and CLEARLINE_ALERT_EMAIL_TO when set
 * (docs/runbooks/INCIDENT_RESPONSE.md; e-mail only through the one EmailSender, src/server/email). CLEARLINE_ALERTS=0
 * turns the rules off (the heartbeat stays). Every line goes through the structured logger and its PII scrubber.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { closeDatabase, type Db } from "../../src/server/db/client";
import { assertJobsLogin, JobsLoginRefused, requeueDeadJob, runWorkerOnce } from "../../src/server/jobs";
import { FolderPickup, workerHandlers } from "../../src/server/job-handlers";
import { assertNoChainRecordingOutsideTestBuild } from "../../src/server/test-build";
import { randomUUID } from "node:crypto";
import { emailSender } from "../../src/server/email";
import { alertSinkFromEnv } from "../../src/server/ops/alert-sinks";
import { log } from "../../src/server/ops/log";
import { recordHeartbeat, runAlertsOnce } from "../../src/server/ops/monitor";

// wave 2: every worker line goes through the structured logger (E4: PII scrubber), one JSON line per event
const out = (o: Record<string, unknown>) => { const { event, ...rest } = o; log.info(String(event), rest); };

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const i = args.indexOf("--interval-seconds");
  const intervalMs = Math.max(5, Number(i >= 0 ? args[i + 1] : 60)) * 1000;
  const rq = args.indexOf("--requeue");
  assertNoChainRecordingOutsideTestBuild(); // rc8: recorded chain data never reaches a scheduled run
  const jobsUrl = process.env.DATABASE_JOBS_URL;
  if (!jobsUrl || !process.env.DATABASE_URL) throw new Error(CONFIG);
  const pool = new Pool({ connectionString: jobsUrl, max: 2 });
  const queue = drizzle(pool, { schema }) as Db;
  const retentionPool = process.env.DATABASE_RETENTION_URL ? new Pool({ connectionString: process.env.DATABASE_RETENTION_URL, max: 1 }) : null;
  let signals = 0;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => {
    signals++;
    out({ event: signals === 1 ? "stopping" : "stopped_now" });
    if (signals > 1) process.exit(130);
  });
  const stop = () => signals > 0;
  const workerId = `worker-${randomUUID()}`;
  const alerts = process.env.CLEARLINE_ALERTS === "0" ? null : alertSinkFromEnv(process.env, () => emailSender());
  try {
    await assertJobsLogin(queue);
    if (rq >= 0) {
      const id = args[rq + 1] ?? "";
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("--requeue needs a job id");
      out({ event: "requeue", jobId: id, requeued: await requeueDeadJob(queue, id, new Date()) });
      return;
    }
    const handlers = workerHandlers(queue, {
      ...(retentionPool ? { retention: drizzle(retentionPool, { schema }) as Db } : {}),
      ...(process.env.CLEARLINE_PICKUP_DIR ? { pickup: new FolderPickup(process.env.CLEARLINE_PICKUP_DIR) } : {}),
    });
    out({ event: "started", kinds: Object.keys(handlers) });
    if (alerts) log.info("alerts_enabled", { sinks: alerts.kinds.join(",") });
    do {
      const s = await runWorkerOnce({ queue, workerId, handlers, retention: !!retentionPool, shouldStop: stop, log: (l) => out({ ...l }) });
      out({ event: "pass", ...s.scheduled, retention: s.retention, done: s.done, cancelled: s.cancelled, retried: s.retried, dead: s.dead });
      try {
        await recordHeartbeat(queue, workerId, new Date());
        if (alerts) {
          const a = await runAlertsOnce({ db: queue, now: new Date(), sink: alerts.sink, store: alerts.store });
          if (a.sent || a.resolved || a.failed) log.info("alerts_dispatched", { firing: a.firing, sent: a.sent, resolved: a.resolved, failed: a.failed });
        }
      } catch (e) { log.error("ops_monitor_failed", e); }
      if (once) break;
      for (let w = 0; w < intervalMs && !stop(); w += 1000) await new Promise((r) => setTimeout(r, 1000));
    } while (!stop());
    out({ event: "stopped" });
  } finally {
    await pool.end();
    await retentionPool?.end();
    await closeDatabase();
  }
}

const CONFIG = "set DATABASE_URL (runtime login) and DATABASE_JOBS_URL (jobs login)";
main().catch((e) => {
  log.error("worker_failed", e, { ...((e as Error)?.message === CONFIG ? { hint: CONFIG } : {}), ...(e instanceof JobsLoginRefused ? { reasons: e.reasons } : {}) });
  process.exitCode = 1;
});
