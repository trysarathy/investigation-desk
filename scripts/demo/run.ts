/**
 * `npm run demo` — the local, offline Clearline demo with fictional data ("Demo · fictional data").
 *
 *   (a) PostgreSQL 16: CLEARLINE_DEMO_PG_URL, a server already answering on the demo port, or Docker
 *       (docker-compose.demo.yml, postgres:16 on 127.0.0.1:54330, named volume);
 *   (b) the demo database and the owner, runtime and jobs logins (random passwords in .demo/state.json, mode 0600);
 *   (c) migrations; (d) the demo world, seeded day by day with a reconciliation after each day;
 *   (e) a template copy of the seeded database for `npm run demo:reset`;
 *   (f) a DEMO build (CLEARLINE_DEMO_BUILD=1, CLEARLINE_CONTROL_PILOT=1) into .next-demo;
 *   (g) the app on http://127.0.0.1:3100 (CLEARLINE_DEMO_PORT), with the recorded chain file; then it prints the URL,
 *       the demo logins and the shared demo password.
 * Run again: reuses .demo/state.json and skips what is done. `--fresh` drops the demo databases and does it all
 * again. `--no-start` stops after the build. `--reset-role-passwords` (shared servers only; see the runbook).
 * `npm run demo --fresh` also works (npm passes it as npm_config_fresh).
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import {
  APP_PORT, DB, DIST, DemoStop, ORIGIN, RECORDING, ROOT, STATE_DIR, TEMPLATE, UPLOADS, appEnv, canConnect, demoPassword, dropDemoDatabases, ensureLogins, ensurePostgres, fmtMs, loginUrl, portAnswers,
  readState, secret, withDb, writeState, type DemoState,
} from "./lib";

const flag = (name: string) => process.argv.includes(`--${name}`) || process.env[`npm_config_${name.replace(/-/g, "_")}`] === "true";
const FRESH = flag("fresh"), NO_START = flag("no-start"), RESET_ROLES = flag("reset-role-passwords");
const out = (s: string) => process.stdout.write(`${s}\n`);
const step = (s: string) => out(`\n▸ ${s}`);

function gitHead(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; }
}
function treeDirty(): boolean {
  try { return execFileSync("git", ["status", "--porcelain", "--", "src", "next.config.mjs", "package.json"], { cwd: ROOT, encoding: "utf8" }).trim() !== ""; } catch { return true; }
}

async function main() {
  const timings: Record<string, number> = {};
  const lap = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => { const t0 = performance.now(); try { return await fn(); } finally { timings[name] = Math.round(performance.now() - t0); } };
  const started = performance.now();
  out("Clearline demo · Demo · fictional data (local, offline)");
  const prev = readState();

  step("PostgreSQL");
  const pg = await lap("postgres", () => ensurePostgres(prev, out));
  out(`  using ${pg.kind === "docker" ? "Docker (docker-compose.demo.yml)" : "the server in CLEARLINE_DEMO_PG_URL"} on 127.0.0.1:${pg.port}`);
  const s: DemoState = prev ?? {
    version: 1, pg, passwords: { owner: secret(), runtime: secret(), jobs: secret(), demo: demoPassword() }, authSecret: secret(32), uploadKey: randomBytes(32).toString("base64"), steps: {},
  };
  s.pg = pg;
  if (FRESH && prev) {
    step("--fresh: dropping the demo databases and the demo build");
    await dropDemoDatabases(s).catch(() => undefined);
    s.steps = {};
    rmSync(UPLOADS, { recursive: true, force: true });
    rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
  }
  writeState(s);

  step("Database and logins");
  await lap("database", async () => {
    const exists = (await canConnect(withDb(s.pg.superUrl, DB))).ok;
    // a database left half-seeded (an interrupted run) is started again from empty
    if (!s.steps.seed && exists) await dropDemoDatabases(s);
    // a seeded demo whose database is gone (a failed reset): back from the template, or seeded again without one
    if (s.steps.seed && !exists) {
      if (s.steps.template) { const { resetDemoDatabase } = await import("../../src/server/demo-reset"); await resetDemoDatabase({ adminUrl: s.pg.superUrl, database: DB }); out("  the demo database was missing: restored from the template"); }
      else { delete s.steps.seed; }
    }
    await ensureLogins(s, { resetPasswords: RESET_ROLES });
  });
  s.steps.database = new Date().toISOString(); writeState(s);
  out(`  ${DB} with clearline_owner, clearline_runtime, clearline_jobs (passwords in .demo/state.json)`);

  step("Migrations");
  await lap("migrations", () => { execFileSync(path.join(ROOT, "node_modules/.bin/drizzle-kit"), ["migrate"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, DATABASE_OWNER_URL: loginUrl(s, "owner") } }); });
  s.steps.migrations = new Date().toISOString(); writeState(s);
  out("  up to date");
  // a template made by an older checkout lacks the newer migrations (a reset would bring back the old schema): bring
  // it up to date too, without touching its seeded rows
  if (s.steps.template) await lap("template migrations", async () => { if (await migrateTemplate(s)) out(`  ${TEMPLATE} brought up to date as well`); });

  step("Recorded chain file");
  const { demoWorld } = await import("../../src/lib/clearline/demo/world");
  const { allDemoTransfers } = await import("../../src/lib/clearline/demo/next-day");
  const { recordingOf } = await import("../../src/lib/clearline/merchant/chain");
  const demo = demoWorld();
  const recording = recordingOf(allDemoTransfers(demo));
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(RECORDING, JSON.stringify(recording));
  mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });
  out(`  ${recording.transfers.length} transfers (every demo transfer) in .demo/chain-recording.json`);

  if (!s.steps.seed) {
    step("Seeding the demo world (30 days, a reconciliation after each day)");
    await lap("seed", async () => {
      process.env.DATABASE_URL = loginUrl(s, "runtime");
      const { installDemoClock } = await import("./clock");
      const { seedDemo, restampDemoSeed } = await import("../../src/server/demo-seed");
      const { closeDatabase } = await import("../../src/server/db/client");
      const schema = await import("../../src/server/db/schema");
      const pool = new Pool({ connectionString: loginUrl(s, "owner"), max: 4 });
      const clock = installDemoClock();
      try {
        const owner = drizzle(pool, { schema }) as never;
        const { stampWindows, ...seeded } = await seedDemo(owner, { password: s.passwords.demo, recording, setClock: clock.set, log: (l) => out(`  ${l}`) });
        // database defaults (now()) took the machine clock: move them to the demo day that wrote them
        const re = await restampDemoSeed(s.pg.superUrl, DB, stampWindows);
        out(`  ${re.rows} database-stamped times moved to the demo calendar (${Object.keys(re.columns).length} columns)`);
        s.seed = seeded as unknown as Record<string, unknown>;
      } finally { clock.restore(); await pool.end(); await closeDatabase(); }
    });
    s.steps.seed = new Date().toISOString(); delete s.steps.template; writeState(s);
  } else out("\n▸ Seed: already done (use --fresh to seed again)");

  step("Demo calendar for live actions");
  await lap("live clock", async () => {
    const n = await installLiveClockOn(s, DB);
    // a template made before this step existed: give it the same defaults, so a reset keeps them
    if (s.steps.template && (await templateExists(s))) await withTemplateOpen(s, () => installLiveClockOn(s, TEMPLATE));
    out(`  live actions of the demo organisations are stamped on the demo calendar (${n} database defaults; src/server/demo-live-clock.ts)`);
  });

  if (!s.steps.template) {
    step("Template for fast reset");
    const { snapshotDemoTemplate } = await import("../../src/server/demo-reset");
    await lap("template", () => snapshotDemoTemplate({ adminUrl: s.pg.superUrl, database: DB }));
    s.steps.template = new Date().toISOString(); writeState(s);
    out(`  ${TEMPLATE}`);
  }

  const stamp = `${gitHead()}${treeDirty() ? "+dirty" : ""}`;
  const buildOk = () => {
    if (!existsSync(path.join(ROOT, DIST, "BUILD_ID"))) return false;
    try { execFileSync(process.execPath, [path.join(ROOT, "scripts/build/check-chain-recording.mjs"), "--marker", "demo", "--expect", "present"], { cwd: ROOT, env: { ...process.env, NEXT_DIST_DIR: DIST }, stdio: "ignore" }); return true; } catch { return false; }
  };
  if (s.steps.build !== stamp || stamp.endsWith("+dirty") || !buildOk()) {
    step("Demo build (CLEARLINE_DEMO_BUILD=1, into .next-demo)");
    const logFile = path.join(STATE_DIR, "build.log");
    await lap("build", () => {
      const fd = openSync(logFile, "w", 0o600);
      try { execFileSync(path.join(ROOT, "node_modules/.bin/next"), ["build"], { cwd: ROOT, env: appEnv(s), stdio: ["ignore", fd, fd] }); }
      catch { throw new DemoStop(`next build failed; see .demo/build.log:\n${readFileSync(logFile, "utf8").split("\n").slice(-25).join("\n")}`); }
      finally { closeSync(fd); }
    });
    out("  built (output in .demo/build.log)");
    execFileSync(process.execPath, [path.join(ROOT, "scripts/build/check-chain-recording.mjs"), "--marker", "demo", "--expect", "present"], { cwd: ROOT, env: { ...process.env, NEXT_DIST_DIR: DIST }, stdio: "inherit" });
    s.steps.build = stamp; writeState(s);
  } else out("\n▸ Demo build: up to date");

  s.timingsMs = { ...(s.timingsMs ?? {}), ...timings, total: Math.round(performance.now() - started) };
  writeState(s);
  step("Timings");
  for (const [k, v] of Object.entries(s.timingsMs)) if (k in timings || k === "total") out(`  ${k.padEnd(11)} ${fmtMs(v)}`);

  if (NO_START) { printAccess(s); return; }
  step(`Starting the app on ${ORIGIN}`);
  if (await portAnswers(APP_PORT)) throw new DemoStop(`Port ${APP_PORT} is already in use. Stop whatever uses it (an earlier \`npm run demo\`?), or set CLEARLINE_DEMO_PORT to a free port.`);
  const child = spawn(path.join(ROOT, "node_modules/.bin/next"), ["start", "-H", "127.0.0.1", "-p", String(APP_PORT)], { cwd: ROOT, env: appEnv(s), stdio: ["ignore", "inherit", "inherit"] });
  writeFileSync(path.join(STATE_DIR, "server.pid"), String(child.pid));
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${ORIGIN}/control/sign-in`, { redirect: "manual" }); if (r.status < 500) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new DemoStop("The app stopped while starting; see its output above.");
    await new Promise((res) => setTimeout(res, 500));
  }
  printAccess(s);
  out("\nPress Ctrl-C to stop the app. `npm run demo:reset` puts the data back to the seeded state.");
  const stop = () => { child.kill("SIGTERM"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  await new Promise<void>((res) => child.on("exit", () => res()));
  rmSync(path.join(STATE_DIR, "server.pid"), { force: true });
}

/** The demo calendar's database half (scripts/demo/live-clock-db.ts) in `db`, as the cluster's superuser. */
async function installLiveClockOn(s: DemoState, db: string): Promise<number> {
  const { installDemoLiveClock } = await import("./live-clock-db");
  const c = new Client({ connectionString: withDb(s.pg.superUrl, db) });
  await c.connect();
  try { return (await installDemoLiveClock(c)).columns.length; } finally { await c.end(); }
}

