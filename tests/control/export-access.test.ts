/**
 * rc8 founder decision 3 against PostgreSQL 16: every merchant export — the evidence pack (per payment and per month,
 * JSON/CSV/PDF), the rc6 journal file, the rc7 draft Xero/QuickBooks journal files and the month-end pack — is served
 * to exactly Finance, an Approver or an Admin. Payment Operations, a Viewer and provider users (with or without the
 * merchant's full grant) are refused, by the service and by the route handler (direct URL access, as Next calls it,
 * with a real session cookie). Each export's audit row holds ids, counts and hashes only; a refusal writes none.
 * Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed, signInWithMfa, enrolTestTotp } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { createUser, grantMembership } from "../../src/server/admin";
import { AccessDenied, resolveTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, MERCHANT_SEED_USERS, seedMerchantCases } from "../../src/server/merchant-seed";
import { runReconciliation } from "../../src/server/merchant";
import { setProviderGrant } from "../../src/server/provider";
import { evidencePack, journalExport } from "../../src/server/merchant-ui";
import { exportMonths, journalDraftFile, monthEndPack } from "../../src/server/exports";
import { POST as authPOST } from "../../src/app/api/auth/[...all]/route";
import { GET as evidenceGET } from "../../src/app/api/control/merchant/evidence/route";
import { GET as journalGET } from "../../src/app/api/control/merchant/journals/export/route";
import { GET as monthEndGET } from "../../src/app/api/control/merchant/exports/month-end/route";
import { GET as draftGET } from "../../src/app/api/control/merchant/exports/journal-draft/route";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const VIEWER = "viewer@straits-demo.example";
const ALLOWED = ["finance@straits-demo.example", "approver@straits-demo.example", "admin@straits-demo.example"] as const;
const MERCHANT_REFUSED = ["ops@straits-demo.example", VIEWER] as const;
const PROVIDER = ["admin@northwind-pay.example", "ops@northwind-pay.example"] as const;
const EXPORT_ACTIONS = ["merchant_evidence_pack_exported", "merchant_journal_file_exported", "merchant_journal_draft_exported", "merchant_month_end_pack_exported"];

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
const users: Record<string, string> = {};
const cookies: Record<string, string> = {};
let ip = 20;
let n = 0;
const key = () => `xa-key-${++n}-${Date.now()}`;
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const exportAudits = async () => rows(sql`select actor_user_id, action, entity_type, entity_id, summary, details from audit_events where action in (${sql.join(EXPORT_ACTIONS.map((a) => sql`${a}`), sql`, `)}) order by seq`);

/** Every export endpoint, as a browser would request it (direct URL access). */
const ENDPOINTS: { name: string; path: string; handler: (req: Request) => Promise<Response> }[] = [
  { name: "evidence pack, payment, JSON", path: "/api/control/merchant/evidence?order=BK-24817&format=json", handler: evidenceGET },
  { name: "evidence pack, payment, PDF", path: "/api/control/merchant/evidence?order=BK-24823&format=pdf", handler: evidenceGET },
  { name: "evidence pack, month, CSV", path: "/api/control/merchant/evidence?entity=ENT-SG-01&month=2026-11&format=csv", handler: evidenceGET },
  { name: "rc6 journal file, CSV", path: "/api/control/merchant/journals/export?entity=ENT-SG-01&month=2026-11&format=csv", handler: journalGET },
  { name: "rc6 journal file, JSON", path: "/api/control/merchant/journals/export?entity=ENT-SG-01&month=2026-11&format=json", handler: journalGET },
  { name: "month-end pack (ZIP)", path: "/api/control/merchant/exports/month-end?entity=ENT-SG-01&month=2026-11", handler: monthEndGET },
  { name: "draft Xero journal", path: "/api/control/merchant/exports/journal-draft?entity=ENT-SG-01&month=2026-11&tool=xero", handler: draftGET },
  { name: "draft QuickBooks journal", path: "/api/control/merchant/exports/journal-draft?entity=ENT-SG-01&month=2026-11&tool=quickbooks", handler: draftGET },
];

async function signIn(email: string) {
  // v1 1.2: password, then the authenticator code when the account has MFA (tests/control/harness.ts)
  return signInWithMfa(email, PASSWORD, `198.51.100.${ip++}`);
}
const call = (e: (typeof ENDPOINTS)[number], email: string, org: string) => e.handler(new Request(`${ORIGIN}${e.path}`, { headers: { cookie: `${cookies[email]}; clearline_org=${org}` } }));

