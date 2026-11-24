/**
 * rc7 phase 3a: the job worker (no paid services, no external cron). Each pass enqueues due runs (every entity's
 * daily schedule, and re-runs after a rule or policy change), then runs due jobs.
 *   DATABASE_URL=<runtime login> DATABASE_JOBS_URL=<jobs login> npm run jobs:worker -- [--once] [--interval-seconds 60]
 * The queue uses the limited jobs login (rc8: `clearline_jobs`, never the owner; the worker refuses to start with any
 * other login); reconciliation runs on the runtime connection under row-level security, as the member who set the
 * schedule. Retention (purge-uploads) is not run here: it stays an owner-only admin CLI command. Prints one JSON line
 * per event with ids, codes and counts only.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { closeDatabase, type Db } from "../../src/server/db/client";
import { assertJobsLogin, JobsLoginRefused, runWorkerOnce } from "../../src/server/jobs";
import { assertNoChainRecordingOutsideTestBuild } from "../../src/server/test-build";

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const i = args.indexOf("--interval-seconds");
  const intervalMs = Math.max(5, Number(i >= 0 ? args[i + 1] : 60)) * 1000;
  assertNoChainRecordingOutsideTestBuild(); // rc8: recorded chain data never reaches a scheduled run
  const jobsUrl = process.env.DATABASE_JOBS_URL;
  if (!jobsUrl || !process.env.DATABASE_URL) throw new Error(CONFIG);
  const pool = new Pool({ connectionString: jobsUrl, max: 2 });
  const queue = drizzle(pool, { schema }) as Db;
  let stop = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stop = true; });
  try {
    await assertJobsLogin(queue);
    do {
      const s = await runWorkerOnce({ queue, log: (l) => console.log(JSON.stringify(l)) });
      console.log(JSON.stringify({ event: "pass", ...s.scheduled, done: s.done, cancelled: s.cancelled, retried: s.retried, dead: s.dead }));
      if (once) break;
      for (let w = 0; w < intervalMs && !stop; w += 1000) await new Promise((r) => setTimeout(r, 1000));
    } while (!stop);
  } finally {
    await pool.end();
    await closeDatabase();
  }
}

const CONFIG = "set DATABASE_URL (runtime login) and DATABASE_JOBS_URL (jobs login)";
main().catch((e) => {
  console.error(JSON.stringify({ event: "worker_failed", code: (e as { code?: string })?.code ?? "INTERNAL", ...((e as Error)?.message === CONFIG ? { hint: CONFIG } : {}),
    ...(e instanceof JobsLoginRefused ? { reasons: e.reasons } : {}) }));
  process.exit(1);
});
