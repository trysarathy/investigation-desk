/**
 * v1 phase 0: chain_reads partitioned by month (drizzle/0036), against PostgreSQL 16. Structure, the append-only
 * guard on every partition, a month without a partition refused loudly. Fictional data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeJobs, closeOwner, jobsDb, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { withTenant } from "../../src/server/tenant";
import { createUser, grantMembership } from "../../src/server/admin";

const org: Record<string, string> = {};
const ids: Record<string, string> = {};
const q = (s: string) => ownerDb().execute(sql.raw(s));
const rows = async (s: string) => (await q(s)).rows as Record<string, unknown>[];
const asUser = (userId: string, orgId: string, s: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(s));
/** Drizzle wraps the PostgreSQL error ("Failed query: ..."); the database's own message is on the cause. */
async function refused(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => undefined, (x: unknown) => x as { message?: string; cause?: { message?: string } });
  expect(e, "expected a refusal").toBeDefined();
  expect(`${e!.message ?? ""} | ${e!.cause?.message ?? ""}`).toMatch(re);
}
const readRow = (orgId: string, at: string, status = "ok") =>
  sql`insert into chain_reads (org_id, entity_id, network, tx_hash, status, source, at) values (${orgId}, 'ENT-1', 'tron', md5(random()::text), ${status}, 'recording', ${at}::timestamptz)`;

beforeAll(async () => {
  await resetAndSeed();
  await q(`TRUNCATE provider_grants, merchant_entities CASCADE`);
  for (const [slug, kind] of [["cr-provider-a", "provider"], ["cr-provider-b", "provider"], ["cr-merchant-a", "merchant"], ["cr-merchant-b", "merchant"]] as const) {
    org[slug] = String((await rows(`insert into organizations (slug, name, timezone, kind) values ('${slug}', '${slug} (fictional)', 'UTC', '${kind}') returning id`))[0].id);
  }
  await q(`update organizations set provider_org_id = '${org["cr-provider-a"]}' where id in ('${org["cr-merchant-a"]}', '${org["cr-merchant-b"]}')`);
  for (const [email, slug, role] of [["fin@cr-a.example", "cr-merchant-a", "finance"], ["fin@cr-b.example", "cr-merchant-b", "finance"],
    ["admin@cr-provider-a.example", "cr-provider-a", "provider_admin"], ["admin@cr-provider-b.example", "cr-provider-b", "provider_admin"]] as const) {
    ids[email] = await createUser(ownerDb(), { email, name: `${email} (fictional)`, password: PASSWORD });
    await grantMembership(ownerDb(), { orgSlug: slug, email, role: role as never });
  }
  for (const m of ["cr-merchant-a", "cr-merchant-b"]) {
    await q(`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values ('${org[m]}', 'ENT-1', 'Entity (fictional)', 'USD', 'none', 'UTC')`);
  }
  // reads in three months for A, one for B (as each merchant's own member, through RLS)
  for (const at of ["2026-09-15T02:00:00Z", "2026-10-15T02:00:00Z", "2026-11-15T02:00:00Z"]) await asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], readRow(org["cr-merchant-a"], at));
  await asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], readRow(org["cr-merchant-a"], "2026-11-16T02:00:00Z", "unavailable"));
  await asUser(ids["fin@cr-b.example"], org["cr-merchant-b"], readRow(org["cr-merchant-b"], "2026-11-15T02:00:00Z"));
});

afterAll(async () => { await closeDatabase(); await closeOwner(); await closeJobs(); });

