/**
 * v1 phase 5.6: the retention job as a long-running process, next to the job worker (src/server/privacy/retention.ts):
 *   DATABASE_OWNER_URL=<schema owner login> npm run jobs:retention -- [--once] [--dry-run] [--interval-hours 24]
 * It runs on the schema OWNER login (deleting append-only audit rows and uploads needs it) and refuses any other login.
 * It is deliberately NOT inside the job worker: the worker's queue login (`clearline_jobs`) is limited on purpose and
 * is never given the owner's rights. Schedule this process (or `control:admin -- retention`) once a day. Every pass is
 * recorded in retention_runs; it prints one JSON line per pass with counts only.
 */
import { closeDatabase } from "../../src/server/db/client";
import { openOwnerDb } from "../../src/server/merchant-setup";
import { runRetention } from "../../src/server/privacy/retention";

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once"), dryRun = args.includes("--dry-run");
  const i = args.indexOf("--interval-hours");
  const hours = i >= 0 ? Number(args[i + 1]) : 24;
  if (!Number.isFinite(hours) || hours < 1) throw new Error("--interval-hours is at least 1");
  const { db, close } = await openOwnerDb(process.env.DATABASE_OWNER_URL);
  let stop = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stop = true; });
  try {
    do {
      const r = await runRetention(db, { now: new Date(), dryRun });
      console.log(JSON.stringify({ event: "retention_pass", runId: r.runId, dryRun: r.dryRun, counts: r.counts }));
      if (once) break;
      for (let w = 0; w < hours * 3_600_000 && !stop; w += 1000) await new Promise((res) => setTimeout(res, 1000));
    } while (!stop);
  } finally {
    await close();
    await closeDatabase();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "retention_failed", code: (e as { code?: string })?.code ?? "INTERNAL", message: e instanceof Error && /DATABASE_OWNER_URL|interval-hours/.test(e.message) ? e.message : undefined }));
  process.exit(1);
});
