/**
 * The build of a hosted Clearline pilot on Vercel with the Neon integration (the clearline-app project's build command).
 *   (a) refuses unless CLEARLINE_DB_FROM_NEON=1 and CLEARLINE_DEPLOY_ENV is set (never a demo or test build);
 *   (b) with the Neon owner login (DATABASE_URL_UNPOOLED, build time only): makes the Clearline logins (owner, app,
 *       runtime, jobs, provisioning) with the passwords from the environment, and the database CLEARLINE_DB_NAME
 *       ("clearline") if it is missing. It NEVER drops or empties a database;
 *   (c) migrations, as clearline_owner;
 *   (d) first run only: the organisation (CLEARLINE_BOOTSTRAP_ORG_SLUG / _NAME / _TIMEZONE), one entity and its first
 *       Admin (CLEARLINE_BOOTSTRAP_ADMIN_EMAIL, password CLEARLINE_BOOTSTRAP_PASSWORD) through the admin CLI. No demo
 *       or sample data;
 *   (e) `next build` with the Control pilot on.
 * No password or URL is printed.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

const ROOT = path.resolve(__dirname, "../..");
const env = process.env;
const out = (s: string) => process.stdout.write(`${s}\n`);
const need = (k: string, min = 1) => { const v = env[k]; if (!v || v.length < min) throw new Error(`hosted build: ${k} is not set (or too short)`); return v; };
const ROLES = ["owner", "runtime", "jobs", "provisioning"] as const;
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const withDb = (url: string, db: string) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

async function main() {
  if (env.CLEARLINE_DB_FROM_NEON !== "1") throw new Error("hosted build: CLEARLINE_DB_FROM_NEON=1 is required");
  const deployEnv = need("CLEARLINE_DEPLOY_ENV");
  if (env.CLEARLINE_DEMO_BUILD === "1" || env.CLEARLINE_TEST_BUILD === "1") throw new Error("hosted build: never a demo or test build");
  const superUrl = need("DATABASE_URL_UNPOOLED");
  const host = need("PGHOST_UNPOOLED");
  const db = env.CLEARLINE_DB_NAME ?? "clearline";
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(db)) throw new Error("hosted build: bad CLEARLINE_DB_NAME");
  const pw = Object.fromEntries(ROLES.map((r) => [r, need(`CLEARLINE_${r.toUpperCase()}_PASSWORD`, 24)])) as Record<(typeof ROLES)[number], string>;
  const loginUrl = (role: (typeof ROLES)[number]) => `postgres://clearline_${role}:${encodeURIComponent(pw[role])}@${host}${env.CLEARLINE_DB_PORT ? `:${Number(env.CLEARLINE_DB_PORT)}` : ""}/${db}?sslmode=${env.CLEARLINE_DB_SSLMODE === "disable" ? "disable" : "verify-full"}`;
  const t0 = Date.now();

  out(`▸ Logins and database (${deployEnv})`);
  const c = new Client({ connectionString: superUrl });
  await c.connect();
  try {
    const have = new Set((await c.query("select rolname from pg_roles where rolname like 'clearline_%'")).rows.map((r) => r.rolname as string));
    if (!have.has("clearline_owner")) await c.query(`create role clearline_owner login bypassrls createrole password ${lit(pw.owner)}`);
    if (!have.has("clearline_app")) await c.query("create role clearline_app nologin nobypassrls");
    if (!have.has("clearline_runtime")) await c.query(`create role clearline_runtime login nobypassrls password ${lit(pw.runtime)} in role clearline_app`);
    if (!have.has("clearline_jobs")) await c.query(`create role clearline_jobs login nobypassrls nocreatedb nocreaterole password ${lit(pw.jobs)}`);
    if (!have.has("clearline_provisioning")) await c.query(`create role clearline_provisioning login nobypassrls nocreatedb nocreaterole noinherit password ${lit(pw.provisioning)}`);
    for (const r of ROLES) await c.query(`alter role clearline_${r} password ${lit(pw[r])}`);
    // PostgreSQL 16+ (Neon): the login that made a role may only create a database owned by it after joining it
    for (const r of ["owner", "app", "runtime", "jobs", "provisioning"]) await c.query(`grant clearline_${r} to current_user with inherit true, set true`);
    if (!(await c.query("select 1 from pg_database where datname = $1", [db])).rows.length) await c.query(`create database "${db}" owner clearline_owner`);
  } finally { await c.end(); }
  const d = new Client({ connectionString: withDb(superUrl, db) });
  await d.connect();
  try { await d.query("revoke all on schema public from public; grant usage, create on schema public to clearline_owner; alter schema public owner to clearline_owner"); } finally { await d.end(); }

  out("▸ Migrations");
  execFileSync(path.join(ROOT, "node_modules/.bin/drizzle-kit"), ["migrate"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...env, DATABASE_OWNER_URL: loginUrl("owner") } });

  const runtimeUrl = loginUrl("runtime");
  const slug = env.CLEARLINE_BOOTSTRAP_ORG_SLUG;
  if (slug) {
    out("▸ Organisation and first Admin (kept if they exist)");
    const cli = (args: string[], extra: Record<string, string> = {}) =>
      execFileSync(path.join(ROOT, "node_modules/.bin/tsx"), ["--conditions=react-server", "scripts/control/admin.ts", ...args],
        { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...env, DATABASE_URL: runtimeUrl, DATABASE_OWNER_URL: loginUrl("owner"), ...extra } });
    const tz = env.CLEARLINE_BOOTSTRAP_TIMEZONE ?? "Asia/Singapore";
    cli(["create-merchant", slug, "--name", need("CLEARLINE_BOOTSTRAP_ORG_NAME"), "--timezone", tz]);
    cli(["add-entity", slug, env.CLEARLINE_BOOTSTRAP_ENTITY_ID ?? "main", "--name", need("CLEARLINE_BOOTSTRAP_ORG_NAME"), "--currency", env.CLEARLINE_BOOTSTRAP_CURRENCY ?? "SGD", "--timezone", tz]);
    cli(["add-member", slug, need("CLEARLINE_BOOTSTRAP_ADMIN_EMAIL"), "admin", "--name", env.CLEARLINE_BOOTSTRAP_ADMIN_NAME ?? "Admin"], { CLEARLINE_SEED_PASSWORD: need("CLEARLINE_BOOTSTRAP_PASSWORD", 12) });
  }
  out(`  database ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  out("▸ Build (Control pilot)");
  execFileSync(path.join(ROOT, "node_modules/.bin/next"), ["build"], { cwd: ROOT, stdio: "inherit",
    env: { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CLEARLINE_CONTROL_PILOT: "1", DATABASE_URL: runtimeUrl, CLEARLINE_DEMO_BUILD: "", CLEARLINE_TEST_BUILD: "" } as NodeJS.ProcessEnv });
  out(`▸ Hosted build done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
