/**
 * Shared helpers for `npm run demo` and `npm run demo:reset`: the local state file (.demo/state.json, mode 0600,
 * git-ignored), finding or starting PostgreSQL 16, and the three logins. Every value here is local and fictional;
 * passwords are never printed, except the shared demo password, which `npm run demo` prints on purpose.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { Client } from "pg";

export const ROOT = path.resolve(__dirname, "../..");
export const STATE_DIR = path.join(ROOT, ".demo");
export const STATE_FILE = path.join(STATE_DIR, "state.json");
export const DB = process.env.CLEARLINE_DEMO_DB_NAME ?? "clearline_demo";
export const TEMPLATE = `${DB}_template`;
export const PG_PORT = Number(process.env.CLEARLINE_DEMO_PG_PORT ?? 54330);
export const APP_PORT = Number(process.env.CLEARLINE_DEMO_PORT ?? 3100);
export const COMPOSE = path.join(ROOT, "docker-compose.demo.yml");

export interface DemoState {
  version: 1;
  pg: { kind: "url" | "local" | "docker"; superUrl: string; port: number; superPassword?: string };
  passwords: { owner: string; runtime: string; jobs: string; demo: string };
  authSecret: string;
  uploadKey: string;
  steps: Partial<Record<"database" | "migrations" | "seed" | "template" | "build", string>>;
  seed?: Record<string, unknown>;
  timingsMs?: Record<string, number>;
}

export const secret = (bytes = 24) => randomBytes(bytes).toString("base64url");
/** The shared demo password: 20 characters, letters and digits, made once per install. */
export const demoPassword = () => `demo-${randomBytes(12).toString("base64url").replace(/[-_]/g, "x").slice(0, 15)}`;

export function readState(): DemoState | null {
  if (!existsSync(STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")) as DemoState; } catch { throw new Error(`${path.relative(ROOT, STATE_FILE)} is not readable JSON; delete the .demo folder and run \`npm run demo -- --fresh\``); }
}
export function writeState(s: DemoState) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
}

export const withDb = (url: string, db: string) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
export const loginUrl = (s: DemoState, role: "owner" | "runtime" | "jobs", db = DB) => {
  const u = new URL(s.pg.superUrl); u.username = `clearline_${role}`; u.password = s.passwords[role]; u.pathname = `/${db}`; return u.toString();
};

export async function canConnect(url: string): Promise<{ ok: true; version: number } | { ok: false; error: string; code?: string }> {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 3_000 });
  try {
    await c.connect();
    const r = await c.query("show server_version_num");
    return { ok: true, version: Number(r.rows[0].server_version_num) };
  } catch (e) {
    const err = e as { message?: string; code?: string };
    return { ok: false, error: err.message ?? String(e), code: err.code };
  } finally { await c.end().catch(() => undefined); }
}

export const portAnswers = (port: number, host = "127.0.0.1") => new Promise<boolean>((resolve) => {
  const s = net.connect({ port, host });
  s.setTimeout(1_000);
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
  s.once("timeout", () => { s.destroy(); resolve(false); });
});

export class DemoStop extends Error {}

function dockerRunning(): boolean {
  const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  return r.status === 0 && !!r.stdout.trim();
}

/**
 * Where PostgreSQL comes from, in order: CLEARLINE_DEMO_PG_URL (a superuser URL of a local PostgreSQL 16); the
 * server saved in .demo/state.json; a server already answering on the demo port that accepts the saved Docker
 * password; otherwise `docker compose -f docker-compose.demo.yml up -d` (postgres:16 on 54330, named volume).
 */
