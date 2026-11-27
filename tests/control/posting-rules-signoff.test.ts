/**
 * v1 phase 4: the posting-rules sign-off, against PostgreSQL 16. Only a merchant Admin with access to every entity,
 * after a second-factor step-up in the last 10 minutes, signs the CURRENT version; the signature (name, user id, time,
 * version hash, the catalogue itself) is locked; postingRulesSigned fails closed. Fictional users only (the Straits
 * seed and its fictional authenticator secret). Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, enrolTestTotp, ownerDb, PASSWORD, resetAndSeed, signInWithMfa } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { createUser, grantMembership } from "../../src/server/admin";
import { resolveTenant, withTenant } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, MERCHANT_SEED_USERS, seedMerchantCases } from "../../src/server/merchant-seed";
import { postingRulesSigned, postingRulesStatus } from "../../src/server/posting-rules";
import { postingRulesCatalogue } from "../../src/lib/clearline/merchant/posting-rules";
import { POST as rulesPOST } from "../../src/app/api/control/merchant/posting-rules/[action]/route";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const SLUG = MERCHANT_SEED_ORGS.sg.slug;
const ADMIN = "admin@straits-demo.example", FINANCE = "finance@straits-demo.example", APPROVER = "approver@straits-demo.example";
const SCOPED_ADMIN = "admin-scoped@straits-demo.example";
const cat = postingRulesCatalogue();
let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
const users: Record<string, string> = {};
const cookies: Record<string, string> = {};
let n = 0;
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const post = (email: string, action: string, body: unknown) => rulesPOST(new Request(`${ORIGIN}/api/control/merchant/posting-rules/${action}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { cookie: `${cookies[email]}; clearline_org=${SLUG}`, origin: ORIGIN, "content-type": "application/json", "idempotency-key": `prs-key-${++n}-${Date.now()}` },
}), { params: Promise.resolve({ action }) });
const sign = (email: string, body: unknown = { version: cat.version, sha256: cat.sha256 }) => post(email, "sign", body);
const code = async (r: Response) => ((await r.json()) as { error?: { code?: string } }).error?.code;
const sessionOf = (email: string) => rows(sql`select id from sessions where user_id = ${users[email]} order by created_at desc limit 1`).then((r) => String(r[0].id));
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  for (const u of MERCHANT_SEED_USERS) { users[u.email] = seed.users[u.email]; if (u.role === "admin" || u.role === "approver") await enrolTestTotp(users[u.email]); }
  users[SCOPED_ADMIN] = await createUser(ownerDb(), { email: SCOPED_ADMIN, name: "Scoped admin (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: SLUG, email: SCOPED_ADMIN, role: "admin", entities: ["ENT-SG-01"] });
  await enrolTestTotp(users[SCOPED_ADMIN]);
  let ip = 60;
  for (const e of [ADMIN, FINANCE, APPROVER, SCOPED_ADMIN]) cookies[e] = await signInWithMfa(e, PASSWORD, `198.51.100.${ip++}`);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("before any signature", () => {
  it("postingRulesSigned is false (fail closed), also for an unknown or malformed organisation", async () => {
    expect(await postingRulesSigned(seed.orgs.sg)).toBe(false);
    expect(await postingRulesSigned(seed.orgs.sg, users[FINANCE])).toBe(false);
    expect(await postingRulesSigned("not-a-uuid")).toBe(false);
    expect(await postingRulesSigned("00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});

describe("who may sign", () => {
  it("Finance and an Approver are refused (403); a member limited to one entity is refused (403); nothing is written", async () => {
    for (const e of [FINANCE, APPROVER, SCOPED_ADMIN]) expect((await sign(e)).status, e).toBe(403);
    expect((await rows(sql`select count(*)::int as n from posting_rules_signatures`))[0].n).toBe(0);
  });
  it("an Admin without a fresh second factor is refused: MFA_STEP_UP_REQUIRED (a password step-up does not count)", async () => {
    const sid = await sessionOf(ADMIN);
    await ownerDb().execute(sql`update sessions set mfa_verified_at = now() - interval '11 minutes', reauthenticated_at = now() where id = ${sid}`);
    const r = await sign(ADMIN);
    expect(r.status).toBe(403);
    expect(await code(r)).toBe("MFA_STEP_UP_REQUIRED");
    await ownerDb().execute(sql`update sessions set mfa_verified_at = now(), reauthenticated_at = now() where id = ${sid}`);
  });
  it("a version other than the current one is refused (409 VERSION_CHANGED)", async () => {
    const r = await sign(ADMIN, { version: "PR-000000000000", sha256: "0".repeat(64) });
    expect(r.status).toBe(409);
    expect(await code(r)).toBe("VERSION_CHANGED");
  });
  it("the database refuses a signature by a non-Admin or in another member's name, with the services bypassed", async () => {
    const ins = (as: string, by: string) => withTenant({ userId: users[as], orgId: seed.orgs.sg }, (tx) => tx.execute(sql`insert into posting_rules_signatures
      (org_id, version, version_sha256, catalogue, signed_by_user_id, signed_by_name, mfa_verified_at) values (${seed.orgs.sg}, ${cat.version}, ${cat.sha256}, '{}'::jsonb, ${users[by]}, 'x', now())`));
    await dbRefuses(ins(FINANCE, FINANCE), /row-level security/);
    await dbRefuses(ins(SCOPED_ADMIN, SCOPED_ADMIN), /row-level security/);
    await dbRefuses(ins(ADMIN, FINANCE), /row-level security/);
  });
});

describe("an Admin signs the current version", () => {
  let signatureId = "";
  it("records name, user id, time, version and hash; the catalogue is stored; audited without its contents", async () => {
    const r = await sign(ADMIN);
    expect(r.status).toBe(200);
    const body = await r.json() as { signatureId: string; version: string; sha256: string };
    signatureId = body.signatureId;
    expect([body.version, body.sha256]).toEqual([cat.version, cat.sha256]);
    const [row] = await rows(sql`select signed_by_user_id, signed_by_name, version, version_sha256, catalogue->>'sha256' as cs, revoked_at, signed_at <= now() as past from posting_rules_signatures where id = ${signatureId}`);
    expect(row).toMatchObject({ signed_by_user_id: users[ADMIN], version: cat.version, version_sha256: cat.sha256, cs: cat.sha256, revoked_at: null, past: true });
    expect(String(row.signed_by_name)).toMatch(/fictional/i);
    const [a] = await rows(sql`select actor_user_id, summary, details from audit_events where action = 'posting_rules_signed'`);
    expect(a.actor_user_id).toBe(users[ADMIN]);
    expect(JSON.stringify(a)).not.toContain("provider_clearing");
  });
  it("postingRulesSigned is now true (as a member and as an organisation-only job); another organisation sees nothing", async () => {
    expect(await postingRulesSigned(seed.orgs.sg)).toBe(true);
    expect(await postingRulesSigned(seed.orgs.sg, users[FINANCE])).toBe(true);
    expect(await postingRulesSigned(seed.orgs.ae)).toBe(false);
    const st = await postingRulesStatus(await resolveTenant({ userId: users[FINANCE], name: FINANCE, email: FINANCE }, SLUG));
    expect([st.signed, st.standing?.version]).toEqual([true, cat.version]);
  });
  it("signing the same version again is refused (409 ALREADY_SIGNED)", async () => {
    const r = await sign(ADMIN);
    expect([r.status, await code(r)]).toEqual([409, "ALREADY_SIGNED"]);
  });
  it("the signed version is locked: no edit, no delete, even by the Admin with the services bypassed", async () => {
    const as = (q: ReturnType<typeof sql>) => withTenant({ userId: users[ADMIN], orgId: seed.orgs.sg }, (tx) => tx.execute(q));
    await dbRefuses(as(sql`update posting_rules_signatures set version = 'PR-aaaaaaaaaaaa' where id = ${signatureId}`), /permission denied/);
    await dbRefuses(as(sql`delete from posting_rules_signatures where id = ${signatureId}`), /permission denied/);
    await dbRefuses(ownerDb().execute(sql`update posting_rules_signatures set catalogue = '{}'::jsonb where id = ${signatureId}`), /locked/);
    await dbRefuses(ownerDb().execute(sql`delete from posting_rules_signatures where id = ${signatureId}`), /append-only/);
  });
  it("a newer signature of another version makes it unsigned again: a new rules version needs a new signature", async () => {
    await ownerDb().execute(sql`insert into posting_rules_signatures (org_id, version, version_sha256, catalogue, signed_by_user_id, signed_by_name, mfa_verified_at)
      values (${seed.orgs.sg}, 'PR-bbbbbbbbbbbb', ${"b".repeat(64)}, '{}'::jsonb, ${users[ADMIN]}, 'Admin (fictional)', now())`);
    expect(await postingRulesSigned(seed.orgs.sg)).toBe(false);
    const old = await rows(sql`select id from posting_rules_signatures where version = 'PR-bbbbbbbbbbbb'`);
    await ownerDb().execute(sql`update posting_rules_signatures set revoked_by_user_id = ${users[ADMIN]}, revoked_reason = 'test' where id = ${String(old[0].id)}`);
    expect(await postingRulesSigned(seed.orgs.sg)).toBe(true);
  });
  it("revocation (Admin, fresh second factor) is recorded once and makes the rules unsigned", async () => {
    expect((await post(FINANCE, "revoke", { signatureId, reason: "test" })).status).toBe(403);
    const r = await post(ADMIN, "revoke", { signatureId, reason: "Withdrawn in a test" });
    expect(r.status).toBe(200);
    expect(await postingRulesSigned(seed.orgs.sg)).toBe(false);
    expect((await post(ADMIN, "revoke", { signatureId, reason: "again" })).status).toBe(404);
    await dbRefuses(ownerDb().execute(sql`update posting_rules_signatures set revoked_reason = 'changed' where id = ${signatureId}`), /locked/);
    expect((await sign(ADMIN)).status).toBe(200);
    expect(await postingRulesSigned(seed.orgs.sg)).toBe(true);
  });
});
