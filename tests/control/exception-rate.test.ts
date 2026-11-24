/**
 * v1 phase 0 against PostgreSQL 16: "exceptions per 100" (src/lib/clearline/merchant/exception-rate.ts) reads the same
 * through the merchant's pilot metrics, the provider's merchant list and the provider's pilot metrics (the SECURITY
 * DEFINER aggregate of migration 0035), and equals the pure function over the stored rows; the provider's total is the
 * added counts. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { pilotMetrics, runReconciliation } from "../../src/server/merchant";
import { providerMerchants, providerPilotMetrics } from "../../src/server/provider";
import { exceptionRate, exceptionRateCounts } from "../../src/lib/clearline/merchant/exception-rate";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `er-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD, case3: "after_part_1" });
  await runReconciliation(await ctx("ops@dunehaven-demo.example", "ae"), "ENT-AE-03", key());
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(await ctx("ops@straits-demo.example", "sg"), e, key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("exceptions per 100: one definition, the same through the merchant and the provider", () => {
  it("still-open exceptions per 100 reconciled payments (unpaid excluded), batch not tied apart, equal on both sides", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const mine = await pilotMetrics(fin);
    const recs = await rows(sql`select order_id, rule_id, ledger->>'creditedMinor' as c from match_records where org_id = ${seed.orgs.sg}`);
    const exs = await rows(sql`select order_id, status from recon_exceptions where org_id = ${seed.orgs.sg}`);
    const want = exceptionRate(exceptionRateCounts(recs.map((r) => ({ orderId: String(r.order_id), ruleId: String(r.rule_id), creditedMinor: String(r.c) })),
      exs.map((e) => ({ orderId: e.order_id === null ? null : String(e.order_id), status: String(e.status) }))));
    expect(mine.exceptionRate).toEqual(want);
    expect(mine.exceptionsPer100).toBe(want.per100);
    expect(want.reconciledPayments).toBeGreaterThan(0);
    const prov = await ctx("admin@northwind-pay.example", "provider");
    const health = (await providerMerchants(prov)).merchants.find((x) => x.merchantOrgId === seed.orgs.sg)!;
    expect(health.exceptionRate).toEqual(want);
    const pilot = await providerPilotMetrics(prov);
    expect(pilot.merchants.find((x) => x.merchantOrgId === seed.orgs.sg)!.exceptionRate).toEqual(want);
    const all = pilot.merchants.map((x) => x.exceptionRate);
    const sum = (k: "reconciledPayments" | "openExceptions") => all.reduce((a, x) => a + x[k], 0);
    expect(pilot.total).toMatchObject({ exceptionRate: { reconciledPayments: sum("reconciledPayments"), openExceptions: sum("openExceptions") } });
  });
});

describe("the provider's rate function stays aggregate-only", () => {
  it("refuses a merchant member and another provider's id: no counts", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const r = await withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.execute(sql`select * from provider_exception_rate(${seed.orgs.provider})`));
    expect(r.rows).toEqual([]);
    const prov = await ctx("admin@northwind-pay.example", "provider");
    const r2 = await withTenant({ userId: prov.userId, orgId: prov.orgId }, (tx) => tx.execute(sql`select * from provider_exception_rate(${seed.orgs.sg})`));
    expect(r2.rows).toEqual([]);
  });
});
