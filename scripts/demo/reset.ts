/**
 * `npm run demo:reset` — put the demo back to the seeded state: end every session on the demo database, drop it and
 * create it again from the template `npm run demo` made after seeding. Prints how long it took (target < 30 s).
 * A running demo app recovers by itself: its connection pool opens new connections on the next request.
 */
import path from "node:path";
import { DB, DemoStop, FEEDBACK_DIR, STATE_DIR, TEMPLATE, fmtMs, readState } from "./lib";

async function main() {
  const s = readState();
  if (!s?.steps.template) throw new DemoStop("There is no seeded demo to reset to yet: run `npm run demo` first.");
  const { resetDemoDatabase } = await import("../../src/server/demo-reset");
  const t0 = performance.now();
  const r = await resetDemoDatabase({ adminUrl: s.pg.superUrl, database: DB, template: TEMPLATE, uploadDir: path.join(STATE_DIR, "uploads"), feedbackDir: FEEDBACK_DIR });
  const total = Math.round(performance.now() - t0);
  process.stdout.write(`Demo reset to the seeded state in ${fmtMs(total)} (database ${fmtMs(r.ms)}; target < 30 s). Demo · fictional data.\n`);
  if (r.feedbackSaved) process.stdout.write(`${r.feedbackSaved} presenter feedback note(s) were saved to .demo/feedback/ before the reset; \`npm run demo:feedback\` exports them.\n`);
  if (total > 30_000) process.exitCode = 3;
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`\nnpm run demo:reset stopped: ${msg}\n${e instanceof DemoStop ? "" : "If the demo database is gone, `npm run demo` recreates it from the template (or seeds again with --fresh).\n"}`);
  process.exitCode = e instanceof DemoStop ? 2 : 1;
});
