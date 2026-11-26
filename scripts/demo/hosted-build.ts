/**
 * The build of the HOSTED demo (a Vercel preview of demo/integrated): fictional data only, "Demo · fictional data".
 * Run by vercel.json's buildCommand on this branch only. It
 *   (a) refuses to run unless CLEARLINE_HOSTED_DEMO=1 and the deployment is NOT production (VERCEL_ENV=preview);
 *   (b) on the demo database (CLEARLINE_DEMO_SUPER_URL, else the Neon integration owner login DATABASE_URL_UNPOOLED),
 *       makes the owner, runtime and jobs logins with the passwords from the environment, and drops and re-creates
 *       the demo database, so every deployment starts from the same seeded state;
 *   (c) migrations; the recorded chain file; the demo world seeded day by day; ANALYZE;
 *   (d) a DEMO build (CLEARLINE_DEMO_BUILD=1, CLEARLINE_CONTROL_PILOT=1) into .next, with the recording checked present.
 * No password or URL is printed. The presenter reset stays off on the hosted demo (it would need the owner login at
 * run time): redeploy to start again from the seed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { DB, RECORDING, ROOT, STATE_DIR, type DemoState, dropDemoDatabases, ensureLogins, fmtMs, loginUrl, withDb } from "./lib";

const env = process.env;
const out = (s: string) => process.stdout.write(`${s}\n`);
const need = (k: string, min = 1) => { const v = env[k]; if (!v || v.length < min) throw new Error(`hosted demo build: ${k} is not set (or too short)`); return v; };

async function main() {
  if (env.CLEARLINE_HOSTED_DEMO !== "1") throw new Error("hosted demo build: CLEARLINE_HOSTED_DEMO=1 is required");
  if (env.VERCEL_ENV === "production") throw new Error("hosted demo build: refuses to run for a production deployment");
  // the Neon owner login, from the Neon integration (DATABASE_URL_UNPOOLED, or NEON_… with a prefix) unless CLEARLINE_DEMO_SUPER_URL names another one
  if (!env.CLEARLINE_DEMO_SUPER_URL) env.CLEARLINE_DEMO_SUPER_URL = env.NEON_DATABASE_URL_UNPOOLED ?? env.DATABASE_URL_UNPOOLED;
  const superUrl = need("CLEARLINE_DEMO_SUPER_URL");
  const s = {
    version: 1,
    pg: { kind: "url", superUrl, port: Number(new URL(superUrl).port || 5432) },
    passwords: { owner: need("CLEARLINE_DEMO_OWNER_PASSWORD", 24), runtime: need("CLEARLINE_DEMO_RUNTIME_PASSWORD", 24), jobs: need("CLEARLINE_DEMO_JOBS_PASSWORD", 24), demo: need("CLEARLINE_DEMO_PASSWORD", 12) },
    authSecret: need("BETTER_AUTH_SECRET", 32), uploadKey: need("CLEARLINE_UPLOAD_KEY", 32), steps: {},
  } as unknown as DemoState;
  const t0 = Date.now();

  out("▸ Demo database (dropped and made again) and logins");
  await dropDemoDatabases(s);
  // PostgreSQL 16+ on Neon: the owner login that made clearline_owner may not SET ROLE to it, so `create database …
  // owner clearline_owner` is refused. It administers the roles it made, so it grants itself membership and retries.
  try { await ensureLogins(s, { resetPasswords: true }); }
  catch (e) {
    if (!/must be able to SET ROLE/.test(e instanceof Error ? e.message : "")) throw e;
    const g = new Client({ connectionString: superUrl });
    await g.connect();
    try {
      const { rows } = await g.query("select rolname from pg_roles where rolname = any($1)", [["clearline_owner", "clearline_app", "clearline_runtime", "clearline_jobs"]]);
      for (const r of rows) await g.query(`grant "${r.rolname as string}" to current_user with inherit true, set true`);
    } finally { await g.end(); }
    await ensureLogins(s, { resetPasswords: true });
  }

  out("▸ Migrations");
  execFileSync(path.join(ROOT, "node_modules/.bin/drizzle-kit"), ["migrate"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...env, DATABASE_OWNER_URL: loginUrl(s, "owner") } });

  out("▸ Recorded chain file");
  const { demoWorld } = await import("../../src/lib/clearline/demo/world");
  const { allDemoTransfers } = await import("../../src/lib/clearline/demo/next-day");
  const { recordingOf } = await import("../../src/lib/clearline/merchant/chain");
  const recording = recordingOf(allDemoTransfers(demoWorld()));
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(RECORDING, JSON.stringify(recording));
  out(`  ${recording.transfers.length} transfers in .demo/chain-recording.json`);

  out("▸ Seeding the demo world (30 days, a reconciliation after each day)");
  process.env.DATABASE_URL = loginUrl(s, "runtime");
  // the guard in next.config.mjs and the app read the runtime login, never the Neon owner DATABASE_URL
  const { hostedDemoRuntimeUrl } = await import("../../src/server/db/hosted-demo-url");
  if (env.PGHOST_UNPOOLED) process.env.DATABASE_URL = hostedDemoRuntimeUrl({ ...env, CLEARLINE_DEMO_RUNTIME_PASSWORD: s.passwords.runtime }) ?? process.env.DATABASE_URL;
  const { installDemoClock } = await import("./clock");
  const { seedDemo, restampDemoSeed } = await import("../../src/server/demo-seed");
  const { closeDatabase } = await import("../../src/server/db/client");
  const schema = await import("../../src/server/db/schema");
  const pool = new Pool({ connectionString: loginUrl(s, "owner"), max: 4 });
  const clock = installDemoClock();
  try {
    const owner = drizzle(pool, { schema }) as never;
    const { stampWindows } = await seedDemo(owner, { password: s.passwords.demo, recording, setClock: clock.set, log: (l) => out(`  ${l}`) });
    const re = await restampDemoSeed(superUrl, DB, stampWindows);
    out(`  ${re.rows} database-stamped times moved to the demo calendar`);
  } finally { clock.restore(); await pool.end(); await closeDatabase(); }

  const a = new Client({ connectionString: withDb(superUrl, DB) });
  await a.connect();
  try { await a.query("analyze"); } finally { await a.end(); }
  out(`  seeded in ${fmtMs(Date.now() - t0)}`);

  out("▸ Demo build (CLEARLINE_DEMO_BUILD=1)");
  const buildEnv = { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CLEARLINE_DEMO_BUILD: "1", CLEARLINE_CONTROL_PILOT: "1", CLEARLINE_DIST_DIR: "", CLEARLINE_TEST_BUILD: "", CLEARLINE_CHAIN_LIVE: "", CLEARLINE_LEDGER_PULL: "" } as NodeJS.ProcessEnv;
  execFileSync(path.join(ROOT, "node_modules/.bin/next"), ["build"], { cwd: ROOT, env: buildEnv, stdio: "inherit" });
  execFileSync(process.execPath, [path.join(ROOT, "scripts/build/check-chain-recording.mjs"), "--marker", "demo", "--expect", "present"], { cwd: ROOT, env: { ...env, NEXT_DIST_DIR: ".next" }, stdio: "inherit" });
  out(`▸ Hosted demo build done in ${fmtMs(Date.now() - t0)}`);
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
