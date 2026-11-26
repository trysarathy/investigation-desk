/**
 * v1 phase 0: chain_reads partitioned by month (drizzle/0036) with indexed row-level security (drizzle/0037,
 * approval-only), against PostgreSQL 16. Structure, the append-only guard on every partition, a month without a
 * partition refused loudly, and isolation control tests: another organisation's reads invisible, writes refused,
 * provider reads only under a 'full' grant; the policies' organisation check is an index condition. Fictional data.
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
const count = async (userId: string, orgId: string, where = sql`true`) =>
  Number((await asUser(userId, orgId, sql`select count(*)::int as n from chain_reads where ${where}`)).rows[0].n);
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
    expect(parts.length).toBeGreaterThanOrEqual(24); // January 2025 to 24 months ahead of the migration (0047, #169)
    // v1 #169: every month from now to 24 months ahead has its partition
    const want = Array.from({ length: 25 }, (_, k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k); return `chain_reads_p${d.toISOString().slice(0, 7).replace("-", "")}`; });
    expect(want.filter((p) => !parts.some((x) => x.relname === p))).toEqual([]);
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

describe("SECURITY (approval-only, 0037): chain_reads isolation with indexed policies", () => {
  const A = () => org["cr-merchant-a"], B = () => org["cr-merchant-b"];

  it("a member sees only their organisation's reads; another organisation's are invisible, even when named", async () => {
    expect(await count(ids["fin@cr-a.example"], A())).toBe(5); // 4 seeded + the 2099 read above
    expect(await count(ids["fin@cr-b.example"], B())).toBe(1);
    expect(await count(ids["fin@cr-b.example"], B(), sql`org_id = ${A()}`)).toBe(0);
    // a member of B claiming A's context sees nothing (not a member of A)
    expect(await count(ids["fin@cr-b.example"], A())).toBe(0);
    // no organisation in context: nothing
    expect(Number((await withTenant({ userId: ids["fin@cr-a.example"] }, (tx) => tx.execute(sql`select count(*)::int as n from chain_reads`))).rows[0].n)).toBe(0);
  });

  it("writes into another organisation, or outside a membership, are refused", async () => {
    await refused(asUser(ids["fin@cr-b.example"], B(), readRow(A(), "2026-11-20T00:00:00Z")), /row-level security/);
    await refused(asUser(ids["fin@cr-b.example"], A(), readRow(A(), "2026-11-20T00:00:00Z")), /row-level security/);
    await refused(asUser(ids["admin@cr-provider-a.example"], org["cr-provider-a"], readRow(A(), "2026-11-20T00:00:00Z")), /row-level security/);
    // a multi-row insert with one foreign row is refused as a whole
    await refused(asUser(ids["fin@cr-a.example"], A(), sql`insert into chain_reads (org_id, entity_id, network, tx_hash, status, source, at)
      values (${A()}, 'ENT-1', 'tron', 'c1', 'ok', 'recording', '2026-11-20T00:00:00Z'), (${B()}, 'ENT-1', 'tron', 'c2', 'ok', 'recording', '2026-11-20T00:00:00Z')`), /row-level security/);
    expect(Number((await rows(`select count(*)::int as n from chain_reads where at = '2026-11-20T00:00:00Z'`))[0].n)).toBe(0);
  });

  it("a revoked member sees nothing and cannot write", async () => {
    const email = "revoked@cr-a.example";
    ids[email] = await createUser(ownerDb(), { email, name: "revoked (fictional)", password: PASSWORD });
    await grantMembership(ownerDb(), { orgSlug: "cr-merchant-a", email, role: "finance" as never });
    expect(await count(ids[email], A())).toBe(5); // 4 seeded + the 2099 read above
    await q(`update organization_memberships set revoked_at = now() where user_id = '${ids[email]}'`);
    expect(await count(ids[email], A())).toBe(0);
    await refused(asUser(ids[email], A(), readRow(A(), "2026-11-20T00:00:00Z")), /row-level security/);
  });

  it("a provider reads a merchant's reads only under an unrevoked 'full' grant, never another provider's merchants", async () => {
    const pa = ids["admin@cr-provider-a.example"], pb = ids["admin@cr-provider-b.example"];
    expect(await count(pa, org["cr-provider-a"])).toBe(0); // no grant yet (aggregates-only default)
    await q(`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values ('${A()}', '${org["cr-provider-a"]}', 'aggregates', '${ids["fin@cr-a.example"]}')`);
    expect(await count(pa, org["cr-provider-a"])).toBe(0);
    await q(`update provider_grants set scope = 'full' where merchant_org_id = '${A()}'`);
    expect(await count(pa, org["cr-provider-a"])).toBe(5); // A only, not B
    expect(await count(pa, org["cr-provider-a"], sql`org_id = ${B()}`)).toBe(0);
    expect(await count(pb, org["cr-provider-b"])).toBe(0); // the other provider
    expect(await count(pb, org["cr-provider-a"])).toBe(0); // not a member of provider A
    // a grant to a provider that is not the merchant's own provider is ignored
    await q(`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values ('${B()}', '${org["cr-provider-b"]}', 'full', '${ids["fin@cr-b.example"]}')`);
    expect(await count(pb, org["cr-provider-b"])).toBe(0);
    await q(`update provider_grants set revoked_at = now() where merchant_org_id = '${A()}'`);
    expect(await count(pa, org["cr-provider-a"])).toBe(0);
    await q(`delete from provider_grants`);
  });

  const ENTITY_SCOPE = "((( SELECT app_entity_scope() AS app_entity_scope) IS NULL) OR (entity_id = ANY (( SELECT app_entity_scope() AS app_entity_scope)::text[])))";
  it("the policies: one indexed organisation predicate for reads, the membership check once per statement for inserts", async () => {
    const pol = await rows(`select polname, polcmd, pg_get_expr(polqual, polrelid) as q, pg_get_expr(polwithcheck, polrelid) as c from pg_policy
      where polrelid = 'chain_reads'::regclass order by polname`);
    // v1 phase 4 (drizzle/0078, approval-only, tightening): RESTRICTIVE Auditor policies (chain_reads is hidden from an
    // Auditor and it writes nothing); each is an InitPlan, so the rows stay one indexed organisation predicate
    const NOT_AUDITOR = "(NOT ( SELECT app_is_auditor() AS app_is_auditor))";
    expect(pol).toEqual([
      { polname: "auditor_no_delete", polcmd: "d", q: NOT_AUDITOR, c: null },
      { polname: "auditor_no_insert", polcmd: "a", q: null, c: NOT_AUDITOR },
      { polname: "auditor_no_update", polcmd: "w", q: NOT_AUDITOR, c: null },
      { polname: "auditor_read", polcmd: "r", q: "((( SELECT app_auditor_period() AS app_auditor_period) IS NULL) OR false)", c: null },
      { polname: "chain_reads_insert", polcmd: "a", q: null, c: "((org_id = app_org_id()) AND ( SELECT app_is_member(app_org_id()) AS app_is_member))" },
      { polname: "chain_reads_read", polcmd: "r", q: "(org_id = ANY (( SELECT app_readable_org_ids() AS app_readable_org_ids)::uuid[]))", c: null },
      // v1 phase 1.3 (drizzle/0053, approval-only, tightening): a RESTRICTIVE entity-scope check, AND-ed with the above;
      // its function is an InitPlan too (once per statement), so the rows stay one indexed organisation predicate
      { polname: "entity_scope", polcmd: "*", q: ENTITY_SCOPE, c: ENTITY_SCOPE },
    ]);
    // no permissive UPDATE or DELETE policy and no such privilege: both stay refused (plus the append-only trigger)
    for (const f of ["app_readable_org_ids()", "app_provider_full_access_merchants()"]) {
      const r = (await rows(`select p.prosecdef, p.provolatile, has_function_privilege('clearline_runtime', '${f}', 'EXECUTE') as rt,
        has_function_privilege('clearline_jobs', '${f}', 'EXECUTE') as jb from pg_proc p where p.oid = '${f}'::regprocedure`))[0];
      expect(r).toEqual({ prosecdef: true, provolatile: "s", rt: true, jb: false });
    }
  });

  it("EXPLAIN as the runtime login: the organisation check is an index condition on the parameter of one InitPlan, not a per-row call", async () => {
    const explain = async (userId: string, orgId: string, query: string) => (await withTenant({ userId, orgId }, async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`); // a few rows would be scanned anyway; this checks the index CAN serve the policy
      return tx.execute(sql.raw(`explain (costs off) ${query}`));
    })).rows.map((r) => String(r["QUERY PLAN"])).join("\n");
    for (const [userId, orgId] of [[ids["fin@cr-a.example"], A()], [ids["admin@cr-provider-a.example"], org["cr-provider-a"]]]) {
      const all = await explain(userId, orgId, `select count(*) from chain_reads`);
      expect(all).toMatch(/InitPlan 1/);
      expect(all).toMatch(/Index Scan (using|on) chain_reads_p202611_\w+/);
      expect(all).not.toMatch(/Seq Scan/);
      // v1 (0053): the parameter's number moved (the entity-scope InitPlans come first); still one InitPlan, an index condition
      expect(all).toMatch(/Index Cond: \(org_id = ANY \(\$\d+\)\)/);
      expect(all).not.toMatch(/SubPlan|app_is_member\(|app_provider_full_access\(|app_entity_scope\(|Filter: .*org_id = ANY/);
      // the entity-scope check is a filter on two InitPlan parameters, never a per-row function call
      expect(all).toMatch(/Filter: \(\(\$\d+ IS NULL\) OR \(entity_id = ANY \(\$\d+\)\)\)/);
    }
    const probe = await explain(ids["fin@cr-a.example"], A(), `select id from chain_reads where org_id = '${A()}' and entity_id = 'ENT-1' and status = 'unavailable' limit 1`);
    expect(probe).toMatch(/Index Cond: \(\(org_id = ANY \(\$\d+\)\) AND \(org_id = '[0-9a-f-]+'::uuid\) AND \(entity_id = 'ENT-1'::text\)\)/);
    const ins = await explain(ids["fin@cr-a.example"], A(), `insert into chain_reads (org_id, entity_id, network, tx_hash, status, source, at) values ('${A()}', 'ENT-1', 'tron', 'x', 'ok', 'recording', '2026-11-20T00:00:00Z')`);
    expect(ins).toMatch(/InitPlan 1/);
  });
});
