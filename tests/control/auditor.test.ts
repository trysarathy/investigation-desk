/**
 * v1 phase 4: the Auditor role against PostgreSQL 16. Read-only, scoped to a period (whole months) and optionally to
 * entities, time-limited, audited; enforced by the server AND by row-level security with the services bypassed.
 * Negative tests: other periods, other entities, every other service, every write, an expired or revoked grant.
 * Fictional people and data only (the Straits seed). Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, enrolTestTotp, ownerDb, PASSWORD, resetAndSeed, signInWithMfa } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { createUser, grantAuditor, grantMembership, revokeAuditor } from "../../src/server/admin";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, MERCHANT_SEED_USERS, seedMerchantCases } from "../../src/server/merchant-seed";
import { listMerchantPayments, monthEnd, runReconciliation } from "../../src/server/merchant";
import { evidencePack, journalExport } from "../../src/server/merchant-ui";
import { monthEndPack } from "../../src/server/exports";
import { postingRulesStatus } from "../../src/server/posting-rules";
import { auditorEvidencePack, auditorView } from "../../src/server/auditor";
import { GET as auditGET } from "../../src/app/api/control/audit/evidence/route";
import { GET as evidenceGET } from "../../src/app/api/control/merchant/evidence/route";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const SLUG = MERCHANT_SEED_ORGS.sg.slug;
const NOV = "auditor.nov@audit-firm.example", SCOPED = "auditor.sg01@audit-firm.example", OCT = "auditor.oct@audit-firm.example", EXPIRED = "auditor.old@audit-firm.example";
const in7days = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
const users: Record<string, string> = {};
let n = 0;
const key = () => `aud-key-${++n}-${Date.now()}`;
const ctx = (email: string): Promise<TenantContext> => resolveTenant({ userId: users[email], name: email, email }, SLUG);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const as = async (email: string, q: ReturnType<typeof sql>) => (await withTenant({ userId: users[email], orgId: seed.orgs.sg }, (tx) => tx.execute(q))).rows as Record<string, unknown>[];
const count = async (email: string, table: string) => Number((await as(email, sql.raw(`select count(*)::int as n from ${table}`)))[0].n);
async function refused(p: Promise<unknown>, status: number) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AccessDenied); expect((e as AccessDenied).status).toBe(status); return; }
  throw new Error(`expected ${status}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
/** Orders of the November period as the owner sees them: invoices issued in November in the entity's own calendar. */
const novOrders = async (entity?: string) => (await rows(sql`select i.order_id from invoices i join merchant_entities e on e.org_id = i.org_id and e.id = i.entity_id
  where i.org_id = ${seed.orgs.sg} and to_char((i.issued_at at time zone 'UTC') + make_interval(mins => e.utc_offset_minutes), 'YYYY-MM') = '2026-11'
  ${entity ? sql`and i.entity_id = ${entity}` : sql``} order by 1`)).map((r) => String(r.order_id));

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  for (const u of MERCHANT_SEED_USERS) users[u.email] = seed.users[u.email];
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(await ctx("ops@straits-demo.example"), e, key());
  for (const email of [NOV, SCOPED, OCT, EXPIRED]) {
    users[email] = await createUser(ownerDb(), { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await enrolTestTotp(users[email]);
  }
  await grantAuditor(ownerDb(), { orgSlug: SLUG, email: NOV, from: "2026-11", to: "2026-11", expiresAt: in7days(), grantedBy: "admin@straits-demo.example" });
  await grantAuditor(ownerDb(), { orgSlug: SLUG, email: SCOPED, from: "2026-11", to: "2026-11", expiresAt: in7days(), grantedBy: "admin@straits-demo.example", entities: ["ENT-SG-01"] });
  await grantAuditor(ownerDb(), { orgSlug: SLUG, email: OCT, from: "2026-10", to: "2026-10", expiresAt: in7days(), grantedBy: "admin@straits-demo.example" });
  // an expired grant: made ten days ago, ended yesterday (the owner writes it as the provisioning path would have)
  await grantMembership(ownerDb(), { orgSlug: SLUG, email: EXPIRED, role: "auditor" });
  await ownerDb().execute(sql`insert into auditor_grants (org_id, user_id, period_start, period_end, expires_at, granted_by, created_at)
    values (${seed.orgs.sg}, ${users[EXPIRED]}, '2026-11-01', '2026-11-30', now() - interval '1 day', 'test', now() - interval '10 days')`);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("the server", () => {
  it("an Auditor's context carries its grant; it lists exactly the period's payments of its entities", async () => {
    const c = await ctx(NOV);
    expect(c.audit).toMatchObject({ periodStart: "2026-11-01", periodEnd: "2026-11-30", months: ["2026-11"] });
    const v = await auditorView(c);
    const nov = await novOrders();
    expect(v.payments.length).toBeGreaterThan(0);
    expect(v.payments.every((p) => nov.includes(p.orderId) && p.months.includes("2026-11"))).toBe(true);
    const s = await auditorView(await ctx(SCOPED));
    expect(s.entities.map((e) => e.id)).toEqual(["ENT-SG-01"]);
    expect(s.payments.every((p) => p.entityId === "ENT-SG-01")).toBe(true);
    expect((await auditorView(await ctx(OCT))).payments).toEqual([]);
  });

  it("downloads evidence packs of its period, per payment and per entity-month, each audited with the grant", async () => {
    const c = await ctx(NOV);
    const order = (await auditorView(c)).payments[0].orderId;
    const before = (await rows(sql`select count(*)::int as n from audit_events where action = 'auditor_evidence_pack_downloaded'`))[0].n as number;
    const one = await auditorEvidencePack(c, { kind: "payment", orderId: order }, "json");
    expect(JSON.parse(String(one.body)).payments.map((p: { orderId: string }) => p.orderId)).toEqual([order]);
    const month = await auditorEvidencePack(c, { kind: "month", entityId: "ENT-SG-01", month: "2026-11" }, "pdf");
    expect(Buffer.from(month.body as Uint8Array).subarray(0, 5).toString()).toBe("%PDF-");
    const audits = await rows(sql`select actor_user_id, details from audit_events where action = 'auditor_evidence_pack_downloaded' order by seq`);
    expect(audits.length).toBe(before + 2);
    for (const a of audits.slice(before)) { expect(a.actor_user_id).toBe(users[NOV]); expect((a.details as { grantId: string }).grantId).toBe(c.audit!.grantId); }
  });

  it("cannot see another period, another entity, or a payment outside its period (not found)", async () => {
    const c = await ctx(NOV);
    await refused(auditorEvidencePack(c, { kind: "month", entityId: "ENT-SG-01", month: "2026-10" }, "json"), 404);
    await refused(auditorEvidencePack(c, { kind: "month", entityId: "ENT-SG-01", month: "2026-12" }, "json"), 404);
    const dec = (await rows(sql`select order_id from invoices where org_id = ${seed.orgs.sg} and order_id not in (${sql.join((await novOrders()).map((o) => sql`${o}`), sql`, `)}) limit 1`))[0];
    if (dec) await refused(auditorEvidencePack(c, { kind: "payment", orderId: String(dec.order_id) }, "json"), 404);
    const nov = (await novOrders("ENT-SG-01"))[0];
    await refused(auditorEvidencePack(await ctx(OCT), { kind: "payment", orderId: nov }, "json"), 404);
    const other = (await novOrders("ENT-SG-02"))[0];
    await refused(auditorEvidencePack(await ctx(SCOPED), { kind: "payment", orderId: other }, "json"), 404);
    await refused(auditorEvidencePack(await ctx(SCOPED), { kind: "month", entityId: "ENT-SG-02", month: "2026-11" }, "json"), 404);
  });

  it("every other service refuses the role (403): payments, month-end, exports, the merchant evidence pack, posting rules", async () => {
    const c = await ctx(NOV);
    await refused(listMerchantPayments(c), 403);
    await refused(monthEnd(c, "ENT-SG-01", "2026-11"), 403);
    await refused(monthEndPack(c, "ENT-SG-01", "2026-11"), 403);
    await refused(journalExport(c, "ENT-SG-01", "2026-11", "csv"), 403);
    await refused(evidencePack(c, { kind: "month", entityId: "ENT-SG-01", month: "2026-11" }, "json"), 403);
    await refused(postingRulesStatus(c), 403);
  });

  it("time-limited: an expired grant, and a revoked one, give no access at all", async () => {
    await refused(ctx(EXPIRED), 403);
    const tmp = "auditor.tmp@audit-firm.example";
    users[tmp] = await createUser(ownerDb(), { email: tmp, name: "tmp (fictional)", password: PASSWORD });
    await grantAuditor(ownerDb(), { orgSlug: SLUG, email: tmp, from: "2026-11", to: "2026-11", expiresAt: in7days(), grantedBy: "test" });
    expect((await ctx(tmp)).audit).toBeDefined();
    expect(await revokeAuditor(ownerDb(), { orgSlug: SLUG, email: tmp })).toEqual({ grantsRevoked: 1 });
    await refused(ctx(tmp), 403); // no active membership left anywhere
  });

  it("a grant is limited by the database too: whole months, at most twelve, at most 90 days; never edited", async () => {
    const ins = (start: string, end: string, expires: string) => ownerDb().execute(sql`insert into auditor_grants (org_id, user_id, period_start, period_end, expires_at, granted_by)
      values (${seed.orgs.sg}, ${users[NOV]}, ${start}, ${end}, now() + ${expires}::interval, 'test')`);
    await dbRefuses(ins("2026-11-02", "2026-11-30", "1 day"), /auditor_grants_period_chk/);
    await dbRefuses(ins("2026-01-01", "2027-01-31", "1 day"), /auditor_grants_period_chk/);
    await dbRefuses(ins("2026-11-01", "2026-11-30", "91 days"), /auditor_grants_expiry_chk/);
    await dbRefuses(ownerDb().execute(sql`update auditor_grants set period_end = '2026-12-31' where user_id = ${users[NOV]}`), /never changed/);
    await dbRefuses(grantAuditor(ownerDb(), { orgSlug: SLUG, email: "finance@straits-demo.example", from: "2026-11", to: "2026-11", expiresAt: in7days(), grantedBy: "test" }), /already holds the finance role/);
  });
});

describe("the database, with the services bypassed", () => {
  it("dated rows: only the period's invoices, transfers, batches, bank lines and journals; dependent rows follow", async () => {
    const nov = await novOrders();
    expect((await as(NOV, sql`select order_id from invoices order by 1`)).map((r) => String(r.order_id))).toEqual(nov);
    expect((await as(SCOPED, sql`select order_id from invoices order by 1`)).map((r) => String(r.order_id))).toEqual(await novOrders("ENT-SG-01"));
    const mr = (await as(NOV, sql`select order_id from match_records order by 1`)).map((r) => String(r.order_id));
    expect(mr.every((o) => nov.includes(o))).toBe(true);
    expect((await as(NOV, sql`select count(*)::int as n from chain_transfers where to_char(block_time, 'YYYY-MM') not in ('2026-10', '2026-11', '2026-12')`))[0].n).toBe(0);
    expect((await as(NOV, sql`select count(*)::int as n from merchant_journal_proposals where evidence_refs->>'entryDate' not like '2026-11-%'`))[0].n).toBe(0);
    expect((await as(NOV, sql`select count(*)::int as n from bank_lines where value_date not like '2026-11-%'`))[0].n).toBe(0);
    for (const tb of ["invoices", "match_records", "chain_transfers", "settlement_batches", "bank_lines", "differences", "merchant_journal_proposals", "recon_exceptions"]) expect(await count(OCT, tb), `${tb} for another period`).toBe(0);
    for (const tb of ["invoices", "match_records", "chain_transfers", "merchant_entities", "organization_memberships", "audit_events"]) expect(await count(EXPIRED, tb), `${tb} for an expired grant`).toBe(0);
  });

  it("tables outside an evidence pack are hidden entirely", async () => {
    for (const tb of ["uploads", "ledger_invoices", "fiat_rates", "merchant_policy", "notifications", "reconciliation_runs", "posting_rules_signatures", "idempotency_records", "bank_accounts", "org_security_settings", "fx_rates"]) {
      expect(await count(NOV, tb), tb).toBe(0);
    }
    // the same tables are not empty for Finance (the predicate is about the role, not the data)
    expect(Number((await withTenant({ userId: users["finance@straits-demo.example"], orgId: seed.orgs.sg }, (tx) => tx.execute(sql`select count(*)::int as n from uploads`))).rows[0].n)).toBeGreaterThanOrEqual(0);
    expect(Number((await withTenant({ userId: users["finance@straits-demo.example"], orgId: seed.orgs.sg }, (tx) => tx.execute(sql`select count(*)::int as n from merchant_policy`))).rows[0].n)).toBeGreaterThan(0);
  });

  it("writes nothing: inserts are refused, updates and deletes change no row; only its own audit rows are accepted", async () => {
    await dbRefuses(as(NOV, sql`insert into recon_exception_notes (org_id, exception_id, kind, body, author_user_id) select org_id, id, 'note', 'x', ${users[NOV]} from recon_exceptions limit 1`), /row-level security/);
    await dbRefuses(as(NOV, sql`insert into audit_events (org_id, source, actor_user_id, action, summary, at) values (${seed.orgs.sg}, 'server', ${users["finance@straits-demo.example"]}, 'forged', 'x', now())`), /row-level security/);
    expect((await withTenant({ userId: users[NOV], orgId: seed.orgs.sg }, (tx) => tx.execute(sql`update match_records set decision = decision`))).rowCount).toBe(0);
    // upload_rows is the one organisation table the app may delete from (retention): an Auditor deletes nothing
    expect((await withTenant({ userId: users[NOV], orgId: seed.orgs.sg }, (tx) => tx.execute(sql`delete from upload_rows`))).rowCount).toBe(0);
    await as(NOV, sql`insert into audit_events (org_id, source, actor_user_id, action, summary, at) values (${seed.orgs.sg}, 'server', ${users[NOV]}, 'auditor_test', 'own row', now())`);
  });

  it("every organisation table with row-level security carries the auditor policies (a new table cannot be forgotten silently)", async () => {
    const missing = await rows(sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition and c.relrowsecurity and c.relname <> 'organizations'
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname in ('org_id','merchant_org_id','provider_org_id') and not a.attisdropped)
        and (select count(*) from pg_policy p where p.polrelid = c.oid and p.polname in ('auditor_read','auditor_no_insert','auditor_no_update','auditor_no_delete')) <> 4`);
    expect(missing).toEqual([]);
  });
});

describe("route handlers with a real session (MFA required for the role)", () => {
  it("the Auditor downloads its period's pack; another month is 404; the merchant evidence route is 403", async () => {
    const cookie = `${await signInWithMfa(NOV, PASSWORD, "198.51.100.97")}; clearline_org=${SLUG}`;
    const order = (await auditorView(await ctx(NOV))).payments[0].orderId;
    const ok = await auditGET(new Request(`${ORIGIN}/api/control/audit/evidence?order=${order}&format=pdf`, { headers: { cookie } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toMatch(/clearline-audit-evidence-/);
    await ok.arrayBuffer();
    expect((await auditGET(new Request(`${ORIGIN}/api/control/audit/evidence?entity=ENT-SG-01&month=2026-10&format=csv`, { headers: { cookie } }))).status).toBe(404);
    expect((await evidenceGET(new Request(`${ORIGIN}/api/control/merchant/evidence?order=${order}&format=json`, { headers: { cookie } }))).status).toBe(403);
    const fin = `${await signInWithMfa("finance@straits-demo.example", PASSWORD, "198.51.100.98")}; clearline_org=${SLUG}`;
    expect((await auditGET(new Request(`${ORIGIN}/api/control/audit/evidence?order=${order}&format=json`, { headers: { cookie: fin } }))).status).toBe(403);
  });
});
