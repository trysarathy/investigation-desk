/**
 * v1 phase 2.3, end to end through the route handlers (as Next calls them) with the LOCAL Xero stand-in and a real
 * PostgreSQL: sign in → connect (Admin) → the ledger's sign-in page → callback (state + browser cookie, no session
 * cookie, as after a cross-site redirect) → choose the organisation → read invoices (Finance) → draft journal REFUSED
 * while the posting rules are unsigned → a test signature → map accounts → draft journal written as a DRAFT → the same
 * request again writes nothing more → revoke at the ledger → Reconnect shown → reconnect. Fictional data only; no
 * network beyond loopback.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { currentPostingRulesVersion, signPostingRules } from "./posting-rules-sign";
import { closeOwner, enrolTestTotp, ownerDb, PASSWORD, resetAndSeed, signInWithMfa } from "./harness";
import { seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { POST as connectPOST } from "../../src/app/api/control/merchant/ledger/connect/route";
import { GET as callbackGET } from "../../src/app/api/control/merchant/ledger/callback/route";
import { GET as connectionsGET } from "../../src/app/api/control/merchant/ledger/connections/route";
import { POST as tenantPOST } from "../../src/app/api/control/merchant/ledger/tenant/route";
import { POST as readPOST } from "../../src/app/api/control/merchant/ledger/read/route";
import { POST as accountsPOST } from "../../src/app/api/control/merchant/ledger/accounts/route";
import { POST as draftPOST } from "../../src/app/api/control/merchant/ledger/journal-draft/route";
import { POST as disconnectPOST } from "../../src/app/api/control/merchant/ledger/disconnect/route";
import { startXeroStandin, type Standin } from "../../scripts/ledger/standin-server";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
let s: LiveSeed;
let xero: Standin;
const saved: Record<string, string | undefined> = {};
const cookie: Record<string, string> = {};
let k = 0, ip = 60;
const key = () => `ledger-e2e-${++k}-${Date.now()}`;

async function signIn(email: string) {
  // wave 2 (w1-14, w1-28): password, then the fictional test authenticator when the account has MFA (an Admin must)
  return signInWithMfa(email, PASSWORD, `198.51.100.${ip++}`);
}
const post = (path: string, who: string, body: unknown, headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/control/merchant/ledger/${path}`, {
  method: "POST", headers: { cookie: `${cookie[who]}; clearline_org=${s.slugs.a}`, origin: ORIGIN, "idempotency-key": key(), "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const get = (path: string, who: string) => new Request(`${ORIGIN}/api/control/merchant/ledger/${path}`, { headers: { cookie: `${cookie[who]}; clearline_org=${s.slugs.a}` } });
const body = async (r: Response) => (await r.json()) as Record<string, unknown> & { error?: { code: string; message: string } };

/** Admin presses Connect / Reconnect; the browser follows the stand-in's consent and comes back WITHOUT the session cookie. */
async function connectThroughBrowser() {
  const r = await connectPOST(post("connect", "admin", { provider: "xero" }));
  expect(r.status).toBe(200);
  const { authorizeUrl } = await body(r);
  const binding = r.headers.getSetCookie().find((c) => c.startsWith("clearline_ledger_oauth="))!;
  expect(binding).toMatch(/HttpOnly/i);
  expect(binding).toMatch(/SameSite=Lax/i);
  expect(binding).toMatch(/Path=\/api\/control\/merchant\/ledger\/callback/);
  const consent = await fetch(String(authorizeUrl), { redirect: "manual" });
  const back = new URL(consent.headers.get("location")!);
  const cb = await callbackGET(new Request(back.toString(), { headers: { cookie: binding.split(";")[0] } }));
  const html = await cb.text();
  expect(html).not.toContain(back.searchParams.get("code")!);
  return { status: cb.status, html, back };
}

beforeAll(async () => {
  useTestStorage();
  for (const v of ["CLEARLINE_LEDGER_ENV", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "CLEARLINE_XERO_STANDIN_URL", "CLEARLINE_LEDGER_TOKEN_KEY"]) saved[v] = process.env[v];
  xero = await startXeroStandin({ port: 4163, clientId: "standin-xero-e2e", clientSecret: "standin-xero-e2e-secret-fictional" });
  Object.assign(process.env, { CLEARLINE_LEDGER_ENV: "standin", XERO_CLIENT_ID: "standin-xero-e2e", XERO_CLIENT_SECRET: "standin-xero-e2e-secret-fictional", CLEARLINE_XERO_STANDIN_URL: xero.url, CLEARLINE_LEDGER_TOKEN_KEY: randomBytes(32).toString("base64") });
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-le2e");
  await enrolTestTotp(s.users["admin@live-a.example"]); // v1 1.2: an Admin cannot use Control without MFA
  for (const [who, email] of [["admin", "admin-le2e@live-a.example"], ["finance", "finance-le2e@live-a.example"], ["viewer", "viewer-le2e@live-a.example"]]) cookie[who] = await signIn(email);
  await ownerDb().insert(t.merchantJournalProposals).values({ orgId: s.orgs.a, id: "JP-E2E-0001", entityId: "ENT-LIVE-SG", pattern: "provider_confirmation", currency: "SGD",
    lines: [{ side: "debit", account: "provider_clearing", amountMinor: "135000" }, { side: "credit", account: "accounts_receivable", amountMinor: "135000" }], evidenceRefs: { entryDate: "2026-11-05", memo: "fictional" } });
});
afterAll(async () => {
  await xero?.close();
  for (const [v, x] of Object.entries(saved)) { if (x === undefined) delete process.env[v]; else process.env[v] = x; }
  await closeDatabase(); await closeOwner();
});