async function denied(p: Promise<unknown>, status: number) {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(AccessDenied); expect((e as AccessDenied).status).toBe(status); return; }
  throw new Error(`expected ${status}`);
}
/** The five service calls behind the endpoints. */
const services = (c: TenantContext): Promise<unknown>[] => [
  evidencePack(c, { kind: "payment", orderId: "BK-24817" }, "json"), evidencePack(c, { kind: "month", entityId: "ENT-SG-01", month: "2026-11" }, "pdf"),
  journalExport(c, "ENT-SG-01", "2026-11", "csv"), journalDraftFile(c, "ENT-SG-01", "2026-11", "xero"), monthEndPack(c, "ENT-SG-01", "2026-11"), exportMonths(c, "ENT-SG-01"),
];

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  for (const u of MERCHANT_SEED_USERS) {
    users[u.email] = seed.users[u.email];
    if (u.role === "admin" || u.role === "approver") await enrolTestTotp(users[u.email]); // v1 1.2: MFA is required for them
  }
  users[VIEWER] = await createUser(ownerDb(), { email: VIEWER, name: "Viewer (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: SLUG.sg, email: VIEWER, role: "viewer" });
  const ops = await ctx("ops@straits-demo.example", "sg");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(ops, e, key());
  for (const e of [...ALLOWED, ...MERCHANT_REFUSED, ...PROVIDER]) cookies[e] = await signIn(e);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("services: exactly Finance, an Approver or an Admin", () => {
  it("Finance, an Approver and an Admin get every export", async () => {
    for (const email of ALLOWED) {
      const c = await ctx(email, "sg");
      expect((await evidencePack(c, { kind: "payment", orderId: "BK-24817" }, "json")).sha256, email).toMatch(/^[0-9a-f]{64}$/);
      expect((await evidencePack(c, { kind: "month", entityId: "ENT-SG-01", month: "2026-11" }, "pdf")).sha256, email).toMatch(/^[0-9a-f]{64}$/);
      expect((await journalExport(c, "ENT-SG-01", "2026-11", "csv")).count, email).toBeGreaterThan(0);
      expect((await journalDraftFile(c, "ENT-SG-01", "2026-11", "xero")).journals, email).toBeGreaterThan(0);
      expect((await monthEndPack(c, "ENT-SG-01", "2026-11")).manifest.month, email).toBe("2026-11");
      const months = await exportMonths(c, "ENT-SG-01");
      expect(months, email).toContain("2026-11");
    }
  });
  it("Payment Operations and a Viewer are refused every export (403), and no export is audited", async () => {
    const before = (await exportAudits()).length;
    for (const email of MERCHANT_REFUSED) {
      const c = await ctx(email, "sg");
      for (const p of services(c)) await denied(p, 403);
    }
    expect((await exportAudits()).length).toBe(before);
  });
  it("provider users are refused every export, without and with the merchant's full grant", async () => {
    for (const grant of ["none", "full"] as const) {
      if (grant === "full") await setProviderGrant(await ctx("admin@straits-demo.example", "sg"), { scope: "full" }, key());
      for (const email of PROVIDER) {
        for (const p of services(await ctx(email, "provider"))) await denied(p, 403);
        // and they cannot select the merchant: not a member (rc5: a foreign organisation is a 404)
        await denied(ctx(email, "sg"), 404);
      }
    }
    expect((await rows(sql`select scope from provider_grants where revoked_at is null`)).map((r) => r.scope)).toEqual(["full"]);
  });
});

describe("route handlers: direct URL access with a real session", () => {
  it("Finance, an Approver and an Admin get 200 on every export endpoint, audited with ids, counts and hashes only", async () => {
    const before = (await exportAudits()).length;
    for (const email of ALLOWED) for (const e of ENDPOINTS) {
      const res = await call(e, email, SLUG.sg);
      expect(res.status, `${email} ${e.name}`).toBe(200);
      expect(res.headers.get("content-disposition"), e.name).toMatch(/^attachment; filename="clearline-/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      await res.arrayBuffer();
    }
    const audits = (await exportAudits()).slice(before);
    expect(audits.length).toBe(ALLOWED.length * ENDPOINTS.length);
    expect(new Set(audits.map((a) => a.actor_user_id))).toEqual(new Set(ALLOWED.map((e) => users[e])));
    const names = MERCHANT_SEED_USERS.map((u) => u.name);
    for (const a of audits) {
      const text = `${a.summary} ${JSON.stringify(a.details)}`;
      // ids, counts and hashes: never a person's name or email, an amount line, a memo or a file body
      for (const s of [...names, ...ALLOWED, "@", "Lena", "596124", "Settlement of", "\"lines\":[", "chainProof", "%PDF"]) expect(text, `${a.action}: ${s}`).not.toContain(s);
      expect(String(a.summary)).toMatch(/sha256 [0-9a-f]{12}…/);
      const keys = Object.keys(a.details as object).sort();
      expect(keys.every((k) => ["sha256", "format", "scope", "month", "journalIds", "tool", "journals", "lines", "counts", "uploadIds", "ruleSetVersion", "policyRevision"].includes(k)), keys.join()).toBe(true);
    }
  });
  it("Payment Operations and a Viewer get 403 on every export endpoint; nothing is audited", async () => {
    const before = (await exportAudits()).length;
    for (const email of MERCHANT_REFUSED) for (const e of ENDPOINTS) {
      const res = await call(e, email, SLUG.sg);
      expect(res.status, `${email} ${e.name}`).toBe(403);
      expect(res.headers.get("content-disposition")).toBeNull();
      expect((await res.json()).error).toBeDefined();
    }
    expect((await exportAudits()).length).toBe(before);
  });
  it("provider users, with and without the merchant's full grant, get 403 in their own organisation and 404 for the merchant", async () => {
    const before = (await exportAudits()).length;
    for (const grant of ["full", "aggregates"] as const) {
      await setProviderGrant(await ctx("admin@straits-demo.example", "sg"), { scope: grant }, key());
      expect((await rows(sql`select scope from provider_grants where revoked_at is null`)).length).toBe(grant === "full" ? 1 : 0);
      for (const email of PROVIDER) for (const e of ENDPOINTS) {
        const own = await call(e, email, SLUG.provider);
        expect(own.status, `${email} ${e.name} (provider org, grant ${grant})`).toBe(403);
        const merchant = await call(e, email, SLUG.sg);
        expect(merchant.status, `${email} ${e.name} (merchant org, grant ${grant})`).toBe(404);
        for (const r of [own, merchant]) expect(r.headers.get("content-disposition")).toBeNull();
      }
    }
    expect((await exportAudits()).length).toBe(before);
  });
  it("signed out: 401 on every export endpoint", async () => {
    for (const e of ENDPOINTS) expect((await e.handler(new Request(`${ORIGIN}${e.path}`))).status, e.name).toBe(401);
  });
});
