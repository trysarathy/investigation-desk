/**
 * rc7 mapping templates against PostgreSQL 16: versioning (immutable rows), auto-apply by header signature, merchant
 * isolation, and a template of another provider refused by the database. Also the per-organisation data mode.
 * Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createOrganization, grantMembership, createUser } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { headerSignature, listMappingTemplates, organisationDataMode, saveMappingTemplate, suggestTemplate } from "../../src/server/mapping-templates";
import type { Mapping } from "../../src/lib/clearline/mapping";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let otherProvider: string;
let n = 0;
const key = () => `mt-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}

const HEADERS = ["Order", "Quote", "Amount", "Quoted", "Rate", "Contract", "Chain", "Address", "Created", "Expires"];
const MAPPING: Mapping = {
  fileType: "provider_export",
  columns: {
    order_id: { header: "Order" }, quote_id: { header: "Quote" }, invoice_amount: { header: "Amount" }, currency: { constant: "SGD" }, quoted_token_amount: { header: "Quoted" },
    quote_rate: { header: "Rate" }, rate_source: { constant: "provider quote" }, token_contract: { header: "Contract" }, network: { header: "Chain" }, deposit_address: { header: "Address" },
    created_at: { header: "Created", defaultUtcOffsetMinutes: 480 }, expires_at: { header: "Expires", defaultUtcOffsetMinutes: 480 },
  },
};
const BANK: Mapping = { fileType: "bank_statement", columns: { bank_account: { constant: "ACC-FICTIONAL-9" }, value_date: { header: "Date" }, currency: { constant: "SGD" }, amount: { header: "Amount" } } };

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  otherProvider = await createOrganization(ownerDb(), { slug: "other-provider-demo", name: "Other Provider (fictional)", seed: "empty" });
  await ownerDb().update(t.organizations).set({ kind: "provider" }).where(eq(t.organizations.id, otherProvider));
  seed.users["viewer@straits-demo.example"] = await createUser(ownerDb(), { email: "viewer@straits-demo.example", name: "Viewer (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: SLUG.sg, email: "viewer@straits-demo.example", role: "viewer" });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("mapping templates", () => {
  it("Finance saves versions; each version is a new immutable row; the latest is offered for the same headers", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const v1 = (await saveMappingTemplate(fin, { fileType: "provider_export", name: "Provider export", headers: HEADERS, mapping: MAPPING }, key())).body;
    expect(v1).toMatchObject({ version: 1, providerOrgId: seed.orgs.provider, headerSignature: headerSignature(HEADERS) });
    const v2 = (await saveMappingTemplate(await ctx("ops@straits-demo.example", "sg"), { fileType: "provider_export", name: "Provider export", headers: [...HEADERS].reverse(), mapping: { ...MAPPING, columns: { ...MAPPING.columns, currency: { constant: "USD" } } } }, key())).body;
    expect(v2.version).toBe(2);
    expect(v2.headerSignature).toBe(v1.headerSignature); // column order does not matter
    const s = await suggestTemplate(fin, { fileType: "provider_export", headers: HEADERS.map((h) => ` ${h.toUpperCase()} `) });
    expect(s.exact).toMatchObject({ id: v2.id, version: 2 });
    expect(s.suggestion.confirmed).toBe(false);
    const other = await suggestTemplate(fin, { fileType: "provider_export", headers: [...HEADERS, "Extra"] });
    expect(other.exact).toBeNull();
    expect(other.compatible.map((x) => x.id)).toEqual([v2.id]);
    expect((await listMappingTemplates(fin)).map((x) => x.version)).toEqual([2, 1]);
    await dbRefuses(as(fin.userId, fin.orgId, sql`update mapping_templates set name = 'x' where id = ${v1.id}`), /append-only|permission denied/);
    await dbRefuses(as(fin.userId, fin.orgId, sql`delete from mapping_templates where id = ${v1.id}`), /append-only|permission denied/);
    await dbRefuses(ownerDb().execute(sql`update mapping_templates set mapping = '{}' where id = ${v1.id}`), /append-only/);
    const b = (await saveMappingTemplate(fin, { fileType: "bank_statement", name: "Bank CSV", headers: ["Date", "Amount"], mapping: BANK }, key())).body;
    expect(b.providerOrgId).toBeNull();
    const audit = await ownerDb().execute(sql`select summary, details from audit_events where org_id = ${fin.orgId} and action = 'mapping_template_saved'`);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Order|Quote|ACC-FICTIONAL/);
  });
  it("only Finance and Payment Operations save templates; an invalid mapping is refused", async () => {
    for (const e of ["viewer@straits-demo.example", "approver@straits-demo.example", "admin@straits-demo.example"]) {
      await refused(saveMappingTemplate(await ctx(e, "sg"), { fileType: "bank_statement", name: "x", headers: ["Date", "Amount"], mapping: BANK }, key()), "ACCESS_403");
    }
    await refused(saveMappingTemplate(await ctx("finance@straits-demo.example", "sg"), { fileType: "bank_statement", name: "x", headers: ["Date"], mapping: BANK }, key()), "MAPPING_INVALID");
    const viewer = await ctx("viewer@straits-demo.example", "sg");
    await dbRefuses(as(viewer.userId, viewer.orgId, sql`insert into mapping_templates (org_id, file_type, name, version, header_signature, mapping, created_by) values (${viewer.orgId}, 'bank_statement', 'v', 1, ${"a".repeat(64)}, '{}', ${viewer.userId})`), /Finance or Payment Operations/);
  });
  it("SECURITY: a template of another provider is refused, by the database, whoever inserts it", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const ins = (provider: string, version = 1, by = fin.userId) => sql`insert into mapping_templates (org_id, provider_org_id, file_type, name, version, header_signature, mapping, created_by)
      values (${fin.orgId}, ${provider}, 'provider_export', 'Foreign', ${version}, ${"b".repeat(64)}, '{}', ${by})`;
    await dbRefuses(as(fin.userId, fin.orgId, ins(otherProvider)), /own provider only/);
    await dbRefuses(ownerDb().execute(ins(otherProvider)), /own provider only/);
    await dbRefuses(as(fin.userId, fin.orgId, sql`insert into mapping_templates (org_id, file_type, name, version, header_signature, mapping, created_by) values (${fin.orgId}, 'provider_export', 'NoProvider', 1, ${"b".repeat(64)}, '{}', ${fin.userId})`), /mapping_templates_provider_chk/);
    await dbRefuses(as(fin.userId, fin.orgId, ins(seed.orgs.provider, 3)), /one version at a time/);
    await dbRefuses(as(fin.userId, fin.orgId, ins(seed.orgs.provider, 1, seed.users["ops@straits-demo.example"])), /signed-in/);
    // a provider organisation cannot hold templates
    const p = await ctx("admin@northwind-pay.example", "provider");
    await dbRefuses(as(p.userId, p.orgId, sql`insert into mapping_templates (org_id, file_type, name, version, header_signature, mapping, created_by) values (${p.orgId}, 'bank_statement', 'P', 1, ${"b".repeat(64)}, '{}', ${p.userId})`), /belong to a merchant/);
  });
  it("a template stops being usable when the merchant's provider changes", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const [tpl] = (await listMappingTemplates(fin, "provider_export"));
    const usable = async () => (await as(fin.userId, fin.orgId, sql`select mapping_template_usable(${fin.orgId}, ${tpl.id}) as ok`)).rows[0].ok;
    expect(await usable()).toBe(true);
    await ownerDb().update(t.organizations).set({ providerOrgId: otherProvider }).where(eq(t.organizations.id, seed.orgs.sg));
    try {
      expect(await usable()).toBe(false);
      expect((await suggestTemplate(fin, { fileType: "provider_export", headers: HEADERS })).exact).toBeNull();
    } finally {
      await ownerDb().update(t.organizations).set({ providerOrgId: seed.orgs.provider }).where(eq(t.organizations.id, seed.orgs.sg));
    }
  });
  it("merchant isolation: another merchant and a provider without a full grant see no templates", async () => {
    const ae = await ctx("finance@dunehaven-demo.example", "ae");
    expect(await listMappingTemplates(ae)).toEqual([]);
    expect((await as(ae.userId, seed.orgs.sg, sql`select count(*)::int as n from mapping_templates`)).rows[0].n).toBe(0);
    const p = await ctx("ops@northwind-pay.example", "provider");
    expect((await as(p.userId, p.orgId, sql`select count(*)::int as n from mapping_templates`)).rows[0].n).toBe(0);
  });
});

describe("data mode", () => {
  it("seeded organisations are sample data with the demo label; a live organisation is labelled 'Your data'", async () => {
    expect(await organisationDataMode(await ctx("finance@straits-demo.example", "sg"))).toEqual({ dataMode: "sample", label: "Test mode · illustrative data" });
    const live = await createOrganization(ownerDb(), { slug: "live-merchant-demo", name: "Live Merchant (fictional)", seed: "empty", dataMode: "live" });
    const [row] = await ownerDb().select({ m: t.organizations.dataMode, f: t.organizations.fictional }).from(t.organizations).where(eq(t.organizations.id, live));
    expect(row).toEqual({ m: "live", f: false });
    await expect(createOrganization(ownerDb(), { slug: "live-sample-demo", name: "x", seed: "sample", dataMode: "live" })).rejects.toThrow(/starts empty/);
    // migration 0031 added 'demo' (demo builds); any other value is still refused
    await dbRefuses(ownerDb().execute(sql`update organizations set data_mode = 'preview' where id = ${live}`), /organizations_data_mode_chk/);
  });
});