describe("ledger connection, end to end with the Xero stand-in", () => {
  let connectionId = "";

  it("connect → choose the organisation", async () => {
    expect((await connectPOST(post("connect", "finance", { provider: "xero" }))).status).toBe(403);
    expect((await connectPOST(post("connect", "admin", { provider: "xero" }, { origin: "https://evil.example" }))).status).toBe(403);
    const c = await connectThroughBrowser();
    expect(c.status).toBe(200);
    expect(c.html).toContain("Choose the organisation");
    // the same callback again (a replay) is refused
    const replay = await callbackGET(new Request(c.back.toString(), { headers: { cookie: "clearline_ledger_oauth=anything" } }));
    expect(replay.status).toBe(400);
    const list = await body(await connectionsGET(get("connections", "viewer")));
    const conn = (list.connections as { id: string; status: string; tenantChoices: { tenantId: string; tenantName: string }[] }[])[0];
    expect(conn.status).toBe("choose_tenant");
    connectionId = conn.id;
    const chosen = await tenantPOST(post("tenant", "admin", { connectionId, tenantId: conn.tenantChoices[0].tenantId }));
    expect(chosen.status).toBe(200);
    expect(((await body(await connectionsGET(get("connections", "viewer")))).connections as { status: string; tenantName: string }[])[0])
      .toMatchObject({ status: "active", tenantName: "Harbour Lantern Trading (fictional demo company)", baseCurrency: "SGD" });
  });

  it("read invoices (Finance) into an upload that waits for confirmation", async () => {
    expect((await readPOST(post("read", "viewer", { connectionId, entityId: "ENT-LIVE-SG" }))).status).toBe(403);
    const r = await readPOST(post("read", "finance", { connectionId, entityId: "ENT-LIVE-SG" }));
    expect(r.status).toBe(201);
    expect(await body(r)).toMatchObject({ invoices: 5, issuedInvoices: 4, payments: 1, upload: { status: "validated", fileType: "orders_invoices" } });
  });

  it("draft journal refused while unsigned → allowed after a test signature → written once", async () => {
    const unsigned = await draftPOST(post("journal-draft", "finance", { connectionId, proposalId: "JP-E2E-0001" }));
    expect(unsigned.status).toBe(409);
    expect((await body(unsigned)).error?.code).toBe("POSTING_RULES_UNSIGNED");
    expect(xero.journals).toHaveLength(0);
    // wave 2: a signature of the current posting-rules version in d2's table (drizzle/0077), recorded as the owner
    await signPostingRules(s.orgs.a, String((await ownerDb().execute(sql`select id from users where email = 'admin-le2e@live-a.example'`)).rows[0].id));
    const unmapped = await draftPOST(post("journal-draft", "finance", { connectionId, proposalId: "JP-E2E-0001" }));
    expect((await body(unmapped)).error?.code).toBe("ACCOUNT_UNMAPPED");
    expect((await accountsPOST(post("accounts", "finance", { connectionId, accounts: { provider_clearing: "090", accounts_receivable: "610" } }))).status).toBe(200);
    expect((await draftPOST(post("journal-draft", "admin", { connectionId, proposalId: "JP-E2E-0001" }))).status).toBe(403);
    const drafted = await draftPOST(post("journal-draft", "finance", { connectionId, proposalId: "JP-E2E-0001" }));
    expect(drafted.status).toBe(201);
    const d = await body(drafted);
    expect(d).toMatchObject({ status: "drafted", replayed: false, externalId: xero.journals[0].id });
    expect(xero.journals).toEqual([expect.objectContaining({ status: "DRAFT", lines: 2 })]);
    const again = await draftPOST(post("journal-draft", "finance", { connectionId, proposalId: "JP-E2E-0001" }));
    expect(again.status).toBe(200);
    expect(await body(again)).toMatchObject({ replayed: true, externalId: d.externalId });
    expect(xero.journals).toHaveLength(1);
    const list = await body(await connectionsGET(get("connections", "viewer")));
    expect(list.drafts).toEqual([expect.objectContaining({ proposalId: "JP-E2E-0001", status: "drafted", postingRulesVersion: currentPostingRulesVersion() })]);
  });

  it("revoked at the ledger → Reconnect needed → reconnect → disconnect", async () => {
    xero.revokeAll();
    const r = await readPOST(post("read", "finance", { connectionId, entityId: "ENT-LIVE-SG" }));
    expect(r.status).toBe(409);
    expect((await body(r)).error?.code).toBe("LEDGER_RECONNECT");
    expect(((await body(await connectionsGET(get("connections", "viewer")))).connections as { status: string }[])[0].status).toBe("needs_reconnect");
    const again = await connectThroughBrowser();
    expect(again.html).toContain("Ledger connected");
    expect(((await body(await connectionsGET(get("connections", "viewer")))).connections as { id: string; status: string }[])[0]).toMatchObject({ id: connectionId, status: "active" });
    const off = await disconnectPOST(post("disconnect", "admin", { connectionId }));
    expect(await body(off)).toMatchObject({ status: "disconnected", revoked: true });
    expect(xero.calls.filter((c) => c.method !== "GET" && c.path !== "/ManualJournals")).toEqual([]);
  });
});
