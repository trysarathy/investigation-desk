import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { pilotSeedWorkspace } from "../../src/server/seed";
import { readWorkspace } from "../../src/server/engine-store";
import { withTenant } from "../../src/server/tenant";
import { closeDatabase } from "../../src/server/db/client";

let ids: Record<string, string>;
let runtime: Pool;
beforeAll(async () => { ids = await resetAndSeed(); runtime = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL }); });
afterAll(async () => { await runtime.end(); await closeDatabase(); await closeOwner(); });

/** Drizzle wraps PostgreSQL errors ("Failed query: ..."); the database's own message is in `cause`. */
export async function expectDbError(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) {
    const msg = `${(e as Error).message} ${((e as { cause?: Error }).cause?.message) ?? ""}`;
    expect(msg).toMatch(re);
    return;
  }
  throw new Error(`expected a database error matching ${re}`);
}

const TENANT_TABLES = ["org_engine_state", "payment_intents", "provider_events", "settlement_evidence", "reconciliation_records", "exceptions",
  "investigations", "investigation_notes", "funding_obligations", "repayment_allocations", "accounting_proposals", "accounting_exports",
  "engine_records", "approval_requests", "approval_decisions", "audit_events", "idempotency_records", "statement_imports"];

describe("migrations and database roles", () => {
  it("every tenant table has org_id, forced row-level security and a policy", async () => {
    const r = await runtime.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
      exists(select 1 from pg_policy p where p.polrelid = c.oid) as has_policy,
      exists(select 1 from information_schema.columns k where k.table_name = c.relname and k.column_name = 'org_id') as has_org
      from pg_class c where c.relname = any($1)`, [TENANT_TABLES]);
    expect(r.rows).toHaveLength(TENANT_TABLES.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, has_policy: true, has_org: true });
  });

  it("the runtime login cannot bypass RLS and owns nothing", async () => {
    const r = await runtime.query(`select current_user as u, rolbypassrls, rolsuper from pg_roles where rolname = current_user`);
    expect(r.rows[0]).toMatchObject({ u: "clearline_runtime", rolbypassrls: false, rolsuper: false });
    const owned = await runtime.query(`select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = current_user`);
    expect(owned.rows[0].n).toBe(0);
  });

  it("without a tenant context the runtime role sees no tenant rows", async () => {
    for (const tb of ["payment_intents", "audit_events", "exceptions"]) {
      const r = await runtime.query(`select count(*)::int as n from ${tb}`);
      expect(r.rows[0].n, tb).toBe(0);
    }
  });

  it("money is stored as bigint minor units and negative amounts are refused", async () => {
    const r = await runtime.query(`select data_type from information_schema.columns where table_name = 'payment_intents' and column_name = 'amount_minor'`);
    expect(r.rows[0].data_type).toBe("bigint");
    const [org] = (await ownerDb().execute(sql.raw(`select id from organizations where slug = 'lumen-demo'`))).rows as { id: string }[];
    await expectDbError(ownerDb().execute(sql.raw(`insert into payment_intents (org_id, id, ord, internal_reference, beneficiary_name, amount_minor, currency, execution, settlement, reconciliation, record)
      values ('${org.id}', 'pi_neg', 999, 'X', 'Y', -1, 'USD', 'draft', 'none', 'unmatched', '{}')`)), /payment_intents_amount_chk/);
  });

  it("audit history is append-only for the runtime role AND the owner", async () => {
    const [org] = (await ownerDb().execute(sql.raw(`select id from organizations where slug = 'lumen-demo'`))).rows as { id: string }[];
    await expectDbError(ownerDb().execute(sql.raw(`update audit_events set summary = 'tampered' where org_id = '${org.id}'`)), /append-only/);
    await expectDbError(ownerDb().execute(sql.raw(`delete from audit_events where org_id = '${org.id}'`)), /append-only/);
    await expectDbError(ownerDb().execute(sql.raw(`truncate audit_events`)), /append-only/);
    const c = await runtime.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`, [ids["ops@lumen.example"], org.id]);
      await expect(c.query(`update audit_events set summary = 'x'`)).rejects.toThrow(/permission denied|append-only/);
    } finally { await c.query("rollback"); c.release(); }
  });

  it("the stored organisation reloads into exactly the seeded engine workspace (round trip)", async () => {
    const [org] = (await ownerDb().execute(sql.raw(`select id from organizations where slug = 'lumen-demo'`))).rows as { id: string }[];
    const ws = await withTenant({ userId: ids["ops@lumen.example"], orgId: org.id }, (tx) => readWorkspace(tx, org.id));
    const seed = pilotSeedWorkspace();
    for (const k of ["intents", "providerEvents", "statementLines", "chainObservations", "allocations", "exceptions", "cases", "advances", "obligations", "repaymentAllocations", "quotes", "instructions", "holds", "audit"] as const) {
      expect(ws[k], k).toEqual(seed[k]);
    }
    expect(ws.accounting).toEqual(seed.accounting);
    expect(ws.seq).toBe(seed.seq);
    // members are actors (fictional seed actors are kept for history)
    expect(ws.actors.map((a) => a.id)).toEqual(expect.arrayContaining([ids["ops@lumen.example"], ids["approver@lumen.example"], "usr_maya"]));
    expect(ws.actors.map((a) => a.id)).not.toContain(ids["ops@harbour.example"]);
  });
});