describe("chain_reads partitioned by month", () => {
  it("is range-partitioned on the read time, one partition per month, rows stored in their month", async () => {
    expect((await rows(`select relkind from pg_class where relname = 'chain_reads'`))[0].relkind).toBe("p");
    expect(String((await rows(`select pg_get_partkeydef('chain_reads'::regclass) as k`))[0].k)).toBe("RANGE (at)");
    const parts = await rows(`select c.relname, pg_get_expr(c.relpartbound, c.oid) as bound from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'chain_reads'::regclass order by c.relname`);
    expect(parts.length).toBeGreaterThanOrEqual(24); // January 2025 to 12 months ahead of the migration
    expect(parts.find((p) => p.relname === "chain_reads_p202611")!.bound).toMatch(/FROM \('2026-11-01 00:00:00\+00'\) TO \('2026-12-01 00:00:00\+00'\)/);
    expect(parts.some((p) => String(p.bound).includes("DEFAULT"))).toBe(false); // no catch-all partition
    const placed = await rows(`select tableoid::regclass::text as part, count(*)::int as n from chain_reads group by 1 order by 1`);
    expect(placed).toEqual([{ part: "chain_reads_p202609", n: 1 }, { part: "chain_reads_p202610", n: 1 }, { part: "chain_reads_p202611", n: 3 }]);
  });

  it("every partition: RLS enabled and forced, the append-only trigger, the indexes and foreign keys; no grant to the app", async () => {
    const bad = await rows(`select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'chain_reads'::regclass
      and not (c.relrowsecurity and c.relforcerowsecurity
        and exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'chain_reads_append_only')
        and (select count(*) from pg_index x where x.indrelid = c.oid) = 3
        and (select count(*) from pg_constraint k where k.conrelid = c.oid and k.contype = 'f') = 2
        and not has_table_privilege('clearline_runtime', c.oid, 'SELECT') and not has_table_privilege('clearline_runtime', c.oid, 'INSERT'))`);
    expect(bad).toEqual([]);
    const parent = (await rows(`select relrowsecurity, relforcerowsecurity, has_table_privilege('clearline_runtime', 'chain_reads', 'SELECT') as s,
      has_table_privilege('clearline_runtime', 'chain_reads', 'INSERT') as i, has_table_privilege('clearline_runtime', 'chain_reads', 'UPDATE') as u,
      has_table_privilege('clearline_runtime', 'chain_reads', 'DELETE') as d from pg_class where relname = 'chain_reads'`))[0];
    expect(parent).toEqual({ relrowsecurity: true, relforcerowsecurity: true, s: true, i: true, u: false, d: false });
    // the old table (expand/contract) is unreachable by the app login
    expect((await rows(`select has_table_privilege('clearline_runtime', 'chain_reads_unpartitioned', 'SELECT') as s`))[0].s).toBe(false);
  });

  it("SECURITY: a partition cannot be read or written directly by the app login; rows stay append-only, even for the owner", async () => {
    await refused(asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], sql`select count(*) from chain_reads_p202611`), /permission denied/);
    await refused(asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], sql`insert into chain_reads_p202611 (org_id, entity_id, network, tx_hash, status, source, at)
      values (${org["cr-merchant-a"]}, 'ENT-1', 'tron', 'aa', 'ok', 'recording', '2026-11-20T00:00:00Z')`), /permission denied/);
    await refused(asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], sql`update chain_reads set status = 'ok'`), /permission denied/);
    await refused(asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], sql`delete from chain_reads`), /permission denied/);
    await refused(q(`update chain_reads set status = 'ok' where status = 'unavailable'`), /is append-only: (UPDATE|DELETE) refused/);
    await refused(q(`delete from chain_reads_p202609`), /is append-only: (UPDATE|DELETE) refused/);
    expect(Number((await rows(`select count(*)::int as n from chain_reads`))[0].n)).toBe(5);
  });

  it("a read in a month without a partition is refused loudly and writes nothing; the owner's function adds the month", async () => {
    await refused(asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], readRow(org["cr-merchant-a"], "2099-03-01T00:00:00Z")),
      /no partition of relation "chain_reads" found for row/);
    await refused(q(`insert into chain_reads (org_id, entity_id, network, tx_hash, status, source, at) values ('${org["cr-merchant-a"]}', 'ENT-1', 'tron', 'bb', 'ok', 'recording', '2024-06-01T00:00:00Z')`),
      /no partition of relation "chain_reads" found for row/);
    expect(Number((await rows(`select count(*)::int as n from chain_reads`))[0].n)).toBe(5);
    // only the owner can create partitions
    await refused(asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], sql`select chain_reads_ensure_partitions('2099-03-01', '2099-03-01')`), /permission denied/);
    await refused(jobsDb().execute(sql`select chain_reads_ensure_partitions('2099-03-01', '2099-03-01')`), /permission denied/);
    expect((await rows(`select chain_reads_ensure_partitions('2099-02-10', '2099-04-30') as n`))[0].n).toBe(3);
    expect((await rows(`select chain_reads_ensure_partitions('2099-03-01', '2099-03-01') as n`))[0].n).toBe(0); // idempotent
    await refused(q(`select chain_reads_ensure_partitions('2099-03-01', '2099-01-01')`), /bad range/);
    const p = (await rows(`select relrowsecurity, relforcerowsecurity, has_table_privilege('clearline_runtime', oid, 'SELECT') as s from pg_class where relname = 'chain_reads_p209903'`))[0];
    expect(p).toEqual({ relrowsecurity: true, relforcerowsecurity: true, s: false });
    await asUser(ids["fin@cr-a.example"], org["cr-merchant-a"], readRow(org["cr-merchant-a"], "2099-03-01T00:00:00Z"));
    expect((await rows(`select tableoid::regclass::text as part from chain_reads where at = '2099-03-01T00:00:00Z'`))[0].part).toBe("chain_reads_p209903");
    await refused(q(`delete from chain_reads where at = '2099-03-01T00:00:00Z'`), /is append-only: (UPDATE|DELETE) refused/); // append-only on the new partition too
  });
});
