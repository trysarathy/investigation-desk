/**
 * rc6 phase 8 against PostgreSQL 16: the provider console. Aggregates only without a grant (the service AND RLS),
 * rows only under the merchant Admin's explicit full grant; onboarding (column mapping validated against the
 * adapter's schema, proposed policy defaults, invitation records) by the Provider Admin only and only for its own
 * merchants; the merchant's Admin alone sets the policy; pilot metrics. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { acceptInvitation } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { logMinutes, recordMatchReview, runReconciliation, updateMerchantPolicy } from "../../src/server/merchant";
import {
  createInvitation, merchantSettings, onboardingView, pilotSample, providerMerchantPayments, providerMerchants, providerPilotMetrics, saveColumnMapping,
  savePolicyDefaults, setProviderGrant,
} from "../../src/server/provider";
import { NORTHWIND_EXPORT_MAPPING } from "../../src/lib/clearline/merchant/adapters";

const LABEL = "Test mode · illustrative data";
let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let other: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `pc-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return; }
    if (e instanceof ZodError) { expect("INVALID_REQUEST").toMatch(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  other = await seedMerchantCases(ownerDb(), { password: PASSWORD, suffix: "-x" });
  const ops = await ctx("ops@straits-demo.example", "sg");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(ops, e, key());
  await runReconciliation(await ctx("ops@dunehaven-demo.example", "ae"), "ENT-AE-03", key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("screen 10: merchants with health, aggregates only", () => {
  it("lists only this provider's merchants, with health and no rows", async () => {
    const p = await providerMerchants(await ctx("ops@northwind-pay.example", "provider"));
    expect(p.label).toBe(LABEL);
    expect(p.merchants.map((m) => [m.name, m.grantScope])).toEqual([["Dunehaven Demo Trading (fictional)", "aggregates"], ["Straits Demo Group (fictional)", "aggregates"]]);
    const sg = p.merchants.find((m) => m.name.startsWith("Straits"))!;
    expect(sg).toMatchObject({ payments: 46, autoMatched: 42, autoMatchRatePct: 91.3, exceptionsOpen: 3, exceptionsPer100: 6.5 });
    expect(sg.oldestOpenExceptionAt).not.toBeNull();
    expect(sg.lastIngestionAt).not.toBeNull();
    expect(JSON.stringify(p)).not.toContain("BK-2");
    expect(p.merchants.some((m) => m.merchantOrgId === other.orgs.sg)).toBe(false);
  });
  it("rows only under the merchant Admin's full grant; revoking it takes them back; RLS agrees", async () => {
    const pv = await ctx("admin@northwind-pay.example", "provider");
    await refused(providerMerchantPayments(pv, seed.orgs.sg), "ACCESS_403");
    expect((await withTenant({ userId: pv.userId, orgId: pv.orgId }, (tx) => tx.execute(sql`select count(*)::int as n from match_records where org_id = ${seed.orgs.sg}`))).rows[0]).toEqual({ n: 0 });
    await refused(setProviderGrant(await ctx("finance@straits-demo.example", "sg"), { scope: "full" }, key()), "ACCESS_403");
    const admin = await ctx("admin@straits-demo.example", "sg");
    await setProviderGrant(admin, { scope: "full" }, key());
    expect((await merchantSettings(admin)).grantScope).toBe("full");
    const r = await providerMerchantPayments(pv, seed.orgs.sg);
    expect(r.payments).toHaveLength(46);
    expect((await providerMerchants(pv)).merchants.find((m) => m.merchantOrgId === seed.orgs.sg)!.grantScope).toBe("full");
    await refused(providerMerchantPayments(pv, seed.orgs.ae), "ACCESS_403");
    await refused(providerMerchantPayments(pv, other.orgs.sg), "ACCESS_404");
    await setProviderGrant(admin, { scope: "aggregates" }, key());
    await refused(providerMerchantPayments(pv, seed.orgs.sg), "ACCESS_403");
    expect((await withTenant({ userId: pv.userId, orgId: pv.orgId }, (tx) => tx.execute(sql`select count(*)::int as n from match_records where org_id = ${seed.orgs.sg}`))).rows[0]).toEqual({ n: 0 });
  });
  it("a merchant user is refused the provider console", async () => {
    await refused(providerMerchants(await ctx("admin@straits-demo.example", "sg")), "ACCESS_403");
    await refused(providerPilotMetrics(await ctx("finance@straits-demo.example", "sg")), "ACCESS_403");
  });
});

describe("screen 11: onboarding", () => {
  it("the column mapping is validated against the adapter's schema and saved by revision (Provider Admin only)", async () => {
    const admin = await ctx("admin@northwind-pay.example", "provider");
    await refused(saveColumnMapping(await ctx("ops@northwind-pay.example", "provider"), seed.orgs.sg, { mapping: NORTHWIND_EXPORT_MAPPING, expectedRevision: 0 }, key()), "ACCESS_403");
    await refused(saveColumnMapping(admin, seed.orgs.sg, { mapping: { provider: "X", columns: { "Order": "orderId" } }, expectedRevision: 0 }, key()), "INVALID_MAPPING");
    await refused(saveColumnMapping(admin, seed.orgs.sg, { mapping: { provider: "X", columns: { "A": "notAField" } }, expectedRevision: 0 }, key()), "INVALID_MAPPING");
    const r = await saveColumnMapping(admin, seed.orgs.sg, { mapping: NORTHWIND_EXPORT_MAPPING, expectedRevision: 0 }, key());
    expect(r.body).toMatchObject({ revision: 1, columns: Object.keys(NORTHWIND_EXPORT_MAPPING.columns).length });
    await refused(saveColumnMapping(admin, seed.orgs.sg, { mapping: NORTHWIND_EXPORT_MAPPING, expectedRevision: 0 }, key()), "STALE_ONBOARDING");
    await refused(saveColumnMapping(admin, other.orgs.sg, { mapping: NORTHWIND_EXPORT_MAPPING, expectedRevision: 0 }, key()), "ACCESS_404");
    // the database refuses a Provider Ops write and a merchant of another provider even when the service is bypassed
    const ops = await ctx("ops@northwind-pay.example", "provider");
    await dbRefuses(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`insert into merchant_onboarding (org_id, merchant_org_id, revision, updated_by) values (${ops.orgId}, ${seed.orgs.ae}, 1, ${ops.userId})`)), /only a Provider Admin/);
    await dbRefuses(withTenant({ userId: admin.userId, orgId: admin.orgId }, (tx) => tx.execute(sql`insert into merchant_onboarding (org_id, merchant_org_id, revision, updated_by) values (${admin.orgId}, ${other.orgs.sg}, 1, ${admin.userId})`)), /not a merchant of this provider/);
  });
  it("policy defaults are a proposal: the merchant sees it; only the merchant's Admin sets the policy", async () => {
    const admin = await ctx("admin@northwind-pay.example", "provider");
    const defaults = { toleranceBps: 50, toleranceAbsMinor: "500", writeoffThresholdMinor: "500", allowImportedBankLinesAsVerified: false };
    await savePolicyDefaults(admin, seed.orgs.sg, { defaults, expectedRevision: 1 }, key());
    expect((await onboardingView(admin)).merchants.find((m) => m.merchantOrgId === seed.orgs.sg)).toMatchObject({ revision: 2, policyDefaults: defaults });
    const s = await merchantSettings(await ctx("finance@straits-demo.example", "sg"));
    expect(s.proposal).toMatchObject({ providerName: "Northwind Pay (fictional)", policyDefaults: defaults, mappedColumns: 31, revision: 2 });
    expect((await merchantSettings(await ctx("finance@dunehaven-demo.example", "ae"))).proposal).toBeNull();
    await refused(updateMerchantPolicy(admin, "ENT-SG-01", { toleranceBps: 40 }, 1, key()), "ACCESS_403");
    await refused(updateMerchantPolicy(await ctx("finance@straits-demo.example", "sg"), "ENT-SG-01", { toleranceBps: 40 }, 1, key()), "ACCESS_403");
    const r = await updateMerchantPolicy(await ctx("admin@straits-demo.example", "sg"), "ENT-SG-01", { toleranceBps: 40 }, 1, key());
    expect(r.body).toMatchObject({ revision: 2 });
  });
  it("invitations are records only; an operator accepts one with the admin CLI function", async () => {
    const admin = await ctx("admin@northwind-pay.example", "provider");
    // a provider can never place someone with authority (Admin, Ops, Finance, Approver) in a merchant
    for (const role of ["admin", "approver", "finance", "payment_ops"]) {
      await refused(createInvitation(admin, seed.orgs.ae, { email: `${role}@dunehaven-demo.example`, role: role as never }, key()), "INVALID_REQUEST");
    }
    await expect(ownerDb().execute(sql`insert into merchant_invitations (org_id, merchant_org_id, email, role, invited_by) values (${(await ctx("admin@northwind-pay.example", "provider")).orgId}, ${seed.orgs.ae}, 'z@y.example', 'approver', ${admin.userId})`)).rejects.toThrow();
    const r = await createInvitation(admin, seed.orgs.ae, { email: "New.Finance@Dunehaven-Demo.example", role: "viewer" }, key());
    expect(r.body).toMatchObject({ email: "new.finance@dunehaven-demo.example", role: "viewer", command: expect.stringContaining(`accept-invitation ${r.body.id}`) });
    await refused(createInvitation(admin, seed.orgs.ae, { email: "new.finance@dunehaven-demo.example", role: "viewer" }, key()), "INVITATION_PENDING");
    await refused(createInvitation(admin, seed.orgs.ae, { email: "x@y.example", role: "provider_admin" as never }, key()), "INVALID_REQUEST");
    await refused(createInvitation(await ctx("ops@northwind-pay.example", "provider"), seed.orgs.ae, { email: "a@b.example", role: "viewer" }, key()), "ACCESS_403");
    const a = await acceptInvitation(ownerDb(), r.body.id, { password: PASSWORD, name: "New Finance (fictional)" });
    expect(a).toEqual({ email: "new.finance@dunehaven-demo.example", role: "viewer", orgSlug: SLUG.ae });
    await expect(acceptInvitation(ownerDb(), r.body.id, { password: PASSWORD })).rejects.toThrow(/accepted/);
    const m = await rows(sql`select m.role from organization_memberships m join users u on u.id = m.user_id where u.email = 'new.finance@dunehaven-demo.example' and m.org_id = ${seed.orgs.ae}`);
    expect(m).toEqual([{ role: "viewer" }]);
  });
});

describe("screen 12: pilot metrics", () => {
  it("reviewers mark sampled matches; minutes are logged once per key; the provider sees aggregates", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const s = await pilotSample(fin);
    expect(s.autoMatched).toBe(42);
    expect(s.sample.length).toBeLessThanOrEqual(20);
    expect(s.sample.every((x) => x.decision === "matched" || x.decision === "matched_with_difference")).toBe(true);
    const k = key();
    await recordMatchReview(fin, s.sample[0].orderId, { verdict: "correct" }, k);
    await recordMatchReview(fin, s.sample[0].orderId, { verdict: "correct" }, k);
    await recordMatchReview(await ctx("approver@straits-demo.example", "sg"), s.sample[1].orderId, { verdict: "wrong", note: "Should have been reviewed (fictional)." }, key());
    const mk = key();
    await logMinutes(fin, { day: "2026-11-25", minutes: 25 }, mk);
    await logMinutes(fin, { day: "2026-11-25", minutes: 25 }, mk);
    await refused(recordMatchReview(await ctx("admin@straits-demo.example", "sg"), s.sample[0].orderId, { verdict: "wrong" }, key()), "ACCESS_403");
    const p = await providerPilotMetrics(await ctx("ops@northwind-pay.example", "provider"));
    const sg = p.merchants.find((m) => m.name.startsWith("Straits"))!;
    expect(sg).toMatchObject({ payments: 46, autoMatchedPct: 91.3, reviewed: 2, reviewedWrong: 1, minutesLogged: 25, batches: 4, batchesTied: 4 });
    expect(sg.exceptionsPer100).toBe(6.5);
    expect(p.total.payments).toBe(47);
    expect(JSON.stringify(p)).not.toContain("BK-2");
  });
});
