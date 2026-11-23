/**
 * rc7 phase 3b: the organisation Admin (members, sign a member out everywhere, audit log with ids only) and the
 * owner-only per-merchant deletion, against PostgreSQL 16. After deleting merchant A, no row of ANY table (every base
 * table in information_schema, whole row as text) mentions A's id, slug or its members, A's uploaded files are gone
 * from storage, and merchant B is untouched (same rows, files still readable). Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { liveKey, pushFile, seedSgLive, type LiveSg } from "./live-data";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { auditLogPage, listOrgUsers, revokeUserSessions } from "../../src/server/org-admin";
import { DeletionRefused, deleteMerchant, planMerchantDeletion } from "../../src/server/merchant-deletion";
import { uploadPreview } from "../../src/server/uploads";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let live: LiveSg;
let dir: string;
let adminA: TenantContext, finB: TenantContext;
let bUpload: string;

async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
const session = (userId: string) => ownerDb().insert(t.sessions).values({ id: randomUUID(), token: randomBytes(24).toString("hex"), userId, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(), updatedAt: new Date() });

/** Every base table in the public schema with the number of rows whose text mentions `needle`. */
async function mentions(needle: string): Promise<Record<string, number>> {
  const tables = (await ownerDb().execute(sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => String(r.t));
  const out: Record<string, number> = {};
  for (const tb of tables) {
    const n = Number((await ownerDb().execute(sql`select count(*)::int as n from ${sql.identifier(tb)} x where x::text like ${`%${needle}%`}`)).rows[0].n);
    if (n) out[tb] = n;
  }
  return out;
}
async function allCounts(): Promise<Record<string, number>> {
  const tables = (await ownerDb().execute(sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => String(r.t));
  return Object.fromEntries(await Promise.all(tables.map(async (tb) => [tb, Number((await ownerDb().execute(sql`select count(*)::int as n from ${sql.identifier(tb)}`)).rows[0].n)] as const)));
}

const LEDGER: Mapping = { fileType: "ledger_invoices", columns: { invoice_number: { header: "Invoice" }, total: { header: "Total" }, currency: { header: "Ccy" } } };

beforeAll(async () => {
  dir = useTestStorage();
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-admin");
  live = await seedSgLive(s);
  adminA = live.admin;
  finB = await liveCtx(s, "finance@live-b.example", "b");
  bUpload = await pushFile(finB, finB, "ENT-LIVE-AE", "ledger_invoices", "b-ledger.csv", new TextEncoder().encode("Invoice,Total,Ccy\nAE-1,20.00,AED\nAE-2,30.00,AED\n"), LEDGER);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("organisation Admin", () => {
  it("lists this organisation's members and roles only; only an Admin may", async () => {
    const users = await listOrgUsers(adminA);
    expect(users.map((u) => u.email).sort()).toEqual(["admin-admin@live-a.example", "approver-admin@live-a.example", "approver2-admin@live-a.example", "finance-admin@live-a.example", "ops-admin@live-a.example", "viewer-admin@live-a.example"].sort());
    expect(users.find((u) => u.you)?.role).toBe("admin");
    for (const c of [live.fin, live.ops, live.approver, live.viewer]) await refused(listOrgUsers(c), "ACCESS_403");
  });

  it("signs a member out everywhere; not yourself, not another organisation's user, not as a non-Admin", async () => {
    await session(live.ops.userId); await session(live.ops.userId); await session(finB.userId);
    expect((await listOrgUsers(adminA)).find((u) => u.userId === live.ops.userId)!.activeSessions).toBe(2);
    await refused(revokeUserSessions(live.fin, live.ops.userId, liveKey()), "ACCESS_403");
    await refused(revokeUserSessions(adminA, finB.userId, liveKey()), "ACCESS_404");
    await refused(revokeUserSessions(adminA, adminA.userId, liveKey()), "OWN_SESSIONS");
    expect((await revokeUserSessions(adminA, live.ops.userId, liveKey())).body).toEqual({ userId: live.ops.userId, sessionsRevoked: 2 });
    expect(await ownerDb().select().from(t.sessions).where(eq(t.sessions.userId, live.ops.userId))).toEqual([]);
    expect((await ownerDb().select().from(t.sessions).where(eq(t.sessions.userId, finB.userId))).length).toBe(1);
  });

  it("the audit log is paged, newest first, ids only, and only this organisation's", async () => {
    const p1 = await auditLogPage(adminA, { pageSize: 5 });
    expect(p1.events).toHaveLength(5);
    expect(Object.keys(p1.events[0]).sort()).toEqual(["action", "actorUserId", "at", "entityId", "entityType", "seq", "source"]);
    expect(p1.events[0].action).toBe("member_sessions_revoked");
    const p2 = await auditLogPage(adminA, { pageSize: 5, before: p1.nextBefore! });
    expect(p2.events[0].seq).toBeLessThan(p1.events[4].seq);
    const mine = new Set((await ownerDb().select({ seq: t.auditEvents.seq }).from(t.auditEvents).where(eq(t.auditEvents.orgId, adminA.orgId))).map((x) => Number(x.seq)));
    for (const e of [...p1.events, ...p2.events]) expect(mine.has(e.seq)).toBe(true);
    await refused(auditLogPage(live.fin), "ACCESS_403");
  });
});

describe("per-merchant deletion (owner only)", () => {
  it("refuses a provider organisation, a wrong confirmation and an unknown slug; planning changes nothing", async () => {
    await expect(deleteMerchant(ownerDb(), s.slugs.providerA, s.slugs.providerA)).rejects.toBeInstanceOf(DeletionRefused);
    await expect(deleteMerchant(ownerDb(), s.slugs.a, "live-merchant-b-admin")).rejects.toThrow(/Confirmation does not match/);
    await expect(deleteMerchant(ownerDb(), "no-such-org", "no-such-org")).rejects.toBeInstanceOf(DeletionRefused);
    const before = await allCounts();
    const plan = await planMerchantDeletion(ownerDb(), s.slugs.a);
    expect(plan.tables.uploads).toBe(4);
    expect(plan.users).toBe(6);
    expect(Object.keys(plan.tables).length).toBeGreaterThan(15);
    expect(await allCounts()).toEqual(before);
  });

  it("removes every row of merchant A in every table, its members and its files; merchant B is untouched", async () => {
    const aId = s.orgs.a, bId = s.orgs.b;
    const aUsers = (await listOrgUsers(adminA)).map((u) => u.userId);
    expect(Object.keys(await mentions(aId)).length).toBeGreaterThan(15);
    expect(readdirSync(path.join(dir, aId)).length).toBe(4);
    const bBefore = await mentions(bId);
    const totalBefore = await allCounts();

    const r = await deleteMerchant(ownerDb(), s.slugs.a, s.slugs.a);
    expect(r).toMatchObject({ users: 6, files: 4 });
    expect(JSON.stringify(r)).not.toContain(aId);

    expect(await mentions(aId)).toEqual({});
    expect(await mentions(s.slugs.a)).toEqual({});
    for (const u of aUsers) expect(await mentions(u)).toEqual({});
    expect(existsSync(path.join(dir, aId))).toBe(false);

    expect(await mentions(bId)).toEqual(bBefore);
    const totalAfter = await allCounts();
    for (const [tb, n] of Object.entries(totalAfter)) expect(n, tb).toBe(totalBefore[tb] - (r.tables[tb] ?? 0) - (tb === "users" ? r.users : 0));
    expect((await uploadPreview(finB, bUpload)).preview.rows).toHaveLength(2);
    // triggers are back on: an append-only table refuses an update again
    await expect(ownerDb().execute(sql`update audit_events set summary = 'x' where org_id = ${bId}`)).rejects.toThrow();
  });
});
