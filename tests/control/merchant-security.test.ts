/**
 * rc6 phase 6 database security against PostgreSQL 16: provider/merchant isolation through the services, aggregates
 * only for a provider without a grant, two-person write-offs (self-approval and stale versions refused by the service
 * AND the database), and Admin-only matching policy. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { grantMembership } from "../../src/server/admin";
import { can } from "../../src/server/authz";
import { MERCHANT_SEED_ORGS, adapterParts, finalisedFrom, seedMerchantCases } from "../../src/server/merchant-seed";
import {
  decideWriteoff, ingestAdapterOutput, listMerchantPayments, merchantPaymentDetail, proposeWriteoff, providerConsole, runReconciliation, updateMerchantPolicy,
} from "../../src/server/merchant";
import { case3 } from "../../src/lib/clearline/merchant/fixtures/case3";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `ms-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
/** Drizzle wraps the PostgreSQL error: match the database's own message (the cause). */
async function dbRefuses(p: Promise<unknown>, re: RegExp, what?: string) {
  try { await p; } catch (e) {
    const err = e as Error & { cause?: Error };
    expect(`${err.message} ${err.cause?.message ?? ""}`, what).toMatch(re);
    return;
  }
  throw new Error(`expected the database to refuse ${re}${what ? ` (${what})` : ""}`);
}
const woId = async (orgId: string, orderId: string) => String((await rows(sql`select id from writeoff_proposals where org_id = ${orgId} and order_id = ${orderId} and status <> 'superseded'`))[0].id);

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  const ops = await ctx("ops@straits-demo.example", "sg");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(ops, e, key());
  await runReconciliation(await ctx("ops@dunehaven-demo.example", "ae"), "ENT-AE-03", key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("provider / merchant isolation", () => {
  it("a merchant user sees only their merchant, through the services and with another merchant forced into the context", async () => {
    const sg = await ctx("finance@straits-demo.example", "sg");
    expect((await listMerchantPayments(sg)).every((p) => !p.orderId.startsWith("BK-251"))).toBe(true);
    await refused(merchantPaymentDetail(sg, "BK-25102"), "ACCESS_404");
    await refused(resolveTenant({ userId: seed.users["finance@straits-demo.example"], name: "x", email: "x" }, SLUG.ae), "ACCESS_404");
    for (const table of ["match_records", "differences", "writeoff_proposals", "merchant_journal_proposals", "chain_transfers", "bank_lines", "address_facts"]) {
      const forced = await as(seed.users["finance@straits-demo.example"], seed.orgs.ae, sql.raw(`select count(*)::int as n from ${table}`));
      expect(forced.rows[0].n, table).toBe(0);
    }
  });
  it("a merchant user cannot write rows into another merchant", async () => {
    await dbRefuses(as(seed.users["ops@straits-demo.example"], seed.orgs.sg, sql`insert into address_facts (org_id, network, address, fact) values (${seed.orgs.ae}, 'tron', 'T_FICTIONAL_X', 'unknown')`), /row-level security/);
  });
});

describe("a provider sees aggregates only without a grant", () => {
  it("the console shows aggregates of its own merchants; no merchant rows; merchant services refuse provider roles", async () => {
    const p = await ctx("admin@northwind-pay.example", "provider");
    const c = await providerConsole(p);
    expect(c.label).toBe("Test mode · illustrative data");
    expect(c.theme).toMatchObject({ name: "Northwind Pay (fictional)" });
    expect(c.merchants.map((m) => [m.merchant_name, m.payments, m.grant_scope])).toEqual([["Dunehaven Demo Trading (fictional)", 1, "aggregates"], ["Straits Demo Group (fictional)", 46, "aggregates"]]);
    expect(Object.keys(c.merchants[0]).sort()).toEqual(["auto_matched", "exceptions_open", "grant_scope", "last_ingestion_at", "merchant_name", "merchant_org_id", "oldest_open_exception_at", "payments"]);
    for (const table of ["match_records", "invoices", "differences", "recon_exceptions", "bank_lines", "address_facts"]) {
      expect((await as(p.userId, p.orgId, sql.raw(`select count(*)::int as n from ${table}`))).rows[0].n, table).toBe(0);
    }
    await refused(listMerchantPayments(p), "ACCESS_403");
    await refused(runReconciliation(p, "ENT-SG-01", key()), "ACCESS_403");
    await refused(providerConsole(await ctx("finance@straits-demo.example", "sg")), "ACCESS_403");
  });
  it("a merchant's full grant opens read-only rows of that merchant; revoking closes them", async () => {
    const p = await ctx("ops@northwind-pay.example", "provider");
    await as(seed.users["admin@straits-demo.example"], seed.orgs.sg, sql`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values (${seed.orgs.sg}, ${seed.orgs.provider}, 'full', ${seed.users["admin@straits-demo.example"]})`);
    const seen = (await as(p.userId, p.orgId, sql`select distinct org_id from match_records`)).rows.map((r) => r.org_id);
    expect(seen).toEqual([seed.orgs.sg]);
    expect((await as(p.userId, p.orgId, sql`update match_records set decision = 'matched'`)).rowCount).toBe(0);
    expect((await providerConsole(p)).merchants.find((m) => m.merchant_org_id === seed.orgs.sg)!.grant_scope).toBe("full");
    await as(seed.users["admin@straits-demo.example"], seed.orgs.sg, sql`update provider_grants set revoked_at = now() where merchant_org_id = ${seed.orgs.sg}`);
    expect((await as(p.userId, p.orgId, sql`select count(*)::int as n from match_records`)).rows[0].n).toBe(0);
  });
});

describe("write-offs: two people, enforced by the service and by the database", () => {
  it("the preparer can never approve: refused by the service, and by the database for a direct decision", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const id = await woId(seed.orgs.sg, "BK-24817");
    const req = (await proposeWriteoff(fin, id, key())).body;
    expect(req).toMatchObject({ version: 1, payload: { amountMinor: "135", currency: "SGD", label: "Test mode · illustrative data" } });
    await refused(decideWriteoff(fin, req.requestId, { decision: "approve", reason: "self approval attempt", payloadSha256: req.payloadSha256 }, key()), "ACCESS_403");
    // even with approver rights, the person who submitted it cannot decide it
    await grantMembership(ownerDb(), { orgSlug: SLUG.sg, email: "finance@straits-demo.example", role: "approver" });
    const promoted = await ctx("finance@straits-demo.example", "sg");
    await refused(decideWriteoff(promoted, req.requestId, { decision: "approve", reason: "self approval attempt", payloadSha256: req.payloadSha256 }, key()), "MAKER_CANNOT_APPROVE");
    await dbRefuses(as(promoted.userId, promoted.orgId, sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${promoted.orgId}, ${req.requestId}, ${promoted.userId}, 'approve', 'direct', ${req.payloadSha256})`), /maker-checker/);
    await grantMembership(ownerDb(), { orgSlug: SLUG.sg, email: "finance@straits-demo.example", role: "finance" });
    // nobody can mark it approved directly while the request is pending
    await dbRefuses(as(seed.users["approver@straits-demo.example"], seed.orgs.sg, sql`update writeoff_proposals set status = 'approved' where id = ${id}`), /two-person/);
    const ok = await decideWriteoff(await ctx("approver@straits-demo.example", "sg"), req.requestId, { decision: "approve", reason: "Sender-side fee confirmed (fictional)", payloadSha256: req.payloadSha256 }, key());
    expect(ok.body).toMatchObject({ status: "approved", writeoffId: id });
    expect(await rows(sql`select status, prepared_by from writeoff_proposals where org_id = ${seed.orgs.sg} and id = ${id}`)).toEqual([{ status: "approved", prepared_by: fin.userId }]);
    const d = await rows(sql`select decided_by from approval_decisions where org_id = ${seed.orgs.sg} and request_id = ${req.requestId}`);
    expect(d).toEqual([{ decided_by: seed.users["approver@straits-demo.example"] }]);
    // a decided write-off never changes again
    await dbRefuses(ownerDb().execute(sql`update writeoff_proposals set status = 'proposed' where org_id = ${seed.orgs.sg} and id = ${id}`), /never changes/);
  });

  it("an approved request for one write-off cannot approve another", async () => {
    const approved = String((await rows(sql`select id from approval_requests where org_id = ${seed.orgs.sg} and subject_kind = 'merchant_writeoff' and status = 'approved'`))[0].id);
    const u = seed.users["finance@straits-demo.example"];
    await as(u, seed.orgs.sg, sql`insert into writeoff_proposals (org_id, id, order_id, amount_minor, currency, difference_ids) values (${seed.orgs.sg}, 'WO-FICT-OTHER', 'BK-24823', 32400, 'SGD', '[]')`);
    await dbRefuses(as(u, seed.orgs.sg, sql`update writeoff_proposals set status = 'approved', approval_request_id = ${approved} where id = 'WO-FICT-OTHER'`), /two-person request for it/);
  });

  it("approving a stale version is refused: a superseded request, a different hash, or a payment reconciled again", async () => {
    const fin = await ctx("finance@dunehaven-demo.example", "ae");
    const appr = await ctx("approver@dunehaven-demo.example", "ae");
    const id = await woId(seed.orgs.ae, "BK-25102");
    const v1 = (await proposeWriteoff(fin, id, key())).body;
    const v2 = (await proposeWriteoff(fin, id, key())).body;
    expect(v2.version).toBe(2);
    await refused(decideWriteoff(appr, v1.requestId, { decision: "approve", reason: "reviewed v1", payloadSha256: v1.payloadSha256 }, key()), "REQUEST_CLOSED");
    await refused(decideWriteoff(appr, v2.requestId, { decision: "approve", reason: "reviewed a different hash", payloadSha256: "0".repeat(64) }, key()), "VERSION_MISMATCH");
    await dbRefuses(as(appr.userId, appr.orgId, sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${appr.orgId}, ${v2.requestId}, ${appr.userId}, 'approve', 'direct', ${"0".repeat(64)})`), /different version/);
    // new evidence arrives (a fictional extra rate observation) and the payment is reconciled again: v2 is stale
    const { parts, finalised } = await adapterParts(case3());
    const ops = await ctx("ops@dunehaven-demo.example", "ae");
    await ingestAdapterOutput(ops, "ENT-AE-03", { fxRates: [{ ...parts.fxRates![0], timestamp: "2026-12-03T09:00:00.000Z" }] }, key(), { finalised: finalisedFrom(finalised) });
    expect((await runReconciliation(ops, "ENT-AE-03", key())).body).toMatchObject({ changed: true });
    await refused(decideWriteoff(appr, v2.requestId, { decision: "approve", reason: "reviewed v2", payloadSha256: v2.payloadSha256 }, key()), "STALE_WRITEOFF");
    expect((await rows(sql`select status from writeoff_proposals where org_id = ${seed.orgs.ae} and id = ${id}`))[0].status).toBe("awaiting_approval");
  });
});

