/**
 * v1 phase 1.3: per-entity scoping of a membership, against PostgreSQL 16. A membership limited to some entities
 * cannot read or act on another entity of the same organisation, through the services (server check) AND with the
 * services bypassed (RESTRICTIVE row-level security, drizzle/0053). Unscoped memberships are unchanged. Fictional
 * data only (the Straits seed: ENT-SG-01, ENT-SG-02, ENT-US-02). Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUser, grantMembership, setEntityScope } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import {
  batchBridge, dailyReport, decideWriteoff, listMerchantPayments, merchantPaymentDetail, monthEnd, pilotMetrics, proposeWriteoff, recordMatchReview, runReconciliation, updateMerchantPolicy,
} from "../../src/server/merchant";
import { evidencePack, exceptionDetail, exceptionsView, journalExport, listBatches, listMerchantApprovals, merchantShell, overviewCounts, paymentContext } from "../../src/server/merchant-ui";
import { exportMonths, journalDraftFile, monthEndPack } from "../../src/server/exports";
import { createUpload, listUploads, setRetentionDays } from "../../src/server/uploads";
import { listRuns, setRunSchedule } from "../../src/server/runs";
import { listNotifications } from "../../src/server/notifications";
import { setProviderGrant } from "../../src/server/provider";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `es-key-${++n}-${Date.now()}`;
const SLUG = MERCHANT_SEED_ORGS.sg.slug;
const ENTS = ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"] as const;
const ids: Record<string, string> = {};
const ctx = (email: string): Promise<TenantContext> => resolveTenant({ userId: ids[email] ?? seed.users[email], name: email, email }, SLUG);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const as = (email: string, q: ReturnType<typeof sql>) => withTenant({ userId: ids[email] ?? seed.users[email], orgId: seed.orgs.sg }, (tx) => tx.execute(q));

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
/** Orders of an entity, from the owner connection (the truth the scoped reads are checked against). */
const ordersOf = async (entityId: string) => (await rows(sql`select order_id from invoices where org_id = ${seed.orgs.sg} and entity_id = ${entityId} order by order_id`)).map((r) => String(r.order_id));

