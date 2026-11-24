/**
 * `npm run demo` only: the database half of the demo calendar for live actions (src/server/demo-live-clock.ts).
 *
 * Installs, in the DEMO database (and its reset template) only, the function clearline_demo_now() and makes it the
 * default of every timestamp column whose default is now(). The function is now() unless BOTH hold for the current
 * transaction: the demo build's app set `clearline.demo_shift_ms` (transaction-local; src/server/tenant.ts does so
 * only for a demo organisation in a demo build), and the transaction's organisation (app.org_id) is a demo
 * organisation (app_org_is_demo, migration 0032). Then it is now() plus that shift, never earlier than DEMO_NOW,
 * exactly the app's formula (demoLiveTime).
 *
 * Never a migration: real databases never have this function and their defaults stay now(). It refuses a database
 * that holds any non-demo organisation (as restampDemoSeed does); `allowNonDemoOrgs` exists for the integration test
 * only, which shows a live organisation in the same database is unaffected. Idempotent. Demo · fictional data.
 */
import type { Client } from "pg";
import { DEMO_NOW } from "../../src/lib/clearline/demo/clock";

/** Same bound as src/server/demo-live-clock.ts MAX_SHIFT_MS (ten years), written out: that module is server-only. */
const MAX_SHIFT_MS = 3660 * 86_400_000;

export const DEMO_NOW_FUNCTION = "clearline_demo_now";

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION public.${DEMO_NOW_FUNCTION}() RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $fn$
DECLARE d text := current_setting('clearline.demo_shift_ms', true);
BEGIN
  IF d IS NULL OR d !~ '^-?[0-9]{1,12}$' OR abs(d::bigint) > ${MAX_SHIFT_MS} OR NOT public.app_org_is_demo(public.app_org_id()) THEN
    RETURN now();
  END IF;
  RETURN greatest(now() + d::bigint * interval '1 millisecond', '${DEMO_NOW}'::timestamptz);
END
$fn$`;

/** Defaults this installer replaces (now()) or has replaced before (re-runs). */
const DEFAULTS = ["now()", `${DEMO_NOW_FUNCTION}()`, `public.${DEMO_NOW_FUNCTION}()`];

export async function installDemoLiveClock(c: Client, opts: { allowNonDemoOrgs?: boolean } = {}): Promise<{ columns: string[] }> {
  if (!opts.allowNonDemoOrgs) {
    const { rows } = await c.query("select count(*)::int as n from organizations where data_mode <> 'demo'");
    if (rows[0].n !== 0) throw new Error("installDemoLiveClock: this database holds a non-demo organisation; refusing (demo databases only)");
  }
  const { rows: cols } = await c.query(`select table_name as t, column_name as c from information_schema.columns
    where table_schema = 'public' and data_type like 'timestamp%' and column_default = any($1::text[]) order by 1, 2`, [DEFAULTS]);
  await c.query("begin");
  try {
    await c.query(FUNCTION_SQL);
    await c.query(`ALTER FUNCTION public.${DEMO_NOW_FUNCTION}() OWNER TO clearline_owner`);
    await c.query(`GRANT EXECUTE ON FUNCTION public.${DEMO_NOW_FUNCTION}() TO PUBLIC`);
    for (const { t, c: col } of cols as { t: string; c: string }[]) await c.query(`ALTER TABLE public."${t}" ALTER COLUMN "${col}" SET DEFAULT public.${DEMO_NOW_FUNCTION}()`);
    await c.query("commit");
  } catch (e) { await c.query("rollback").catch(() => undefined); throw e; }
  return { columns: (cols as { t: string; c: string }[]).map((x) => `${x.t}.${x.c}`) };
}

/** Undo installDemoLiveClock: the defaults go back to now() and the function is dropped (tests; a demo `--fresh`). */
export async function uninstallDemoLiveClock(c: Client): Promise<{ columns: string[] }> {
  const { rows: cols } = await c.query(`select table_name as t, column_name as c from information_schema.columns
    where table_schema = 'public' and column_default = any($1::text[]) order by 1, 2`, [DEFAULTS.slice(1)]);
  await c.query("begin");
  try {
    for (const { t, c: col } of cols as { t: string; c: string }[]) await c.query(`ALTER TABLE public."${t}" ALTER COLUMN "${col}" SET DEFAULT now()`);
    await c.query(`DROP FUNCTION IF EXISTS public.${DEMO_NOW_FUNCTION}()`);
    await c.query("commit");
  } catch (e) { await c.query("rollback").catch(() => undefined); throw e; }
  return { columns: (cols as { t: string; c: string }[]).map((x) => `${x.t}.${x.c}`) };
}