describe("rows that would make auto-matching more permissive are refused", () => {
  it("policy edits are Admin-only in the matrix (manage_policy) and in the service", async () => {
    for (const r of ["finance", "payment_ops", "approver", "viewer", "provider_admin", "provider_ops"] as const) expect(can(r, "manage_policy"), r).toBe(false);
    expect(can("admin", "manage_policy")).toBe(true);
    await refused(updateMerchantPolicy(await ctx("finance@straits-demo.example", "sg"), "ENT-SG-01", { toleranceAbsMinor: 100_000 }, 1, key()), "ACCESS_403");
    await refused(updateMerchantPolicy(await ctx("approver@straits-demo.example", "sg"), "ENT-SG-01", { allowImportedBankLinesAsVerified: true }, 1, key()), "ACCESS_403");
  });
  it("the database refuses a policy change or a new policy by a non-Admin, and a stale revision", async () => {
    const o = seed.orgs.sg;
    for (const who of ["finance@straits-demo.example", "ops@straits-demo.example", "approver@straits-demo.example"]) {
      await dbRefuses(as(seed.users[who], o, sql`update merchant_policy set tolerance_abs_minor = 100000, revision = revision + 1 where entity_id = 'ENT-SG-01'`), /only by an Admin/, who);
      await dbRefuses(as(seed.users[who], o, sql`update merchant_policy set allow_imported_bank_lines_as_verified = true, revision = revision + 1 where entity_id = 'ENT-SG-02'`), /only by an Admin/, who);
    }
    await ownerDb().execute(sql`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values (${o}, 'ENT-SG-NEW', 'New entity (fictional)', 'SGD', 'none', 'Asia/Singapore')`);
    // v1 (0038): the runtime login has no INSERT on merchant_policy at all; a policy is created only by add-entity (owner)
    await dbRefuses(as(seed.users["ops@straits-demo.example"], o, sql`insert into merchant_policy (org_id, entity_id, tolerance_bps, tolerance_abs_minor) values (${o}, 'ENT-SG-NEW', 1000, 1000000)`), /permission denied/);
    const admin = seed.users["admin@straits-demo.example"];
    await dbRefuses(as(admin, o, sql`update merchant_policy set tolerance_abs_minor = 600 where entity_id = 'ENT-SG-01'`), /one revision at a time/);
    const ctxA = await ctx("admin@straits-demo.example", "sg");
    expect((await updateMerchantPolicy(ctxA, "ENT-SG-01", { toleranceAbsMinor: 600 }, 1, key())).body).toMatchObject({ revision: 2 });
    await refused(updateMerchantPolicy(ctxA, "ENT-SG-01", { toleranceAbsMinor: 700 }, 1, key()), "STALE_POLICY");
    expect(await rows(sql`select tolerance_abs_minor::text as a, revision from merchant_policy where org_id = ${o} and entity_id = 'ENT-SG-01'`)).toEqual([{ a: "600", revision: 2 }]);
    const audit = await rows(sql`select actor_user_id from audit_events where org_id = ${o} and action = 'merchant_policy_updated'`);
    expect(audit).toEqual([{ actor_user_id: admin }]);
  });
  it("token and network configuration (what identifies a token, what is final) is read-only for the app", async () => {
    const u = seed.users["admin@straits-demo.example"];
    await dbRefuses(as(u, seed.orgs.sg, sql`insert into token_config (network, contract, symbol, decimals) values ('tron', 'T_FICTIONAL_LOOKALIKE', 'USDT', 6)`), /permission denied/);
    await dbRefuses(as(u, seed.orgs.sg, sql`update network_config set confirmations_required = 1 where network = 'tron'`), /permission denied/);
  });
  it("differences are append-only and a chain fact cannot change, even through a rerun path", async () => {
    const u = seed.users["ops@straits-demo.example"];
    await dbRefuses(as(u, seed.orgs.sg, sql`update differences set amount_minor = 0 where order_id = 'BK-24823'`), /permission denied|append-only|refuse/);
    await dbRefuses(as(u, seed.orgs.sg, sql`update chain_transfers set prior_hops = '[]' where tx_hash = 'fict_tron_tx_24817'`), /immutable/);
    await expect(as(u, seed.orgs.sg, sql`update chain_transfers set confirmations = 3, finalised = false where tx_hash = 'fict_tron_tx_24817'`)).resolves.toBeDefined();
  });
});
