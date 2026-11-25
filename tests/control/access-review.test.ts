/**
 * v1 phase 1.4: the access review against PostgreSQL 16 — who has access to what (role, entity scope, second factor
 * when recorded, granted, last sign-in, invited by), for a merchant Admin and a Provider Admin (own organisation
 * only), exportable as CSV and PDF, each export audited without names or emails. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeOwner, enrolTestTotp, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, type TenantContext } from "../../src/server/tenant";
import { acceptInvitation, createUser, grantMembership, revokeMembership } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { createInvitation } from "../../src/server/provider";
import { accessReview, accessReviewCsv, accessReviewExport } from "../../src/server/access-review";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
const extra: Record<string, string> = {};
let n = 0;
const key = () => `ar-key-${++n}-${Date.now()}`;
const ctx = (email: string, org: "sg" | "provider"): Promise<TenantContext> =>
  resolveTenant({ userId: extra[email] ?? seed.users[email], name: email, email }, MERCHANT_SEED_ORGS[org].slug);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function denied(p: Promise<unknown>, status: number) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AccessDenied); expect((e as AccessDenied).status).toBe(status); return; }
  throw new Error(`expected ${status}`);
}

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  extra["scoped@straits-demo.example"] = await createUser(ownerDb(), { email: "scoped@straits-demo.example", name: "Scoped Finance (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: MERCHANT_SEED_ORGS.sg.slug, email: "scoped@straits-demo.example", role: "finance", entities: ["ENT-SG-02"] });
  extra["gone@straits-demo.example"] = await createUser(ownerDb(), { email: "gone@straits-demo.example", name: "=Former Viewer (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: MERCHANT_SEED_ORGS.sg.slug, email: "gone@straits-demo.example", role: "viewer" });
  await revokeMembership(ownerDb(), { orgSlug: MERCHANT_SEED_ORGS.sg.slug, email: "gone@straits-demo.example" });
  // an invited member: the provider's Admin invites, an operator accepts
  const inv = await createInvitation(await ctx("admin@northwind-pay.example", "provider"), seed.orgs.sg, { email: "invited@straits-demo.example", role: "viewer" }, key());
  await acceptInvitation(ownerDb(), inv.body.id, { password: PASSWORD, name: "Invited Viewer (fictional)" });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("who may review access", () => {
  it("a merchant Admin and a Provider Admin; not Finance, an Approver, Provider Ops or an Admin limited to some entities", async () => {
    await expect(accessReview(await ctx("admin@straits-demo.example", "sg"))).resolves.toBeTruthy();
    await expect(accessReview(await ctx("admin@northwind-pay.example", "provider"))).resolves.toBeTruthy();
    await denied(accessReview(await ctx("finance@straits-demo.example", "sg")), 403);
    await denied(accessReview(await ctx("approver@straits-demo.example", "sg")), 403);
    await denied(accessReview(await ctx("ops@northwind-pay.example", "provider")), 403);
    await denied(accessReviewExport(await ctx("finance@straits-demo.example", "sg"), "csv"), 403);
    extra["admin-scoped@straits-demo.example"] = await createUser(ownerDb(), { email: "admin-scoped@straits-demo.example", name: "Scoped Admin (fictional)", password: PASSWORD });
    await grantMembership(ownerDb(), { orgSlug: MERCHANT_SEED_ORGS.sg.slug, email: "admin-scoped@straits-demo.example", role: "admin", entities: ["ENT-SG-01"] });
    await denied(accessReview(await ctx("admin-scoped@straits-demo.example", "sg")), 403);
  });
});

describe("what the review shows", () => {
  it("every membership with role, scope, status, invited by, and its second factor (off until enrolled)", async () => {
    const v = await accessReview(await ctx("admin@straits-demo.example", "sg"));
    expect(v.organisation.kind).toBe("merchant");
    const by = new Map(v.rows.map((r) => [r.email, r]));
    expect(by.get("finance@straits-demo.example")).toMatchObject({ role: "finance", roleLabel: "Finance", status: "active", entityScope: "all", mfa: "not_enabled", passkeys: 0, invitedBy: null });
    expect(by.get("scoped@straits-demo.example")).toMatchObject({ entityScope: ["ENT-SG-02"] });
    expect(by.get("gone@straits-demo.example")).toMatchObject({ status: "revoked" });
    expect(by.get("gone@straits-demo.example")!.revokedAt).not.toBeNull();
    expect(by.get("invited@straits-demo.example")).toMatchObject({ role: "viewer", invitedBy: "Ines Moreau (fictional)" });
    // the merchant's members only: no provider member
    expect(v.rows.some((r) => r.email.endsWith("@northwind-pay.example"))).toBe(false);
    expect(v.entities.map((e) => e.id)).toEqual(["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]);
  });

  it("a Provider Admin sees the provider's own members only", async () => {
    const v = await accessReview(await ctx("admin@northwind-pay.example", "provider"));
    expect(v.organisation.kind).toBe("provider");
    expect(v.rows.map((r) => r.email).sort()).toEqual(["admin@northwind-pay.example", "ops@northwind-pay.example"]);
    expect(v.entities).toEqual([]);
  });

  it("the last sign-in is stamped from the session row created at sign-in (trigger), and only moves forward", async () => {
    const u = seed.users["finance@straits-demo.example"];
    const at = new Date("2026-11-20T09:15:00.000Z");
    await ownerDb().execute(sql`insert into sessions (id, expires_at, token, created_at, updated_at, user_id) values (${randomUUID()}, ${new Date(at.getTime() + 3_600_000)}, ${randomUUID()}, ${at}, ${at}, ${u})`);
    const older = new Date("2026-11-01T00:00:00.000Z");
    await ownerDb().execute(sql`insert into sessions (id, expires_at, token, created_at, updated_at, user_id) values (${randomUUID()}, ${new Date(older.getTime() + 3_600_000)}, ${randomUUID()}, ${older}, ${older}, ${u})`);
    const r = (await accessReview(await ctx("admin@straits-demo.example", "sg"))).rows.find((x) => x.userId === u)!;
    expect(r.lastSignInAt).toBe(at.toISOString());
  });

  it("reads the second factor from login security's own columns (users.two_factor_enabled, passkeys)", async () => {
    const approver = seed.users["approver@straits-demo.example"];
    await enrolTestTotp(approver);
    await ownerDb().execute(sql`insert into passkeys (id, user_id, name, credential_id, public_key_spki, alg, sign_count)
      values (${randomUUID()}, ${approver}, 'Fictional key', ${"Fictional-credential-0001"}, ${"fictional-public-key"}, -7, 0)`);
    try {
      const v = await accessReview(await ctx("admin@straits-demo.example", "sg"));
      expect(v.rows.find((r) => r.email === "approver@straits-demo.example")).toMatchObject({ mfa: "enabled", passkeys: 1 });
      expect(v.rows.find((r) => r.email === "finance@straits-demo.example")).toMatchObject({ mfa: "not_enabled", passkeys: 0 });
    } finally {
      await ownerDb().execute(sql`delete from passkeys where user_id = ${approver}`);
      await ownerDb().execute(sql`delete from two_factors where user_id = ${approver}`);
      await ownerDb().execute(sql`update users set two_factor_enabled = false where id = ${approver}`);
    }
  });
});

describe("exports for an auditor", () => {
  it("CSV (formula cells escaped) and PDF; each export is audited with format, hash and count, never names or emails", async () => {
    const admin = await ctx("admin@straits-demo.example", "sg");
    const c = await accessReviewExport(admin, "csv");
    const text = c.body as string;
    expect(c.contentType).toMatch(/text\/csv/);
    expect(text).toContain("name,email,role,status,entity_scope,second_factor,passkeys,access_granted_at,access_revoked_at,last_sign_in_at,invited_by");
    expect(text).toContain("scoped@straits-demo.example,Finance,active,ENT-SG-02,Off,0,");
    expect(text).toContain("'=Former Viewer (fictional)"); // a spreadsheet never runs a name as a formula
    expect(text).toBe(accessReviewCsv({ ...(await accessReview(admin)), generatedAt: text.match(/generated_at,([^\r\n]+)/)![1] }));
    const p = await accessReviewExport(admin, "pdf");
    expect(Buffer.from(p.body as Uint8Array).subarray(0, 5).toString()).toBe("%PDF-");
    expect(p.fileName).toMatch(/^clearline-access-review-straits-demo-sg-\d{4}-\d{2}-\d{2}\.pdf$/);
    const audit = await rows(sql`select action, entity_type, entity_id, summary, details, actor_user_id from audit_events where org_id = ${seed.orgs.sg} and action = 'access_review_exported' order by seq`);
    expect(audit.map((a) => (a.details as { format: string }).format)).toEqual(["csv", "pdf"]);
    expect(audit.map((a) => (a.details as { sha256: string }).sha256)).toEqual([c.sha256, p.sha256]);
    for (const a of audit) {
      expect(a.actor_user_id).toBe(seed.users["admin@straits-demo.example"]);
      expect(JSON.stringify(a)).not.toMatch(/@|fictional\)/);
    }
  });
});