// A write-off awaiting approval on one entity (the "other" entity of the scoped approver), and its entity.
let wo: { id: string; orderId: string; entityId: string };
let other: string; // an entity that is NOT the write-off's

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  const ops = await ctx("ops@straits-demo.example");
  for (const e of ENTS) await runReconciliation(ops, e, key());
  const w = (await rows(sql`select w.id, w.order_id, i.entity_id from writeoff_proposals w join invoices i on i.org_id = w.org_id and i.order_id = w.order_id
    where w.org_id = ${seed.orgs.sg} and w.status = 'proposed' order by w.id limit 1`))[0];
  wo = { id: String(w.id), orderId: String(w.order_id), entityId: String(w.entity_id) };
  other = ENTS.find((e) => e !== wo.entityId)!;
  // fictional scoped members of the Straits merchant
  for (const [email, role, entities] of [
    ["finance-one@straits-demo.example", "finance", [other]],
    ["approver-other@straits-demo.example", "approver", [other]],
    ["approver-same@straits-demo.example", "approver", [wo.entityId]],
    ["admin-one@straits-demo.example", "admin", [other]],
  ] as const) {
    ids[email] = await createUser(ownerDb(), { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await grantMembership(ownerDb(), { orgSlug: SLUG, email, role, entities: [...entities] });
  }
  // the unscoped Finance member submits the write-off for approval
  await proposeWriteoff(await ctx("finance@straits-demo.example"), wo.id, key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("unscoped memberships are unchanged", () => {
  it("an unscoped member sees every entity, its payments and its shell", async () => {
    const f = await ctx("finance@straits-demo.example");
    expect(f.entityScope).toBeNull();
    expect((await merchantShell(f)).entities.map((e) => e.id)).toEqual([...ENTS]);
    const all = (await rows(sql`select count(*)::int as n from match_records where org_id = ${seed.orgs.sg}`))[0].n;
    expect((await listMerchantPayments(f)).length).toBe(all);
    expect(new Set((await listMerchantPayments(f)).map((p) => p.entityId))).toEqual(new Set(ENTS));
  });
});

describe("a Finance member scoped to one entity", () => {
  it("the context carries the scope; the shell, lists and counts hold only that entity", async () => {
    const f = await ctx("finance-one@straits-demo.example");
    expect(f.entityScope).toEqual([other]);
    expect((await merchantShell(f)).entities.map((e) => e.id)).toEqual([other]);
    const mine = await ordersOf(other);
    expect((await listMerchantPayments(f)).map((p) => p.orderId).sort()).toEqual(mine);
    expect((await overviewCounts(f)).orders).toBe(mine.length);
    expect((await listBatches(f)).every((b) => b.entityId === other)).toBe(true);
    expect((await exceptionsView(f)).exceptions.every((e) => e.entityId === other)).toBe(true);
    expect((await listRuns(f)).runs.map((r) => r.entityId)).toEqual([other]);
    expect((await listUploads(f)).uploads.every((u) => u.entityId === other)).toBe(true);
    expect((await listNotifications(f)).notifications.every((x) => x.entityId === null || x.entityId === other)).toBe(true);
    expect((await pilotMetrics(f)).payments).toBe(mine.length);
  });

  it("cannot read another entity's payment, batch, exception, month-end, export or evidence pack (not found)", async () => {
    const f = await ctx("finance-one@straits-demo.example");
    const theirs = (await ordersOf(wo.entityId))[0];
    await refused(merchantPaymentDetail(f, theirs), "ACCESS_404");
    await refused(paymentContext(f, theirs), "ACCESS_404");
    await refused(listMerchantPayments(f, { entityId: wo.entityId }), "ACCESS_404");
    await refused(dailyReport(f, wo.entityId, "2026-11-03"), "ACCESS_404");
    await refused(monthEnd(f, wo.entityId, "2026-11"), "ACCESS_404");
    await refused(journalExport(f, wo.entityId, "2026-11", "csv"), "ACCESS_404");
    await refused(journalDraftFile(f, wo.entityId, "2026-11", "xero"), "ACCESS_404");
    await refused(monthEndPack(f, wo.entityId, "2026-11"), "ACCESS_404");
    await refused(exportMonths(f, wo.entityId), "ACCESS_404");
    await refused(evidencePack(f, { kind: "payment", orderId: theirs }, "json"), "ACCESS_404");
    await refused(evidencePack(f, { kind: "month", entityId: wo.entityId, month: "2026-11" }, "csv"), "ACCESS_404");
    await refused(listRuns(f, { entityId: wo.entityId }), "ACCESS_404");
    const batch = (await rows(sql`select batch_id from settlement_batches where org_id = ${seed.orgs.sg} and entity_id = ${wo.entityId} limit 1`))[0];
    if (batch) await refused(batchBridge(f, String(batch.batch_id)), "ACCESS_404");
    const ex = (await rows(sql`select id from recon_exceptions where org_id = ${seed.orgs.sg} and entity_id <> ${other} limit 1`))[0];
    if (ex) await refused(exceptionDetail(f, String(ex.id)), "ACCESS_404");
  });

  it("cannot act on another entity: run, upload, schedule, review, write-off", async () => {
    const f = await ctx("finance-one@straits-demo.example");
    await refused(runReconciliation(f, wo.entityId, key()), "ACCESS_404");
    await refused(createUpload(f, { entityId: wo.entityId, fileType: "provider_export", fileName: "x.csv", bytes: new TextEncoder().encode("a,b\n1,2\n") }, key()), "ACCESS_404");
    await refused(setRunSchedule(f, wo.entityId, { localTime: "03:00" }, key()), "ACCESS_404");
    await refused(recordMatchReview(f, (await ordersOf(wo.entityId))[0], { verdict: "correct" }, key()), "ACCESS_404");
    await refused(proposeWriteoff(f, wo.id, key()), "ACCESS_404");
    // and still acts on its own entity
    expect((await runReconciliation(f, other, key())).body.entityId).toBe(other);
  });

  it("the database refuses the same reads and writes with the services bypassed", async () => {
    const theirs = (await ordersOf(wo.entityId))[0];
    const E = wo.entityId;
    const forced: [string, ReturnType<typeof sql>][] = [
      ["merchant_entities", sql`select count(*)::int as n from merchant_entities where id = ${E}`],
      ["merchant_policy", sql`select count(*)::int as n from merchant_policy where entity_id = ${E}`],
      ["invoices", sql`select count(*)::int as n from invoices where entity_id = ${E}`],
      ["match_records", sql`select count(*)::int as n from match_records where order_id = ${theirs}`],
      ["differences", sql`select count(*)::int as n from differences d join (select 1) x on true where d.order_id = ${theirs}`],
      ["writeoff_proposals", sql`select count(*)::int as n from writeoff_proposals where id = ${wo.id}`],
      ["merchant_quotes", sql`select count(*)::int as n from merchant_quotes where order_id = ${theirs}`],
      ["chain_transfers", sql`select count(*)::int as n from chain_transfers where entity_id = ${E}`],
      ["settlement_batches", sql`select count(*)::int as n from settlement_batches where entity_id = ${E}`],
      ["bank_lines", sql`select count(*)::int as n from bank_lines where entity_id = ${E}`],
      ["reconciliation_runs", sql`select count(*)::int as n from reconciliation_runs where entity_id = ${E}`],
      ["recon_exceptions", sql`select count(*)::int as n from recon_exceptions where entity_id = ${E} or order_id = ${theirs}`],
      ["merchant_journal_proposals", sql`select count(*)::int as n from merchant_journal_proposals where entity_id = ${E}`],
      ["approval_requests", sql`select count(*)::int as n from approval_requests where subject_id = ${wo.id}`],
      ["notifications", sql`select count(*)::int as n from notifications where entity_id = ${E}`],
    ];
    for (const [table, q] of forced) {
      const truth = (await ownerDb().execute(sql`${q}`)).rows[0]?.n;
      expect(Number(truth), `${table}: the owner sees rows`).toBeGreaterThanOrEqual(table === "notifications" || table === "differences" || table === "merchant_journal_proposals" || table === "settlement_batches" || table === "bank_lines" ? 0 : 1);
      expect((await as("finance-one@straits-demo.example", q)).rows[0].n, table).toBe(0);
    }
    // unfiltered counts match the scoped truth
    const mine = await ordersOf(other);
    expect((await as("finance-one@straits-demo.example", sql`select count(*)::int as n from invoices`)).rows[0].n).toBe(mine.length);
    // writes for another entity are refused by the policy
    await dbRefuses(as("finance-one@straits-demo.example", sql`insert into chain_reads (org_id, entity_id, network, address, status, source, at) values (${seed.orgs.sg}, ${E}, 'tron', 'T_FICTIONAL_SCOPE', 'ok', 'chain_client', now())`), /row-level security/);
    await dbRefuses(as("finance-one@straits-demo.example", sql`insert into recon_exceptions (org_id, id, entity_id, owner_role, reason, next_step, opened_at) values (${seed.orgs.sg}, 'EX-SCOPE-1', ${E}, 'Treasury', 'Fictional scope check', 'Nothing to do', now())`), /row-level security/);
  });
});

describe("wave 1: tables added beside entity scope", () => {
  it("fiat_rates is organisation-wide by design (no entity): a scoped member reads the org's rates, never writes one", async () => {
    const E = wo.entityId;
    await ownerDb().execute(sql`insert into fiat_rates (org_id, base_currency, quote_currency, rate, as_of, source_label, recorded_by)
      values (${seed.orgs.sg}, 'USD', 'SGD', 1.3500000000, '2026-11-30T09:00:00Z', 'Fictional rate source', 'entity-scope test')`);
    const all = Number((await rows(sql`select count(*)::int as n from fiat_rates where org_id = ${seed.orgs.sg}`))[0].n);
    expect((await as("finance-one@straits-demo.example", sql`select count(*)::int as n from fiat_rates`)).rows[0].n).toBe(all);
    await dbRefuses(as("finance-one@straits-demo.example", sql`insert into fiat_rates (org_id, base_currency, quote_currency, rate, as_of, source_label, recorded_by)
      values (${seed.orgs.sg}, 'USD', 'SGD', 9, now(), 'Scoped write', 'x')`), /permission denied/);
    // A1's bank evidence (0042) is a column of match_records: another entity's records stay invisible (above), so does it
    expect((await as("finance-one@straits-demo.example", sql`select count(*)::int as n from match_records m join invoices i on i.org_id = m.org_id and i.order_id = m.order_id where i.entity_id = ${E} and m.bank_evidence is not null`)).rows[0].n).toBe(0);
  });
});

describe("wave 1: every table that carries an entity has the scope policy", () => {
  it("each public table with an entity_id the app can read has a RESTRICTIVE entity_scope policy (new tables of A1, A2, A3 and B1 included)", async () => {
    const tables = (await rows(sql`select distinct c.table_name as t from information_schema.columns c
      join pg_class k on k.relname = c.table_name and k.relnamespace = 'public'::regnamespace and k.relkind in ('r', 'p')
      where c.table_schema = 'public' and c.column_name = 'entity_id' and has_table_privilege('clearline_runtime', k.oid, 'SELECT') order by 1`)).map((r) => String(r.t));
    // audit_events.entity_id names the audited object (not a merchant entity); membership_entity_scopes is the scope itself
    const exempt = new Set(["audit_events", "membership_entity_scopes"]);
    const policies = new Set((await rows(sql`select tablename as t from pg_policies where schemaname = 'public' and policyname = 'entity_scope' and permissive = 'RESTRICTIVE'`)).map((r) => String(r.t)));
    const missing = tables.filter((t) => !exempt.has(t) && !policies.has(t));
    expect(missing).toEqual([]);
    expect(tables.length).toBeGreaterThan(15);
  });
});

describe("the server check holds on its own", () => {
  it("with every entity_scope policy dropped (owner, this test only), the services still refuse and filter", async () => {
    const pols = await rows(sql`select tablename, qual, with_check from pg_policies where policyname = 'entity_scope' order by tablename`);
    // v1 phase 2.1 (drizzle/0074, was 0055): +2, upload_pickup_sources and upload_pickup_items
    expect(pols.length).toBe(35);
    try {
      for (const p of pols) await ownerDb().execute(sql.raw(`drop policy entity_scope on ${p.tablename}`));
      const f = await ctx("finance-one@straits-demo.example");
      // the database no longer narrows the rows...
      expect((await as("finance-one@straits-demo.example", sql`select count(*)::int as n from invoices`)).rows[0].n).toBeGreaterThan((await ordersOf(other)).length);
      // ...and the services still do
      const theirs = (await ordersOf(wo.entityId))[0];
      expect((await listMerchantPayments(f)).every((x) => x.entityId === other)).toBe(true);
      expect((await merchantShell(f)).entities.map((e) => e.id)).toEqual([other]);
      expect((await overviewCounts(f)).orders).toBe((await ordersOf(other)).length);
      expect((await exceptionsView(f)).exceptions.every((e) => e.entityId === other)).toBe(true);
      await refused(merchantPaymentDetail(f, theirs), "ACCESS_404");
      await refused(runReconciliation(f, wo.entityId, key()), "ACCESS_404");
      await refused(evidencePack(f, { kind: "payment", orderId: theirs }, "json"), "ACCESS_404");
      const a = await ctx("approver-other@straits-demo.example");
      const [req] = await rows(sql`select id, payload_sha256 from approval_requests where org_id = ${seed.orgs.sg} and subject_id = ${wo.id} and status = 'pending'`);
      expect((await listMerchantApprovals(a)).requests.some((r) => r.id === req.id)).toBe(false);
      await refused(decideWriteoff(a, String(req.id), { decision: "approve", reason: "Fictional approval attempt", payloadSha256: String(req.payload_sha256) }, key()), "ACCESS_404");
    } finally {
      for (const p of pols) await ownerDb().execute(sql.raw(`create policy entity_scope on ${p.tablename} as restrictive for all to clearline_app using (${p.qual}) with check (${p.with_check})`));
    }
    expect((await rows(sql`select count(*)::int as n from pg_policies where policyname = 'entity_scope' and permissive = 'RESTRICTIVE'`))[0].n).toBe(35);
  });
});

describe("an Approver scoped to one entity", () => {
  it("does not see, and cannot decide, another entity's write-off — through the service or the database", async () => {
    const a = await ctx("approver-other@straits-demo.example");
    const [req] = await rows(sql`select id, payload_sha256 from approval_requests where org_id = ${seed.orgs.sg} and subject_id = ${wo.id} and status = 'pending'`);
    expect((await listMerchantApprovals(a)).requests.some((r) => r.id === req.id)).toBe(false);
    await refused(decideWriteoff(a, String(req.id), { decision: "approve", reason: "Fictional approval attempt", payloadSha256: String(req.payload_sha256) }, key()), "ACCESS_404");
    // a forced decision row is refused by the entity_scope policy, although the decision trigger is SECURITY DEFINER
    await dbRefuses(as("approver-other@straits-demo.example", sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256)
      values (${seed.orgs.sg}, ${String(req.id)}::uuid, ${ids["approver-other@straits-demo.example"]}, 'approve', 'Fictional forced approval', ${String(req.payload_sha256)})`), /row-level security/);
    expect((await rows(sql`select status from approval_requests where id = ${String(req.id)}::uuid`))[0].status).toBe("pending");
  });

  it("an Approver scoped to the write-off's entity decides it; the preparer still never approves", async () => {
    const [req] = await rows(sql`select id, payload_sha256, requested_by from approval_requests where org_id = ${seed.orgs.sg} and subject_id = ${wo.id} and status = 'pending'`);
    expect(req.requested_by).toBe(seed.users["finance@straits-demo.example"]);
    const a = await ctx("approver-same@straits-demo.example");
    expect((await listMerchantApprovals(a)).requests.some((r) => r.id === req.id)).toBe(true);
    const r = await decideWriteoff(a, String(req.id), { decision: "approve", reason: "Fictional approval in scope", payloadSha256: String(req.payload_sha256) }, key());
    expect(r.body.status).toBe("approved");
  });
});

describe("organisation-wide changes need an unscoped membership", () => {
  it("a scoped Admin cannot grant a provider access to every entity, change retention, or edit another entity's policy", async () => {
    const ad = await ctx("admin-one@straits-demo.example");
    await refused(setProviderGrant(ad, { scope: "full" }, key()), "ACCESS_403");
    await refused(setRetentionDays(ad, 30, key()), "ACCESS_403");
    await refused(updateMerchantPolicy(ad, wo.entityId, { writeoffThresholdMinor: 100 }, 1, key()), "ACCESS_404");
  });
});

describe("scope changes", () => {
  it("scoped with no entity sees nothing (fail closed); 'all' restores every entity; each change is audited", async () => {
    const email = "finance-one@straits-demo.example";
    await ownerDb().execute(sql`delete from membership_entity_scopes where user_id = ${ids[email]}`);
    expect((await ctx(email)).entityScope).toEqual([]);
    expect((await as(email, sql`select count(*)::int as n from invoices`)).rows[0].n).toBe(0);
    expect(await listMerchantPayments(await ctx(email))).toEqual([]);
    await setEntityScope(ownerDb(), { orgSlug: SLUG, email, entities: "all" });
    expect((await ctx(email)).entityScope).toBeNull();
    expect((await merchantShell(await ctx(email))).entities.map((e) => e.id)).toEqual([...ENTS]);
    await setEntityScope(ownerDb(), { orgSlug: SLUG, email, entities: [other] });
    expect((await ctx(email)).entityScope).toEqual([other]);
    // a re-grant without --entities keeps the limit
    await grantMembership(ownerDb(), { orgSlug: SLUG, email, role: "finance" });
    expect((await ctx(email)).entityScope).toEqual([other]);
    const audit = await rows(sql`select details from audit_events where org_id = ${seed.orgs.sg} and action = 'membership_entity_scope_set' and entity_id = ${ids[email]} order by seq`);
    expect(audit.map((a) => (a.details as { entities: unknown }).entities)).toEqual([[other], "all", [other]]);
    await expect(setEntityScope(ownerDb(), { orgSlug: SLUG, email, entities: ["ENT-NOPE"] })).rejects.toThrow(/not an entity/);
    await expect(setEntityScope(ownerDb(), { orgSlug: MERCHANT_SEED_ORGS.provider.slug, email: "admin@northwind-pay.example", entities: ["ENT-SG-01"] })).rejects.toThrow(/only a merchant/);
  });
});

describe("performance: the scope check is one InitPlan per statement", () => {
  it("for an unscoped member the per-row parent lookup is never executed", async () => {
    const plan = (await withTenant({ userId: seed.users["finance@straits-demo.example"], orgId: seed.orgs.sg }, (tx) =>
      tx.execute(sql`explain (analyze, costs off, timing off, summary off) select count(*) from match_records`))).rows.map((r) => String(r["QUERY PLAN"])).join("\n");
    expect(plan).toMatch(/InitPlan/);
    // the EXISTS on invoices (the scoped path) is a SubPlan that an unscoped member never runs
    expect(plan).toMatch(/SubPlan[\s\S]*never executed/);
  });
});
