/**
 * v1 phase 2.3: ledger connections against the LOCAL stand-in Xero and QuickBooks servers (scripts/ledger/standin-server.ts,
 * fictional organisations, loopback only) and a real PostgreSQL. Nothing calls a real ledger: the provider configuration
 * refuses any non-loopback stand-in URL and CLEARLINE_LEDGER_ENV is "standin" for this file only.
 *
 * Covers: OAuth with PKCE, state and nonce (single use, bound to member and browser, expiry), tenant selection, tokens
 * sealed at rest and never in any other row or log, refresh before expiry (one refresh under concurrency), revoked and
 * expired access → reconnect, rate limits, reading invoices into the orders/invoices pipeline, the posting-rules guard
 * (fail closed: no table, other organisation, revoked, wrong shape), idempotent DRAFT journals, QuickBooks never
 * written, roles, cross-organisation isolation and the database's own guards.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { currentPostingRulesVersion, OLDER_POSTING_RULES, revokePostingRules, signPostingRules } from "./posting-rules-sign";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { decideUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import {
  chooseLedgerTenant, completeLedgerConnect, disconnectLedger, draftJournalToLedger, ledgerSession, listLedgerConnections, postingRulesSigned,
  readLedgerIntoUpload, setLedgerAccountMap, startLedgerConnect, type LedgerDeps,
} from "../../src/server/ledger-connect";
import { open } from "../../src/lib/accounting/connect/seal";
import { LedgerRateLimiter } from "../../src/lib/accounting/connect/rate-limit";
import { startQboStandin, startXeroStandin, type Standin } from "../../scripts/ledger/standin-server";

let s: LiveSeed;
let admin: TenantContext, fin: TenantContext, ops: TenantContext, viewer: TenantContext, approver: TenantContext, finB: TenantContext, adminB: TenantContext;
let xero: Standin, qbo: Standin;
let xeroConn: string;
const P_FIRST = "JP-LC-0001";
const saved: Record<string, string | undefined> = {};
const captured: string[] = [];
let n = 0;
const key = () => `ledger-connect-${++n}-${Date.now()}`;
const limiter = () => new LedgerRateLimiter();

async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code, e.message).toBe(code); return e; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return e; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];

/** Follow the ledger's sign-in page (the stand-in consents at once) and return the callback's query. */
async function authorise(url: string): Promise<Record<string, string>> {
  const r = await fetch(url, { redirect: "manual" });
  expect(r.status).toBe(302);
  const back = new URL(r.headers.get("location")!);
  expect(back.origin + back.pathname).toBe(`${process.env.CLEARLINE_ORIGIN}/api/control/merchant/ledger/callback`);
  return Object.fromEntries(back.searchParams);
}
async function connect(ctx: TenantContext, provider: "xero" | "qbo", deps: LedgerDeps = {}) {
  const st = await startLedgerConnect(ctx, { provider }, deps);
  const q = await authorise(st.authorizeUrl);
  return { st, q, done: () => completeLedgerConnect(q as { state: string }, st.browserBinding, deps) };
}
async function mentions(needle: string): Promise<string[]> {
  const tables = (await rows(sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and not (select relispartition from pg_class where oid = format('public.%I', table_name)::regclass)`)).map((r) => String(r.t));
  const hit: string[] = [];
  for (const tb of tables) if (Number((await rows(sql`select count(*)::int as n from ${sql.identifier(tb)} x where x::text like ${`%${needle}%`}`))[0].n)) hit.push(tb);
  return hit;
}
const connRow = async (id: string) => (await ownerDb().select().from(t.ledgerConnections).where(eq(t.ledgerConnections.id, id)))[0];
const tokenOf = async (orgId: string, id: string) => { const r = await connRow(id); return open(r.accessTokenSealed!, { orgId, connectionId: id, field: "access_token" }); };


beforeAll(async () => {
  useTestStorage();
  for (const k of ["CLEARLINE_LEDGER_ENV", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "CLEARLINE_XERO_STANDIN_URL", "CLEARLINE_QBO_STANDIN_URL", "CLEARLINE_LEDGER_TOKEN_KEY", "CLEARLINE_ORIGIN"]) saved[k] = process.env[k];
  xero = await startXeroStandin({ port: 4161, clientId: "standin-xero-client" });
  qbo = await startQboStandin({ port: 4162, clientId: "standin-qbo-client", clientSecret: "standin-qbo-secret-fictional" });
  Object.assign(process.env, {
    CLEARLINE_LEDGER_ENV: "standin", XERO_CLIENT_ID: "standin-xero-client", QBO_CLIENT_ID: "standin-qbo-client", QBO_CLIENT_SECRET: "standin-qbo-secret-fictional",
    CLEARLINE_XERO_STANDIN_URL: xero.url, CLEARLINE_QBO_STANDIN_URL: qbo.url, CLEARLINE_LEDGER_TOKEN_KEY: randomBytes(32).toString("base64"),
    CLEARLINE_ORIGIN: process.env.CLEARLINE_ORIGIN ?? "http://127.0.0.1:4160",
  });
  delete process.env.XERO_CLIENT_SECRET;
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { captured.push(a.map(String).join(" ")); });
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-lc");
  admin = await liveCtx(s, "admin@live-a.example", "a");
  fin = await liveCtx(s, "finance@live-a.example", "a");
  ops = await liveCtx(s, "ops@live-a.example", "a");
  viewer = await liveCtx(s, "viewer@live-a.example", "a");
  approver = await liveCtx(s, "approver@live-a.example", "a");
  finB = await liveCtx(s, "finance@live-b.example", "b");
  adminB = { ...finB, role: "admin" }; // a fictional Admin of merchant B (role only: B's members never include A's)
});
afterAll(async () => {
  vi.restoreAllMocks();
  await xero?.close(); await qbo?.close();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await closeDatabase(); await closeOwner();
});

describe("connecting Xero (OAuth 2.0 with PKCE, state and nonce)", () => {
  it("only an Admin of a live organisation starts a connection; nothing works without the token key", async () => {
    for (const c of [fin, ops, viewer, approver]) await refused(startLedgerConnect(c, { provider: "xero" }), "ACCESS_403");
    const k = process.env.CLEARLINE_LEDGER_TOKEN_KEY;
    delete process.env.CLEARLINE_LEDGER_TOKEN_KEY;
    await refused(startLedgerConnect(admin, { provider: "xero" }), "LEDGER_NOT_CONFIGURED");
    process.env.CLEARLINE_LEDGER_TOKEN_KEY = k;
    await refused(startLedgerConnect(admin, { provider: "xero" }, { env: { ...process.env, CLEARLINE_LEDGER_ENV: "production" } }), "LEDGER_NOT_CONFIGURED");
  });

  it("sends PKCE (S256) and a nonce; the state is stored hashed, the verifier sealed", async () => {
    const st = await startLedgerConnect(admin, { provider: "xero" });
    const u = new URL(st.authorizeUrl);
    expect(u.origin).toBe(xero.url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = u.searchParams.get("state")!;
    expect(await mentions(state.split(".")[2])).toEqual([]);
    const [row] = await rows(sql`select state_hash, pkce_verifier_sealed from ledger_oauth_states where org_id = ${s.orgs.a} order by created_at desc limit 1`);
    expect(String(row.pkce_verifier_sealed)).toMatch(/^v1\./);
  });

  it("refuses a callback from another browser, a replayed state, an expired state and a forged state", async () => {
    const a = await connect(admin, "xero");
    await refused(completeLedgerConnect(a.q as { state: string }, "another-browser"), "LEDGER_STATE_INVALID");
    await refused(a.done(), "LEDGER_STATE_INVALID"); // consumed by the attempt above: single use
    const b = await connect(admin, "xero");
    await refused(completeLedgerConnect(b.q as { state: string }, b.st.browserBinding, { now: () => Date.now() + 11 * 60_000 }), "LEDGER_STATE_INVALID");
    const c = await connect(admin, "xero");
    const forged = c.q.state.replace(/\.[^.]+$/, `.${"A".repeat(43)}`);
    await refused(completeLedgerConnect({ ...c.q, state: forged }, c.st.browserBinding), "LEDGER_STATE_INVALID");
    // a member of merchant B cannot use A's state: the state selects A, and B's member is not A's member
    const d = await connect(admin, "xero");
    const asB = d.q.state.replace(/^[^.]+\.[^.]+/, `${s.orgs.a}.${Buffer.from(finB.userId).toString("base64url")}`);
    await refused(completeLedgerConnect({ ...d.q, state: asB }, d.st.browserBinding), "LEDGER_STATE_INVALID");
    expect(await listLedgerConnections(admin)).toEqual([]);
    xero.declineNext();
    const e = await connect(admin, "xero");
    expect(e.q.error).toBe("access_denied");
    await refused(e.done(), "LEDGER_DECLINED");
    expect(Number((await rows(sql`select count(*)::int as n from audit_events where org_id = ${s.orgs.a} and action = 'ledger_connect_refused'`))[0].n)).toBeGreaterThanOrEqual(5);
  });

  it("asks which organisation when the authorisation covers several; the choice is final", async () => {
    const a = await connect(admin, "xero");
    const r = await a.done();
    expect(r.status).toBe("choose_tenant");
    xeroConn = r.connectionId;
    const list = await listLedgerConnections(viewer);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ provider: "xero", env: "standin", status: "choose_tenant", tenantChoices: [{ tenantName: "Harbour Lantern Trading (fictional demo company)" }, { tenantName: "Second Fictional Org (demo)" }] });
    expect(JSON.stringify(list)).not.toMatch(/sealed|v1\.[0-9a-f]{8}\./);
    await refused(chooseLedgerTenant(fin, { connectionId: xeroConn, tenantId: xero.orgs[0].tenantId }), "ACCESS_403");
    await refused(chooseLedgerTenant(admin, { connectionId: xeroConn, tenantId: "not-authorised" }), "LEDGER_TENANT_UNKNOWN");
    expect(await chooseLedgerTenant(admin, { connectionId: xeroConn, tenantId: xero.orgs[0].tenantId })).toEqual({ connectionId: xeroConn, status: "active" });
    const row = await connRow(xeroConn);
    expect(row).toMatchObject({ status: "active", tenantId: xero.orgs[0].tenantId, baseCurrency: "SGD", pendingTokensSealed: null, tenantChoices: null });
    await refused(chooseLedgerTenant(admin, { connectionId: xeroConn, tenantId: xero.orgs[1].tenantId }), "LEDGER_NOT_CHOOSING");
    await dbRefuses(ownerDb().execute(sql`update ledger_connections set tenant_id = 'other' where id = ${xeroConn}`), /never changes organisation/);
  });

  it("keeps tokens sealed: the usable token is in no table, no audit row and no log", async () => {
    const token = await tokenOf(s.orgs.a, xeroConn);
    expect(token.length).toBeGreaterThan(20);
    expect(await mentions(token)).toEqual([]);
    const row = await connRow(xeroConn);
    expect(await mentions(open(row.refreshTokenSealed!, { orgId: s.orgs.a, connectionId: xeroConn, field: "refresh_token" }))).toEqual([]);
    expect(captured.join("\n")).not.toContain(token);
    // a sealed value moved to another row's column does not open
    expect(() => open(row.accessTokenSealed!, { orgId: s.orgs.a, connectionId: xeroConn, field: "refresh_token" })).toThrow();
  });

  it("is invisible to another organisation and to the payment provider", async () => {
    expect(await listLedgerConnections(finB)).toEqual([]);
    await refused(readLedgerIntoUpload(finB, { connectionId: xeroConn, entityId: "ENT-LIVE-AE" }, key()), "ACCESS_404");
    await refused(disconnectLedger(adminB, { connectionId: xeroConn }), "ACCESS_404");
    const prov = await liveCtx(s, "admin@provider-a.example", "providerA");
    const seen = await withTenant({ userId: prov.userId, orgId: s.orgs.a }, (tx) => tx.execute(sql`select count(*)::int as n from ledger_connections`), { read: true });
    expect(seen.rows[0].n).toBe(0);
  });
});

describe("reading invoices and payments", () => {
  it("reads into an orders/invoices upload that waits for a person; drafts are left out; payments are counted only", async () => {
    await refused(readLedgerIntoUpload(viewer, { connectionId: xeroConn, entityId: "ENT-LIVE-SG" }, key()), "ACCESS_403");
    const r = await readLedgerIntoUpload(fin, { connectionId: xeroConn, entityId: "ENT-LIVE-SG" }, key(), { limiter: limiter() });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ invoices: 5, issuedInvoices: 4, draftsLeftOut: 1, payments: 1, upload: { status: "validated", fileType: "orders_invoices", counts: { rows: 4 } } });
    const uploadId = (r.body.upload as { id: string }).id;
    expect(Number((await rows(sql`select count(*)::int as n from invoices where org_id = ${s.orgs.a}`))[0].n)).toBe(0); // nothing before confirmation
    expect(xero.calls.filter((c) => c.method !== "GET")).toEqual([]);
    const v = r.body.upload as unknown as { contentSha256: string; rowsSha256: string };
    await decideUpload(fin, uploadId, { decision: "confirm", reason: "Checked against the ledger (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256 }, key());
    await normaliseUpload(fin, uploadId, key());
    const inv = await rows(sql`select order_id, amount_minor::text as a, currency, status from invoices where org_id = ${s.orgs.a} order by order_id`);
    expect(inv).toEqual([
      { order_id: "INV-0001", a: "135000", currency: "SGD", status: "open" }, { order_id: "INV-0002", a: "10", currency: "SGD", status: "open" },
      { order_id: "INV-0003", a: "900719925474099327", currency: "SGD", status: "open" }, { order_id: "INV-0004", a: "2000", currency: "SGD", status: "void" },
    ]);
    const [audit] = await rows(sql`select summary, details from audit_events where org_id = ${s.orgs.a} and action = 'ledger_read' order by seq desc limit 1`);
    expect(audit.details).toMatchObject({ invoices: 5, payments: 1, rows: 4, draftsLeftOut: 1 });
    expect(JSON.stringify(audit)).not.toMatch(/Kestrel|Marrow|1350/);
  });

  it("respects the ledger's 429 and its own ceiling", async () => {
    let now = Date.now();
    const lim = new LedgerRateLimiter(undefined, () => now);
    const deps = { limiter: lim, now: () => now };
    xero.rateLimitNext(2);
    await refused(readLedgerIntoUpload(fin, { connectionId: xeroConn, entityId: "ENT-LIVE-SG" }, key(), deps), "LEDGER_RATE_LIMITED");
    const calls = xero.calls.length;
    await refused(readLedgerIntoUpload(fin, { connectionId: xeroConn, entityId: "ENT-LIVE-SG" }, key(), deps), "LEDGER_RATE_LIMITED");
    expect(xero.calls.length).toBe(calls); // blocked inside Clearline, nothing sent
    now += 3_000;
    const tight = new LedgerRateLimiter({ xero: { perMinute: 1, perDay: 10 }, qbo: { perMinute: 1, perDay: 1 } }, () => now);
    const e = await refused(readLedgerIntoUpload(fin, { connectionId: xeroConn, entityId: "ENT-LIVE-SG" }, key(), { limiter: tight, now: () => now }), "LEDGER_RATE_LIMITED");
    expect((e as RequestRefused).status).toBe(429);
  });
});

describe("refresh before expiry, revoked and expired access", () => {
  it("refreshes once when the token has under two minutes left, even with concurrent requests", async () => {
    const before = await tokenOf(s.orgs.a, xeroConn);
    const grants = xero.grants.refresh_token ?? 0;
    const later = Date.now() + 29 * 60_000; // the stand-in's access token lives 30 minutes
    const [a, b] = await Promise.all([ledgerSession(fin, xeroConn, { now: () => later }), ledgerSession(ops, xeroConn, { now: () => later })]);
    expect(xero.grants.refresh_token).toBe(grants + 1);
    expect(await a.accessToken()).toBe(await b.accessToken());
    expect(await a.accessToken()).not.toBe(before);
    expect((await connRow(xeroConn)).lastRefreshedAt).not.toBeNull();
    expect(Number((await rows(sql`select count(*)::int as n from audit_events where org_id = ${s.orgs.a} and action = 'ledger_token_refreshed'`))[0].n)).toBe(1);
  });

  it("a revoked authorisation turns the connection to Reconnect; reconnecting keeps the same organisation", async () => {
    xero.revokeAll();
    await refused(readLedgerIntoUpload(fin, { connectionId: xeroConn, entityId: "ENT-LIVE-SG" }, key(), { limiter: limiter() }), "LEDGER_RECONNECT");
    const row = await connRow(xeroConn);
    expect(row).toMatchObject({ status: "needs_reconnect", accessTokenSealed: null, refreshTokenSealed: null });
    expect((await listLedgerConnections(viewer))[0]).toMatchObject({ status: "needs_reconnect", reconnectReason: expect.stringMatching(/Connect it again/) });
    await refused(ledgerSession(fin, xeroConn), "LEDGER_RECONNECT");
    xero.authoriseOnly([xero.orgs[0].tenantId]);
    const r = await (await connect(admin, "xero")).done();
    expect(r).toEqual({ connectionId: xeroConn, status: "active", provider: "xero" });
    xero.authoriseOnly(undefined);
  });

  it("a refused refresh (invalid_grant) and a passed refresh expiry turn the connection to Reconnect", async () => {
    xero.revokeAll();
    await refused(ledgerSession(fin, xeroConn, { now: () => Date.now() + 29 * 60_000 }), "LEDGER_RECONNECT");
    expect((await connRow(xeroConn)).status).toBe("needs_reconnect");
    await (await connect(admin, "xero")).done();
    expect((await connRow(xeroConn)).status).toBe("active");
    await refused(ledgerSession(fin, xeroConn, { now: () => Date.now() + 61 * 86_400_000 }), "LEDGER_RECONNECT");
    await (await connect(admin, "xero")).done();
    expect((await connRow(xeroConn)).status).toBe("active");
  });

  it("reconnecting to an organisation that was not authorised does not switch organisation", async () => {
    xero.authoriseOnly([xero.orgs[1].tenantId]);
    const r = await (await connect(admin, "xero")).done();
    expect(r.status).toBe("needs_reconnect");
    expect((await connRow(xeroConn)).tenantId).toBe(xero.orgs[0].tenantId);
    xero.authoriseOnly(undefined);
    expect((await (await connect(admin, "xero")).done()).status).toBe("active");
  });
});

describe("draft journals, only when the posting rules are signed", () => {
  const P1 = "JP-LC-0001";
  beforeAll(async () => {
    const line = (side: string, account: string, amountMinor: string) => ({ side, account, amountMinor });
    await ownerDb().insert(t.merchantJournalProposals).values([
      { orgId: s.orgs.a, id: P1, entityId: "ENT-LIVE-SG", pattern: "provider_confirmation", currency: "SGD", lines: [line("debit", "provider_clearing", "135000"), line("credit", "accounts_receivable", "135000")], evidenceRefs: { entryDate: "2026-11-05", memo: "fictional" } },
      { orgId: s.orgs.a, id: "JP-LC-USD", entityId: "ENT-LIVE-US", pattern: "provider_confirmation", currency: "USD", lines: [line("debit", "provider_clearing", "100"), line("credit", "accounts_receivable", "100")], evidenceRefs: { entryDate: "2026-11-05", memo: "fictional" } },
      { orgId: s.orgs.a, id: "JP-LC-EXP", entityId: "ENT-LIVE-SG", pattern: "provider_confirmation", currency: "SGD", status: "exported", lines: [line("debit", "provider_clearing", "100"), line("credit", "accounts_receivable", "100")], evidenceRefs: { entryDate: "2026-11-05", memo: "fictional" } },
      { orgId: s.orgs.a, id: "JP-LC-ODD", entityId: "ENT-LIVE-SG", pattern: "provider_confirmation", currency: "SGD", lines: [line("debit", "provider_clearing", "101"), line("credit", "accounts_receivable", "100")], evidenceRefs: { entryDate: "2026-11-05", memo: "fictional" } },
    ]);
  });

  it("postingRulesSigned is false while nothing is signed", async () => {
    expect(await postingRulesSigned(s.orgs.a, fin.userId)).toBe(false);
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: P1 }), "POSTING_RULES_UNSIGNED");
    expect(xero.journals).toHaveLength(0);
    expect(Number((await rows(sql`select count(*)::int as n from ledger_journal_drafts`))[0].n)).toBe(0);
    const [a] = await rows(sql`select details from audit_events where org_id = ${s.orgs.a} and action = 'ledger_journal_draft_refused' order by seq desc limit 1`);
    expect(a.details).toMatchObject({ code: "POSTING_RULES_UNSIGNED" });
  });

  it("stays false for another organisation's signature, a revoked signature and an older version (d2's contract)", async () => {
    await signPostingRules(s.orgs.b, finB.userId); // recorded as the owner: B's row only matters for being B's
    expect(await postingRulesSigned(s.orgs.a, fin.userId)).toBe(false);
    await signPostingRules(s.orgs.a, admin.userId, OLDER_POSTING_RULES);
    expect(await postingRulesSigned(s.orgs.a, fin.userId)).toBe(false); // signed, but not the current catalogue version
    await revokePostingRules(await signPostingRules(s.orgs.a, admin.userId), admin.userId);
    expect(await postingRulesSigned(s.orgs.a, fin.userId)).toBe(false);
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: P1 }), "POSTING_RULES_UNSIGNED");
    expect(xero.journals).toHaveLength(0);
  });

  it("after a (test) signature: refuses unmapped accounts, other currencies, exported and unbalanced journals; roles", async () => {
    await signPostingRules(s.orgs.a, admin.userId);
    expect(await postingRulesSigned(s.orgs.a, fin.userId)).toBe(true);
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: P1 }), "ACCOUNT_UNMAPPED");
    for (const c of [ops, viewer, approver, admin]) await refused(setLedgerAccountMap(c, { connectionId: xeroConn, accounts: { provider_clearing: "090" } }), "ACCESS_403");
    expect(await setLedgerAccountMap(fin, { connectionId: xeroConn, accounts: { provider_clearing: "090", accounts_receivable: "610" } })).toEqual({ connectionId: xeroConn, mapped: 2 });
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: "JP-LC-USD" }), "LEDGER_CURRENCY");
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: "JP-LC-EXP" }), "JOURNAL_NOT_DRAFTABLE");
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: "JP-LC-ODD" }), "JOURNAL_UNBALANCED");
    for (const c of [ops, viewer, approver, admin]) await refused(draftJournalToLedger(c, { connectionId: xeroConn, proposalId: P1 }), "ACCESS_403");
    await refused(draftJournalToLedger(finB, { connectionId: xeroConn, proposalId: P1 }), "ACCESS_404");
    expect(xero.journals).toHaveLength(0);
  });

  it("writes one DRAFT with one idempotency key; a retry writes nothing more", async () => {
    const r = await draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: P1 }, { limiter: limiter() });
    expect(r.status).toBe(201);
    expect(xero.journals).toHaveLength(1);
    expect(xero.journals[0]).toMatchObject({ tenantId: xero.orgs[0].tenantId, status: "DRAFT", lines: 2 });
    const [d] = await rows(sql`select status, external_id, idempotency_key, posting_rules_version, attempts from ledger_journal_drafts where proposal_id = ${P1}`);
    expect(d).toMatchObject({ status: "drafted", external_id: xero.journals[0].id, posting_rules_version: currentPostingRulesVersion(), attempts: 1 });
    expect(xero.journals[0].idempotencyKey).toBe(d.idempotency_key);
    const puts = xero.calls.filter((c) => c.method === "PUT").length;
    const again = await draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: P1 }, { limiter: limiter() });
    expect(again).toEqual({ status: 200, body: { draftId: (r.body as { draftId: string }).draftId, externalId: xero.journals[0].id, status: "drafted", replayed: true } });
    expect(xero.calls.filter((c) => c.method === "PUT").length).toBe(puts);
    expect(xero.calls.filter((c) => c.method !== "GET" && c.path !== "/ManualJournals")).toEqual([]);
    const [a] = await rows(sql`select details from audit_events where org_id = ${s.orgs.a} and action = 'ledger_journal_drafted'`);
    expect(a.details).toMatchObject({ externalId: xero.journals[0].id, postingRulesVersion: currentPostingRulesVersion(), idempotencyKey: d.idempotency_key });
  });

  it("a failed send is recorded and retried with the same key; the database refuses a second draft or a changed one", async () => {
    await ownerDb().insert(t.merchantJournalProposals).values({ orgId: s.orgs.a, id: "JP-LC-0002", entityId: "ENT-LIVE-SG", pattern: "settlement", currency: "SGD",
      lines: [{ side: "debit", account: "provider_clearing", amountMinor: "5" }, { side: "credit", account: "accounts_receivable", amountMinor: "5" }], evidenceRefs: { entryDate: "2026-11-06", memo: "fictional" } });
    xero.rateLimitNext(1);
    await refused(draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: "JP-LC-0002" }, { limiter: limiter() }), "LEDGER_RATE_LIMITED");
    const [f] = await rows(sql`select status, idempotency_key from ledger_journal_drafts where proposal_id = 'JP-LC-0002'`);
    expect(f.status).toBe("failed");
    const r = await draftJournalToLedger(fin, { connectionId: xeroConn, proposalId: "JP-LC-0002" }, { limiter: limiter() });
    expect(r.status).toBe(201);
    const [d] = await rows(sql`select status, idempotency_key, attempts from ledger_journal_drafts where proposal_id = 'JP-LC-0002'`);
    expect(d).toMatchObject({ status: "drafted", idempotency_key: f.idempotency_key, attempts: 2 });
    await dbRefuses(ownerDb().execute(sql`update ledger_journal_drafts set status = 'sending' where proposal_id = 'JP-LC-0002'`), /cannot become/);
    await dbRefuses(ownerDb().execute(sql`update ledger_journal_drafts set request_sha256 = repeat('0', 64) where proposal_id = 'JP-LC-0002'`), /never change/);
    await dbRefuses(withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.execute(sql`delete from ledger_journal_drafts`)), /permission denied/);
  });
});

describe("QuickBooks Online", () => {
  let qboConn: string;
  it("connects with the company named in the callback and reads invoices; never writes a journal", async () => {
    const r = await (await connect(admin, "qbo")).done();
    expect(r.status).toBe("active");
    qboConn = r.connectionId;
    expect(await connRow(qboConn)).toMatchObject({ tenantId: "9130350000000001", baseCurrency: "USD", refreshExpiresAt: expect.any(Date) });
    const read = await readLedgerIntoUpload(fin, { connectionId: qboConn, entityId: "ENT-LIVE-US" }, key(), { limiter: limiter() });
    expect(read.body).toMatchObject({ invoices: 2, issuedInvoices: 2, payments: 1 });
    await refused(draftJournalToLedger(fin, { connectionId: qboConn, proposalId: "JP-LC-USD" }), "LEDGER_NO_DRAFTS");
    expect(qbo.journals).toEqual([]);
    expect(qbo.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("refuses a callback without a numeric company id", async () => {
    await disconnectLedger(admin, { connectionId: qboConn });
    const c = await connect(admin, "qbo");
    await refused(completeLedgerConnect({ ...c.q, realmId: "../x" } as unknown as { state: string }, c.st.browserBinding), "LEDGER_NO_COMPANY");
  });
});

describe("disconnecting", () => {
  it("deletes the tokens, revokes at the ledger, and is never revived", async () => {
    await refused(disconnectLedger(fin, { connectionId: xeroConn }), "ACCESS_403");
    const r = await disconnectLedger(admin, { connectionId: xeroConn });
    expect(r).toEqual({ connectionId: xeroConn, status: "disconnected", revoked: true });
    expect(await connRow(xeroConn)).toMatchObject({ status: "disconnected", accessTokenSealed: null, refreshTokenSealed: null });
    await refused(ledgerSession(fin, xeroConn), "LEDGER_DISCONNECTED");
    await dbRefuses(ownerDb().execute(sql`update ledger_connections set status = 'active' where id = ${xeroConn}`), /never revived|ledger_connections_active_chk/);
    await dbRefuses(withTenant({ userId: admin.userId, orgId: admin.orgId }, (tx) => tx.execute(sql`delete from ledger_connections`)), /permission denied/);
    // drafts written through it stay recorded
    expect(Number((await rows(sql`select count(*)::int as n from ledger_journal_drafts where connection_id = ${xeroConn} and status = 'drafted'`))[0].n)).toBe(2);
  });

  it("connecting the same organisation again is a new connection that never drafts the same journal twice", async () => {
    xero.authoriseOnly([xero.orgs[0].tenantId]);
    const r = await (await connect(admin, "xero")).done();
    xero.authoriseOnly(undefined);
    expect(r.status).toBe("active");
    expect(r.connectionId).not.toBe(xeroConn);
    await setLedgerAccountMap(fin, { connectionId: r.connectionId, accounts: { provider_clearing: "090", accounts_receivable: "610" } });
    const before = xero.journals.length;
    await refused(draftJournalToLedger(fin, { connectionId: r.connectionId, proposalId: P_FIRST }, { limiter: limiter() }), "JOURNAL_ALREADY_DRAFTED");
    expect(xero.journals.length).toBe(before);
    await disconnectLedger(admin, { connectionId: r.connectionId });
  });

  it("an OAuth state is used once and never edited, even by its own member", async () => {
    await dbRefuses(withTenant({ userId: admin.userId, orgId: admin.orgId }, (tx) => tx.execute(sql`update ledger_oauth_states set consumed_at = null where consumed_at is not null`)), /used once/);
    await expect(withTenant({ userId: fin.userId, orgId: fin.orgId }, (tx) => tx.execute(sql`select count(*)::int as n from ledger_oauth_states`), { read: true })).resolves.toMatchObject({ rows: [{ n: 0 }] });
  });

  it("logged nothing that a ledger answered with: no token, no code, no customer name", async () => {
    const log = captured.join("\n");
    expect(log).not.toMatch(/Kestrel|Marrow|access_token|refresh_token|code=/);
    expect(await rows(sql`select 1 from audit_events where org_id = ${s.orgs.a} and (summary like '%Kestrel%' or details::text like '%v1.%' or details::text like '%Bearer%')`)).toEqual([]);
  });
});

describe("wave 2: a ledger connection is organisation-wide", () => {
  it("an Admin limited to some entities cannot connect, choose, reconnect or disconnect a ledger", async () => {
    const scoped: TenantContext = { ...admin, entityScope: Object.freeze(["ENT-LIVE-SG"]) };
    await refused(startLedgerConnect(scoped, { provider: "xero" }), "ACCESS_403");
    await refused(disconnectLedger(scoped, { connectionId: randomUUID() }), "ACCESS_403");
  });
});
