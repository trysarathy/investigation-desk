/**
 * v1 phase 5.7: helpers for scripts/ops/restore-drill.sh (fictional data only; never point it at a real database).
 *   seed          DATABASE_OWNER_URL + DATABASE_URL (runtime): migrate, then the fictional provider and merchants
 *                 (seedMerchantCases) and one reconciliation run per entity, so every main table has rows.
 *   fingerprint   DATABASE_OWNER_URL: JSON {tables: {name: {rows, md5}}, migrations, rls, functions} for every table in
 *                 the public schema (partitioned tables read through their parent) and the migration journal. md5 is
 *                 over the sorted md5 of each row's text form, so it is independent of physical order.
 *   compare <a.json> <b.json>   exit 0 when equal, 1 with the differing table names (never row content).
 * Prints counts and checksums only.
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";

type Fingerprint = { tables: Record<string, { rows: number; md5: string }>; migrations: number; rls: string[]; functions: number };

async function seed() {
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  if (!ownerUrl || !process.env.DATABASE_URL) throw new Error("set DATABASE_OWNER_URL and DATABASE_URL (runtime)");
  const pool = new Pool({ connectionString: ownerUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const db = drizzle(pool, { schema }) as Db;
    const { seedMerchantCases } = await import("../../src/server/merchant-seed");
    const { resolveTenant } = await import("../../src/server/tenant");
    const { runReconciliation } = await import("../../src/server/merchant");
    const s = await seedMerchantCases(db, { password: "fictional-drill-pass-01" });
    const entities = (await pool.query("select org_id, id from merchant_entities order by org_id, id")).rows as { org_id: string; id: string }[];
    const slugs = Object.fromEntries((await pool.query("select id, slug from organizations")).rows.map((r) => [r.id, r.slug]));
    let runs = 0;
    for (const e of entities) {
      const email = e.org_id === s.orgs.sg ? "ops@straits-demo.example" : "ops@dunehaven-demo.example";
      const userId = s.users[email];
      if (!userId) continue;
      const ctx = await resolveTenant({ userId, name: email, email }, slugs[e.org_id]);
      await runReconciliation(ctx, e.id, `drill-${e.id}`, {});
      runs++;
    }
    console.log(JSON.stringify({ event: "drill_seeded", entities: entities.length, runs }));
  } finally {
    await pool.end();
    const { closeDatabase } = await import("../../src/server/db/client");
    await closeDatabase();
  }
}

async function fingerprint(): Promise<Fingerprint> {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  try {
    const tables = (await pool.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition order by c.relname`)).rows.map((r) => String(r.relname));
    const out: Fingerprint = { tables: {}, migrations: 0, rls: [], functions: 0 };
    for (const tb of tables) {
      const r = (await pool.query(`select count(*)::int as n, md5(coalesce(string_agg(h, '' order by h), '')) as m from (select md5(t::text) as h from public."${tb.replace(/"/g, '""')}" t) x`)).rows[0];
      out.tables[tb] = { rows: r.n, md5: r.m };
    }
    out.migrations = (await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n;
    out.rls = (await pool.query(`select c.relname || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity as r from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') order by 1`)).rows.map((r) => String(r.r));
    out.functions = (await pool.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).rows[0].n;
    return out;
  } finally { await pool.end(); }
}

function compare(a: Fingerprint, b: Fingerprint): string[] {
  const diff: string[] = [];
  for (const tb of new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])) {
    const x = a.tables[tb], y = b.tables[tb];
    if (!x || !y || x.rows !== y.rows || x.md5 !== y.md5) diff.push(tb);
  }
  if (a.migrations !== b.migrations) diff.push("drizzle.__drizzle_migrations");
  if (JSON.stringify(a.rls) !== JSON.stringify(b.rls)) diff.push("row-level security flags");
  if (a.functions !== b.functions) diff.push("functions");
  return diff;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "seed") return seed();
  if (cmd === "fingerprint") { console.log(JSON.stringify(await fingerprint())); return; }
  if (cmd === "compare") {
    const [a, b] = args.map((f) => JSON.parse(readFileSync(f, "utf8")) as Fingerprint);
    const d = compare(a, b);
    const rows = Object.values(a.tables).reduce((s, t) => s + t.rows, 0);
    console.log(JSON.stringify({ event: "drill_compare", tables: Object.keys(a.tables).length, rows, migrations: a.migrations, differences: d }));
    if (d.length) process.exitCode = 1;
    return;
  }
  throw new Error("usage: drill.ts seed | fingerprint | compare <a.json> <b.json>");
}
main().catch((e) => { console.error(JSON.stringify({ event: "drill_failed", error: e instanceof Error ? e.name : typeof e, code: (e as { code?: string }).code ?? null })); process.exitCode = 1; });
