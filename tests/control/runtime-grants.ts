/**
 * v1 phase 1.1: a canonical snapshot of everything the runtime login (`clearline_runtime`, through `clearline_app`)
 * may do in the database: its role attributes and memberships, its effective privileges on the database, the public
 * schema, every non-partition relation and column, every sequence and every function, and the row-level-security
 * policies that name it (or PUBLIC). Only privileges it HAS are listed, so a new object it cannot touch adds nothing.
 *
 * The committed fixture (tests/control/fixtures/runtime-grants.json) was first captured from migrations 0000–0041 at
 * the base commit 6352925, before the provisioning role existed (B1 changed nothing in it). It was regenerated on the
 * integrated wave 1 stack (migrations to 0069), adding only what B2 (0050/0051), A2 (0044) and B3 (0053/0054) grant
 * on purpose (listed in the wave 1 integration commit), and again on the integrated wave 2 stack (migrations to 0085:
 * 377 -> 808 entries, 431 added, 0 removed; the categories are listed in the wave 2 integration commit and in
 * docs/release/DECISIONS_LOG_V1.md), and for 0087 (upload_blobs: SELECT, INSERT, DELETE and its five policies; 8 added, 0
 * removed); tests/control/provisioning.test.ts compares it with the fully migrated database. Regenerate it ONLY when a reviewed migration intentionally changes the runtime grants:
 *   CLEARLINE_TEST_OWNER_URL=... npx tsx tests/control/runtime-grants.ts > tests/control/fixtures/runtime-grants.json
 */
import { Pool } from "pg";

type Query = (text: string) => Promise<{ rows: Record<string, unknown>[] }>;

const RUNTIME = "clearline_runtime";

export async function runtimeGrantSnapshot(q: Query, role = RUNTIME): Promise<string[]> {
  const lit = `'${role.replace(/'/g, "''")}'`;
  const out: string[] = [];
  const add = async (sqlText: string) => { for (const r of (await q(sqlText)).rows) out.push(String(r.g)); };
  await add(`select 'role ' || rolname || ' super=' || rolsuper || ' bypassrls=' || rolbypassrls || ' createrole=' || rolcreaterole
    || ' createdb=' || rolcreatedb || ' inherit=' || rolinherit || ' login=' || rolcanlogin as g from pg_roles where rolname = ${lit}`);
  await add(`select 'member-of ' || r.rolname as g from pg_roles r where r.rolname <> ${lit} and pg_has_role(${lit}, r.oid, 'MEMBER')`);
  await add(`select 'database ' || p as g from unnest(array['CONNECT','TEMPORARY','CREATE']) p where has_database_privilege(${lit}, current_database(), p)`);
  await add(`select 'schema public ' || p as g from unnest(array['USAGE','CREATE']) p where has_schema_privilege(${lit}, 'public', p)`);
  await add(`select 'table ' || c.relname || ' ' || p as g from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') and not c.relispartition and has_table_privilege(${lit}, c.oid, p)`);
  await add(`select 'column ' || c.relname || '.' || a.attname || ' ' || p as g from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') and not c.relispartition
      and has_column_privilege(${lit}, c.oid, a.attnum, p) and not has_table_privilege(${lit}, c.oid, p)`);
  await add(`select 'sequence ' || c.relname || ' ' || p as g from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['USAGE','SELECT','UPDATE']) p
    where n.nspname = 'public' and c.relkind = 'S' and has_sequence_privilege(${lit}, c.oid, p)`);
  await add(`select 'function ' || p.oid::regprocedure::text || case when p.prosecdef then ' definer' else '' end as g
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege(${lit}, p.oid, 'EXECUTE')`);
  await add(`select 'policy ' || tablename || ' ' || policyname || ' ' || permissive || ' ' || cmd || ' to=' || array_to_string(roles, ',')
      || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-') as g
    from pg_policies where schemaname = 'public' and (roles && array['public', 'clearline_app', ${lit}]::name[])
      and tablename not in (select c.relname from pg_class c where c.relispartition)`);
  return [...new Set(out)].sort();
}

/** Prints the snapshot of the database at CLEARLINE_TEST_OWNER_URL (the fixture's generator). */
async function main() {
  const pool = new Pool({ connectionString: process.env.CLEARLINE_TEST_OWNER_URL });
  try { console.log(JSON.stringify(await runtimeGrantSnapshot((t) => pool.query(t)), null, 1)); } finally { await pool.end(); }
}
if (process.argv[1]?.endsWith("runtime-grants.ts")) void main();
