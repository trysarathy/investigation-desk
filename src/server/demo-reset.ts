import "server-only";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Demo reset: put the demo database back to the seeded state by recreating it from its template (made by
 * `npm run demo` right after seeding). Used by `npm run demo:reset` and, in a demo build only, by
 * POST /api/control/demo/reset. clearline-demo[demo-build-only]
 *
 * It connects with the demo cluster's superuser URL (CLEARLINE_DEMO_RESET_URL, local and fictional; never printed),
 * ends every session on the demo database, drops it and creates it again from the template, owned by the schema
 * owner. Database names are checked so this can only ever touch `<name>` and `<name>_template`.
 */

const NAME = /^[a-z][a-z0-9_]{2,40}$/;
/** Exists only in demo builds' server bundles (scripts/build/check-chain-recording.mjs --marker demo). */
export const DEMO_RESET_MARKER = "clearline-demo[demo-build-only]";
export class DemoResetRefused extends Error {
  readonly code = "DEMO_RESET_REFUSED";
  readonly marker = DEMO_RESET_MARKER;
}

export interface DemoResetConfig {
  adminUrl: string; database: string; template?: string; uploadDir?: string;
  /** Where presenter feedback notes are saved before the reset drops them (.demo/feedback; `npm run demo:feedback` reads it). */
  feedbackDir?: string;
}

export function demoResetConfigFromEnv(env: Record<string, string | undefined> = process.env): DemoResetConfig {
  const adminUrl = env.CLEARLINE_DEMO_RESET_URL;
  const database = env.CLEARLINE_DEMO_DB ?? "";
  if (!adminUrl || !NAME.test(database)) throw new DemoResetRefused("The demo reset is not configured (CLEARLINE_DEMO_RESET_URL and CLEARLINE_DEMO_DB are set by `npm run demo`).");
  return { adminUrl, database, template: env.CLEARLINE_DEMO_TEMPLATE, uploadDir: env.CLEARLINE_UPLOAD_DIR, feedbackDir: env.CLEARLINE_DEMO_FEEDBACK_DIR };
}

const ident = (s: string) => `"${s}"`;
const inDemoDir = (dir: string, name: string) => path.basename(path.resolve(dir)) === name && path.basename(path.dirname(path.resolve(dir))) === ".demo";
const withDb = (url: string, db: string) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

/**
 * Presenter feedback notes (demo_feedback) are not in the template, so a reset drops them like everything else done
 * since the seed. Before that, they are saved to <feedbackDir>/<time>.json, which `npm run demo:feedback` exports
 * with the notes still in the database. Returns how many notes were saved.
 */
async function saveFeedback(cfg: DemoResetConfig): Promise<number> {
  if (!cfg.feedbackDir || !inDemoDir(cfg.feedbackDir, "feedback")) return 0;
  const c = new Client({ connectionString: withDb(cfg.adminUrl, cfg.database) });
  try { await c.connect(); } catch { return 0; } // no demo database (a failed earlier reset): nothing to save
  try {
    const { rows: has } = await c.query("select to_regclass('public.demo_feedback') is not null as ok");
    if (!has[0].ok) return 0;
    const { rows } = await c.query(`select f.id, f.created_at, f.role, f.screen, f.route, f.note, u.email, u.name, o.name as org
      from demo_feedback f join users u on u.id = f.user_id join organizations o on o.id = f.org_id order by f.created_at, f.id`);
    if (!rows.length) return 0;
    mkdirSync(cfg.feedbackDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(cfg.feedbackDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), `${JSON.stringify({ savedBeforeReset: true, notes: rows }, null, 2)}\n`, { mode: 0o600 });
    return rows.length;
  } finally { await c.end(); }
}

/** Recreate the demo database from its template. Returns the time it took. */
export async function resetDemoDatabase(cfg: DemoResetConfig): Promise<{ ms: number; feedbackSaved: number }> {
  const t0 = performance.now();
  const template = cfg.template ?? `${cfg.database}_template`;
  if (!NAME.test(cfg.database) || template !== `${cfg.database}_template`) throw new DemoResetRefused("The demo database and its template must be <name> and <name>_template.");
  const feedbackSaved = await saveFeedback(cfg);
  const c = new Client({ connectionString: cfg.adminUrl });
  await c.connect();
  try {
    const { rows } = await c.query("select datname from pg_database where datname = $1", [template]);
    if (!rows.length) throw new DemoResetRefused(`The demo template database does not exist yet; run \`npm run demo\` first.`);
    await c.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = any($1) and pid <> pg_backend_pid()", [[cfg.database, template]]);
    await c.query(`drop database if exists ${ident(cfg.database)} with (force)`);
    await c.query(`create database ${ident(cfg.database)} template ${ident(template)} owner clearline_owner`);
  } finally {
    await c.end();
  }
  // files uploaded during the demo belong to rows that no longer exist
  if (cfg.uploadDir && inDemoDir(cfg.uploadDir, "uploads")) {
    rmSync(cfg.uploadDir, { recursive: true, force: true });
    mkdirSync(cfg.uploadDir, { recursive: true, mode: 0o700 });
  }
  return { ms: Math.round(performance.now() - t0), feedbackSaved };
}

/** Make (or remake) the template from the freshly seeded database. */
export async function snapshotDemoTemplate(cfg: DemoResetConfig): Promise<{ ms: number }> {
  const t0 = performance.now();
  const template = `${cfg.database}_template`;
  if (!NAME.test(cfg.database)) throw new DemoResetRefused("bad demo database name");
  const c = new Client({ connectionString: cfg.adminUrl });
  await c.connect();
  try {
    await c.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = any($1) and pid <> pg_backend_pid()", [[cfg.database, template]]);
    await c.query(`drop database if exists ${ident(template)} with (force)`);
    await c.query(`create database ${ident(template)} template ${ident(cfg.database)} owner clearline_owner`);
    // nobody works in the template: it is only copied
    await c.query(`alter database ${ident(template)} allow_connections false`);
  } finally {
    await c.end();
  }
  return { ms: Math.round(performance.now() - t0) };
}