export async function ensurePostgres(prev: DemoState | null, log: (s: string) => void): Promise<DemoState["pg"]> {
  const envUrl = process.env.CLEARLINE_DEMO_PG_URL;
  if (envUrl) {
    const r = await canConnect(withDb(envUrl, "postgres"));
    if (!r.ok) throw new DemoStop(`CLEARLINE_DEMO_PG_URL is set, but PostgreSQL there refused the connection (${r.code ?? "error"}). Check that the server runs and that the URL names a superuser.`);
    if (r.version < 160000 || r.version >= 170000) log(`note: that server is PostgreSQL ${Math.floor(r.version / 10000)}; the demo is tested on 16`);
    return { kind: "url", superUrl: withDb(envUrl, "postgres"), port: Number(new URL(envUrl).port || 5432) };
  }
  if (prev?.pg.kind === "url" || prev?.pg.kind === "local") {
    const r = await canConnect(prev.pg.superUrl);
    if (r.ok) return prev.pg;
    throw new DemoStop(`The PostgreSQL server saved in .demo/state.json does not answer (${r.code ?? "error"}). Start it again, set CLEARLINE_DEMO_PG_URL, or run \`npm run demo -- --fresh\` to start over.`);
  }
  const superPassword = prev?.pg.superPassword ?? secret(18);
  const superUrl = `postgres://postgres:${encodeURIComponent(superPassword)}@127.0.0.1:${PG_PORT}/postgres`;
  if (await portAnswers(PG_PORT)) {
    const r = await canConnect(superUrl);
    if (r.ok) return { kind: "docker", superUrl, port: PG_PORT, superPassword };
    throw new DemoStop(`Port ${PG_PORT} is in use by something the demo cannot sign in to (${r.code ?? r.error.slice(0, 80)}). Stop it, set CLEARLINE_DEMO_PG_PORT to a free port, or set CLEARLINE_DEMO_PG_URL to a PostgreSQL 16 superuser URL.`);
  }
  if (!dockerRunning()) throw new DemoStop("Docker is not running (or not installed), and no PostgreSQL was given. Start Docker Desktop and run `npm run demo` again, or set CLEARLINE_DEMO_PG_URL to a local PostgreSQL 16 superuser URL (for example postgres://postgres:<password>@127.0.0.1:5432/postgres).");
  log(`starting PostgreSQL 16 in Docker on 127.0.0.1:${PG_PORT} (docker-compose.demo.yml)`);
  execFileSync("docker", ["compose", "-f", COMPOSE, "up", "-d", "--wait"], { stdio: "inherit", env: { ...process.env, CLEARLINE_DEMO_PG_PASSWORD: superPassword, CLEARLINE_DEMO_PG_PORT: String(PG_PORT) } });
  for (let i = 0; i < 60; i++) {
    const r = await canConnect(superUrl);
    if (r.ok) return { kind: "docker", superUrl, port: PG_PORT, superPassword };
    await new Promise((res) => setTimeout(res, 1_000));
  }
  throw new DemoStop(`PostgreSQL in Docker did not become ready on port ${PG_PORT} within 60 s. See \`docker compose -f docker-compose.demo.yml logs\`.`);
}

/**
 * The owner, runtime and jobs logins (cluster-wide roles; the migrations name them) and the demo database, as
 * scripts/db/setup-local.sh makes them. Roles that already exist keep their passwords unless this install made them:
 * a shared server's other databases are never broken. `resetPasswords` (--reset-role-passwords) sets new ones.
 */
export async function ensureLogins(s: DemoState, opts: { resetPasswords?: boolean }): Promise<void> {
  const c = new Client({ connectionString: s.pg.superUrl });
  await c.connect();
  try {
    const { rows } = await c.query("select rolname from pg_roles where rolname = any($1)", [["clearline_owner", "clearline_runtime", "clearline_jobs", "clearline_app"]]);
    const have = new Set(rows.map((r) => r.rolname as string));
    const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
    const known = async (role: "owner" | "runtime" | "jobs") => (await canConnect(loginUrl(s, role, "postgres"))).ok;
    for (const role of ["owner", "runtime", "jobs"] as const) {
      if (have.has(`clearline_${role}`) && !opts.resetPasswords && !(await known(role))) {
        throw new DemoStop(`The login clearline_${role} already exists on this PostgreSQL server with a password this demo does not know (another Clearline database uses it). Changing it would break that database. Use a separate server (the Docker default, or another CLEARLINE_DEMO_PG_URL), or run with --reset-role-passwords if nothing else uses this server.`);
      }
    }
    if (!have.has("clearline_owner")) await c.query(`create role clearline_owner login bypassrls createrole password ${lit(s.passwords.owner)}`);
    if (!have.has("clearline_app")) await c.query("create role clearline_app nologin nobypassrls");
    if (!have.has("clearline_runtime")) await c.query(`create role clearline_runtime login nobypassrls password ${lit(s.passwords.runtime)} in role clearline_app`);
    if (!have.has("clearline_jobs")) await c.query(`create role clearline_jobs login nobypassrls nocreatedb nocreaterole password ${lit(s.passwords.jobs)}`);
    if (opts.resetPasswords) for (const role of ["owner", "runtime", "jobs"] as const) await c.query(`alter role clearline_${role} password ${lit(s.passwords[role])}`);
    const db = await c.query("select 1 from pg_database where datname = $1", [DB]);
    if (!db.rows.length) await c.query(`create database "${DB}" owner clearline_owner`);
  } finally { await c.end(); }
  const d = new Client({ connectionString: withDb(s.pg.superUrl, DB) });
  await d.connect();
  try { await d.query("revoke all on schema public from public; grant usage, create on schema public to clearline_owner; alter schema public owner to clearline_owner"); } finally { await d.end(); }
}

export async function dropDemoDatabases(s: DemoState): Promise<void> {
  const c = new Client({ connectionString: s.pg.superUrl });
  await c.connect();
  try {
    for (const db of [DB, TEMPLATE]) await c.query(`drop database if exists "${db}" with (force)`);
  } finally { await c.end(); }
}

export const fmtMs = (ms: number) => (ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`);