/** Let `fn` connect to the reset template (which normally refuses connections), then close it again. */
async function withTemplateOpen<T>(s: DemoState, fn: () => Promise<T>): Promise<T> {
  const su = new Client({ connectionString: s.pg.superUrl });
  await su.connect();
  try {
    await su.query(`alter database "${TEMPLATE}" allow_connections true`);
    try { return await fn(); } finally {
      await su.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [TEMPLATE]);
      await su.query(`alter database "${TEMPLATE}" allow_connections false`);
    }
  } finally { await su.end(); }
}

async function migrationCount(url: string): Promise<number> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query("select to_regclass('drizzle.__drizzle_migrations') is not null as ok");
    if (!rows[0].ok) return 0;
    return Number((await c.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n);
  } finally { await c.end(); }
}

/** Run the migrations on the reset template when it is behind the demo database. Returns whether it was. */
async function migrateTemplate(s: DemoState): Promise<boolean> {
  if (!(await templateExists(s))) return false;
  const su = new Client({ connectionString: s.pg.superUrl });
  await su.connect();
  try {
    await su.query(`alter database "${TEMPLATE}" allow_connections true`);
    try {
      if ((await migrationCount(withDb(s.pg.superUrl, TEMPLATE))) >= (await migrationCount(withDb(s.pg.superUrl, DB)))) return false;
      execFileSync(path.join(ROOT, "node_modules/.bin/drizzle-kit"), ["migrate"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, DATABASE_OWNER_URL: loginUrl(s, "owner", TEMPLATE) } });
      return true;
    } finally {
      await su.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [TEMPLATE]);
      await su.query(`alter database "${TEMPLATE}" allow_connections false`);
    }
  } finally { await su.end(); }
}
async function templateExists(s: DemoState): Promise<boolean> {
  const c = new Client({ connectionString: s.pg.superUrl });
  await c.connect();
  try { return (await c.query("select 1 from pg_database where datname = $1", [TEMPLATE])).rows.length > 0; } finally { await c.end(); }
}

function printAccess(s: DemoState) {
  out(`\nClearline demo — Demo · fictional data\n  URL       ${ORIGIN}/control/sign-in`);
  out("  Logins    finance@northwind.demo   (Finance: uploads, reconciles, prepares write-offs)");
  out("            approver@northwind.demo  (Approver: approves what Finance prepared)");
  out("            viewer@northwind.demo    (Viewer: read only)");
  out("            admin@northwind.demo     (Admin: settings, members)");
  out("            ops@providerp.demo       (Provider ops at Provider P (demo))");
  out(`  Password  ${s.passwords.demo}   (shared by every demo login; fictional, local, in .demo/state.json)`);
}

main().catch((e: unknown) => {
  if (e instanceof DemoStop) { process.stderr.write(`\nnpm run demo stopped: ${e.message}\n`); process.exitCode = 2; return; }
  process.stderr.write(`\nnpm run demo failed: ${e instanceof Error ? (process.env.DEMO_DEBUG ? e.stack : e.message) : String(e)}\n`);
  process.exitCode = 1;
});

