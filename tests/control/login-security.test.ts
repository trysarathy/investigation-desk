/**
 * v1 phase 1.2 — login security controls, against real PostgreSQL and the real route handlers. Every control has a
 * positive test and at least one negative test. All people, addresses and secrets are fictional.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { closeOwner, enrolTestTotp, ownerDb, PASSWORD, resetAndSeed, signInWithMfa, totp, TOTP_SECRET } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { currentSession } from "../../src/server/auth";
import { POST as authPOST, GET as authGET } from "../../src/app/api/auth/[...all]/route";
import { GET as paymentsGET } from "../../src/app/api/control/payments/route";
import { GET as securityGET } from "../../src/app/api/control/security/route";
import { POST as securityPOST } from "../../src/app/api/control/security/[action]/route";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const RP_ID = new URL(ORIGIN).hostname;
let ids: Record<string, string>;
let n = 0;
const ip = () => `203.0.113.${(n++ % 250) + 1}`;

beforeAll(async () => { ids = await resetAndSeed(); });
afterAll(async () => { await closeDatabase(); await closeOwner(); });
beforeEach(async () => {
  await ownerDb().execute(sql`delete from auth_rate_events`);
  await ownerDb().execute(sql`delete from login_failures`);
  await ownerDb().execute(sql`update two_factors set failed_verification_count = 0, locked_until = null`);
  delete process.env.CLEARLINE_TRUSTED_PROXY_HOPS;
  process.env.CLEARLINE_EMAIL_SENDER = "outbox";
});

const q = async <T = Record<string, unknown>>(text: ReturnType<typeof sql>) => (await ownerDb().execute(text)).rows as T[];
const cookiesOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c));
const sessionCookie = (res: Response) => cookiesOf(res).filter((c) => c.includes("session_token")).join("; ");

function auth(path: string, body: unknown, o: { cookie?: string; from?: string; origin?: string; headers?: Record<string, string> } = {}) {
  return authPOST(new Request(`${ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: o.origin ?? ORIGIN, "x-forwarded-for": o.from ?? ip(), ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) },
    body: JSON.stringify(body),
  }));
}
function sec(action: string, body: unknown, cookie?: string, from = ip()) {
  return securityPOST(new Request(`${ORIGIN}/api/control/security/${action}`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "idempotency-key": `sec-${Date.now()}-${n++}`, "x-forwarded-for": from, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ action }) });
}
const payments = (cookie: string, org = "lumen-demo") => paymentsGET(new Request(`${ORIGIN}/api/control/payments`, { headers: { cookie: `${cookie}; clearline_org=${org}` } }));
const security = (cookie: string) => securityGET(new Request(`${ORIGIN}/api/control/security`, { headers: { cookie } }));
const errorCode = async (r: Response) => ((await r.clone().json()) as { error?: { code?: string }; code?: string }).error?.code ?? ((await r.clone().json()) as { code?: string }).code;

/** Password only: the session cookie, or the pending second-factor cookie for an account with MFA. */
async function passwordStep(email: string, password = PASSWORD, from = ip()) {
  const res = await auth("/sign-in/email", { email, password }, { from });
  return { res, body: (await res.clone().json()) as { twoFactorRedirect?: boolean }, cookie: cookiesOf(res).join("; ") };
}
const forgetUsedCodes = () => ownerDb().execute(sql`delete from auth_rate_events where scope = 'totp_used'`);
/** A user with no MFA, created for one test (fictional). */
async function freshUser(role: string, email: string): Promise<string> {
  const { createUser, grantMembership } = await import("../../src/server/admin");
  const id = await createUser(ownerDb(), { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: "lumen-demo", email, role: role as "viewer" });
  return id;
}

// ------------------------------------------------------------------------------------------------- the MFA gate
describe("MFA is required for Admins and Approvers (they cannot use the app until enrolled)", () => {
  it("an Admin without MFA signs in with the password but every tenant API answers 403 MFA_ENROLLMENT_REQUIRED", async () => {
    await freshUser("admin", "admin-nomfa@lumen.example");
    const { body, cookie } = await passwordStep("admin-nomfa@lumen.example");
    expect(body.twoFactorRedirect).toBeFalsy();
    const r = await payments(cookie);
    expect(r.status).toBe(403);
    expect(await errorCode(r)).toBe("MFA_ENROLLMENT_REQUIRED");
    // …but the Security page's API works, so they can set MFA up
    const s = await security(cookie);
    expect(s.status).toBe(200);
    expect((await s.json()).requiredIn).toEqual([{ slug: "lumen-demo", name: "Lumen (fictional)", reason: "role" }]);
  });

  it("an Approver without MFA is blocked the same way; a Viewer without MFA is not (optional for other roles)", async () => {
    await freshUser("approver", "approver-nomfa@lumen.example");
    await freshUser("viewer", "viewer-nomfa@lumen.example");
    expect(await errorCode(await payments((await passwordStep("approver-nomfa@lumen.example")).cookie))).toBe("MFA_ENROLLMENT_REQUIRED");
    expect((await payments((await passwordStep("viewer-nomfa@lumen.example")).cookie)).status).toBe(200);
  });

  it("selecting the organisation is gated too (no cookie is set for a blocked member)", async () => {
    const { POST: orgPOST } = await import("../../src/app/api/control/org/route");
    const { cookie } = await passwordStep("admin-nomfa@lumen.example");
    const r = await orgPOST(new Request(`${ORIGIN}/api/control/org`, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json", "idempotency-key": "org-select-1" }, body: JSON.stringify({ slug: "lumen-demo" }) }));
    expect(r.status).toBe(403);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("an enrolled user's session that never proved the second factor is refused (403 MFA_VERIFICATION_REQUIRED) until a step-up", async () => {
    const cookie = await signInWithMfa("approver@lumen.example");
    expect((await payments(cookie)).status).toBe(200);
    await ownerDb().execute(sql`update sessions set mfa_verified_at = null, reauthenticated_at = null where user_id = ${ids["approver@lumen.example"]}`);
    const r = await payments(cookie);
    expect(await errorCode(r)).toBe("MFA_VERIFICATION_REQUIRED");
    await forgetUsedCodes();
    const wrong = await auth("/two-factor/verify-totp", { code: "000000" === totp() ? "111111" : "000000" }, { cookie });
    expect(wrong.status).toBe(401);
    expect((await payments(cookie)).status).toBe(403);
    expect((await auth("/two-factor/verify-totp", { code: totp() }, { cookie })).status).toBe(200);
    expect((await payments(cookie)).status).toBe(200);
  });

  it("an organisation can require MFA for every member; only its Admin can set that, with a fresh step-up, and it is audited", async () => {
    const viewer = (await passwordStep("viewer-nomfa@lumen.example")).cookie;
    expect((await sec("org-mfa-policy", { requireMfaAll: true }, `${viewer}; clearline_org=lumen-demo`)).status).toBe(403);
    const finance = await signInWithMfa("finance@lumen.example"); // finance has no MFA: password session
    expect((await sec("org-mfa-policy", { requireMfaAll: true }, `${finance}; clearline_org=lumen-demo`)).status).toBe(403);
    const admin = await signInWithMfa("admin@lumen.example");
    // stale step-up: refused
    await ownerDb().execute(sql`update sessions set mfa_verified_at = now() - interval '11 minutes', reauthenticated_at = now() - interval '11 minutes' where user_id = ${ids["admin@lumen.example"]}`);
    const stale = await sec("org-mfa-policy", { requireMfaAll: true }, `${admin}; clearline_org=lumen-demo`);
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("REAUTHENTICATION_REQUIRED");
    await forgetUsedCodes();
    expect((await auth("/two-factor/verify-totp", { code: totp() }, { cookie: admin })).status).toBe(200);
    const ok = await sec("org-mfa-policy", { requireMfaAll: true }, `${admin}; clearline_org=lumen-demo`);
    expect(ok.status).toBe(200);
    expect(await errorCode(await payments(viewer))).toBe("MFA_ENROLLMENT_REQUIRED");
    // the other organisation is unaffected
    const audit = await q(sql`select action, actor_user_id from audit_events where action = 'org_mfa_required_for_all'`);
    expect(audit).toEqual([{ action: "org_mfa_required_for_all", actor_user_id: ids["admin@lumen.example"] }]);
    // the runtime role cannot write another organisation's policy directly (RLS)
    const rt = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL });
    const c = await rt.connect();
    try {
      const harbour = (await q<{ id: string }>(sql`select id from organizations where slug = 'harbour-demo'`))[0].id;
      await c.query("begin");
      await c.query(`select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`, [ids["admin@lumen.example"], harbour]);
      await expect(c.query(`insert into org_security_settings (org_id, require_mfa_all, updated_by) values ($1, true, $2)`, [harbour, ids["admin@lumen.example"]])).rejects.toThrow(/row-level security/);
    } finally { await c.query("rollback"); c.release(); await rt.end(); }
    expect((await sec("org-mfa-policy", { requireMfaAll: false }, `${admin}; clearline_org=lumen-demo`)).status).toBe(200);
    expect((await payments(viewer)).status).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------- TOTP
describe("TOTP enrolment and sign-in (Better Auth two-factor plugin)", () => {
  let secret = "";
  let codes: string[] = [];
  it("enrolment needs the password; a wrong one is refused and counts toward the account's password limit", async () => {
    const { cookie } = await passwordStep("admin-nomfa@lumen.example");
    const bad = await auth("/two-factor/enable", { password: "wrong-password-123" }, { cookie });
    expect(bad.status).toBe(400);
    expect((await q(sql`select count(*)::int as n from login_failures`))[0].n).toBe(1);
    const res = await auth("/two-factor/enable", { password: PASSWORD, method: "otp" }, { cookie }); // "otp" is forced to "totp"
    expect(res.status).toBe(200);
    const b = await res.json() as { totpURI: string; backupCodes: string[] };
    expect(b.totpURI).toMatch(/^otpauth:\/\/totp\//);
    codes = b.backupCodes;
    expect(codes).toHaveLength(10);
    // Better Auth puts the base32 of the UTF-8 secret in the URI
    const b32 = new URL(b.totpURI).searchParams.get("secret")!;
    secret = base32decode(b32);
    // stored encrypted: neither the secret nor a recovery code appears in the row
    const row = (await q<{ secret: string; backup_codes: string; verified: boolean }>(sql`select secret, backup_codes, verified from two_factors where user_id = (select id from users where email = 'admin-nomfa@lumen.example')`))[0];
    expect(row.verified).toBe(false);
    expect(row.secret).not.toContain(secret);
    for (const c of codes) expect(row.backup_codes).not.toContain(c);
    // not on yet: still blocked
    expect(await errorCode(await payments(cookie))).toBe("MFA_ENROLLMENT_REQUIRED");
    // a wrong code does not turn it on; the right one does, and the new session is MFA-verified
    expect((await auth("/two-factor/verify-totp", { code: totp(secret, Date.now(), 5) }, { cookie })).status).toBe(401);
    const ok = await auth("/two-factor/verify-totp", { code: totp(secret) }, { cookie });
    expect(ok.status).toBe(200);
    const s2 = sessionCookie(ok);
    expect((await payments(s2)).status).toBe(200);
  });

  it("sign-in with MFA: the password alone gives no session; a wrong code is refused; the right code signs in", async () => {
    await forgetUsedCodes();
    const p = await passwordStep("admin-nomfa@lumen.example");
    expect(p.body.twoFactorRedirect).toBe(true);
    expect(p.cookie).not.toMatch(/session_token/);
    expect(await currentSession(new Headers({ cookie: p.cookie }))).toBeNull();
    expect((await auth("/two-factor/verify-totp", { code: totp(secret, Date.now(), 9) }, { cookie: p.cookie })).status).toBe(401);
    const v = await auth("/two-factor/verify-totp", { code: totp(secret), trustDevice: true }, { cookie: p.cookie });
    expect(v.status).toBe(200);
    // "trust this device" is never honoured
    expect(v.headers.getSetCookie().some((c) => /trust_device=[^;]/.test(c))).toBe(false);
    const s = await currentSession(new Headers({ cookie: sessionCookie(v) }));
    expect(s?.mfaVerifiedAt).toBeInstanceOf(Date);
  });

  it("an accepted TOTP code cannot be replayed (even in another sign-in within its window)", async () => {
    const code = totp(secret);
    const p1 = await passwordStep("admin-nomfa@lumen.example");
    // the previous test may have used this code already; use a fresh pair of sign-ins
    await forgetUsedCodes();
    expect((await auth("/two-factor/verify-totp", { code }, { cookie: p1.cookie })).status).toBe(200);
    const p2 = await passwordStep("admin-nomfa@lumen.example");
    const replay = await auth("/two-factor/verify-totp", { code }, { cookie: p2.cookie });
    expect(replay.status).toBe(401);
  });

  it("a recovery code works once; the second use is refused", async () => {
    const p1 = await passwordStep("admin-nomfa@lumen.example");
    expect((await auth("/two-factor/verify-backup-code", { code: codes[0] }, { cookie: p1.cookie })).status).toBe(200);
    const p2 = await passwordStep("admin-nomfa@lumen.example");
    expect((await auth("/two-factor/verify-backup-code", { code: codes[0] }, { cookie: p2.cookie })).status).toBe(401);
    expect((await auth("/two-factor/verify-backup-code", { code: codes[1] }, { cookie: p2.cookie })).status).toBe(200);
  });

  it("a forged or missing second-factor cookie is refused", async () => {
    expect((await auth("/two-factor/verify-totp", { code: totp(secret) })).status).toBe(401);
    expect((await auth("/two-factor/verify-totp", { code: totp(secret) }, { cookie: "clearline.two_factor=2fa-forged.c2lnbmF0dXJl" })).status).toBe(401);
  });

  it("second-factor attempts are limited PER ACCOUNT across addresses (5 per 15 minutes), and then even the right code is refused", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const p = await passwordStep("approver2@lumen.example");
      statuses.push((await auth("/two-factor/verify-totp", { code: totp(TOTP_SECRET, Date.now(), 7 + i) }, { cookie: p.cookie })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    await forgetUsedCodes();
    const p = await passwordStep("approver2@lumen.example");
    expect((await auth("/two-factor/verify-totp", { code: totp() }, { cookie: p.cookie })).status).toBe(429);
    // another account is unaffected
    expect(await signInWithMfa("approver@lumen.example")).toMatch(/session_token/);
  });

  it("turning MFA off: refused for a role that requires it; for a Viewer it needs a fresh step-up and signs out the other sessions", async () => {
    const admin = await signInWithMfa("admin@lumen.example");
    expect(await errorCode(await sec("disable-mfa", {}, admin))).toBe("MFA_REQUIRED");
    await enrolTestTotp(ids["viewer@lumen.example"]);
    const other = await signInWithMfa("viewer@lumen.example");
    const me = await signInWithMfa("viewer@lumen.example");
    const meId = (await currentSession(new Headers({ cookie: me })))!.sessionId;
    await ownerDb().execute(sql`update sessions set mfa_verified_at = now() - interval '20 minutes', reauthenticated_at = null where id = ${meId}`);
    expect(await errorCode(await sec("disable-mfa", {}, me))).toBe("REAUTHENTICATION_REQUIRED");
    // a password does not count as a step-up for a user with MFA
    expect(await errorCode(await sec("step-up", { password: PASSWORD }, me))).toBe("USE_SECOND_FACTOR");
    await forgetUsedCodes();
    expect((await auth("/two-factor/verify-totp", { code: totp() }, { cookie: me })).status).toBe(200);
    expect((await sec("disable-mfa", {}, me)).status).toBe(200);
    expect(await currentSession(new Headers({ cookie: other }))).toBeNull();
    expect((await q(sql`select two_factor_enabled from users where email = 'viewer@lumen.example'`))[0].two_factor_enabled).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- passkeys
describe("passkeys (WebAuthn, minimal verifier) as a second factor", () => {
  let key: { privateKey: KeyObject; credId: Buffer; counter: number };
  let admin = "";
  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    key = { privateKey, credId: randomBytes(32), counter: 0 };
    (key as unknown as { publicKey: KeyObject }).publicKey = publicKey;
  });

  it("adding a passkey needs a fresh step-up", async () => {
    admin = await signInWithMfa("admin@lumen.example");
    await ownerDb().execute(sql`update sessions set mfa_verified_at = now() - interval '20 minutes', reauthenticated_at = null where user_id = ${ids["admin@lumen.example"]}`);
    expect((await auth("/clearline/passkey/register-options", {}, { cookie: admin })).status).toBe(403);
    await forgetUsedCodes();
    expect((await auth("/two-factor/verify-totp", { code: totp() }, { cookie: admin })).status).toBe(200);
  });

  it("a registration with the wrong origin, a reused challenge or a missing user-verification flag is refused; a good one is stored (public key only)", async () => {
    const pub = (key as unknown as { publicKey: KeyObject }).publicKey;
    const opts = async () => (await (await auth("/clearline/passkey/register-options", {}, { cookie: admin })).json()) as { challenge: string; user: { id: string } };
    let o = await opts();
    const reg = (challenge: string, origin = ORIGIN, flags = 0x45) => registration(pub, key.credId, challenge, origin, flags);
    expect((await auth("/clearline/passkey/register", { name: "Fictional key", credential: reg(o.challenge, "https://evil.example") }, { cookie: admin })).status).toBe(400);
    // that challenge is spent now
    expect((await auth("/clearline/passkey/register", { name: "Fictional key", credential: reg(o.challenge) }, { cookie: admin })).status).toBe(400);
    o = await opts();
    expect((await auth("/clearline/passkey/register", { name: "Fictional key", credential: reg(o.challenge, ORIGIN, 0x41) }, { cookie: admin })).status).toBe(400);
    o = await opts();
    const unknownChallenge = randomBytes(32).toString("base64url");
    expect((await auth("/clearline/passkey/register", { name: "Fictional key", credential: reg(unknownChallenge) }, { cookie: admin })).status).toBe(400);
    const ok = await auth("/clearline/passkey/register", { name: "Fictional key", credential: reg(o.challenge) }, { cookie: admin });
    expect(ok.status).toBe(200);
    const rows = await q<{ credential_id: string; alg: number }>(sql`select credential_id, alg from passkeys where user_id = ${ids["admin@lumen.example"]}`);
    expect(rows).toEqual([{ credential_id: key.credId.toString("base64url"), alg: -7 }]);
    // the challenge identifiers are stored hashed: no stored identifier contains a challenge
    expect((await q(sql`select count(*)::int as n from verifications where identifier like 'cl-passkey%'`))[0].n).toBe(0);
  });

  it("signs in with password + passkey; a bad signature, a non-increasing counter, a replayed challenge and a wrong origin are refused", async () => {
    const start = async () => {
      const p = await passwordStep("admin@lumen.example");
      const o = (await (await auth("/clearline/passkey/sign-in-options", {}, { cookie: p.cookie })).json()) as { challenge: string; allowCredentials: { id: string }[] };
      return { cookie: p.cookie, challenge: o.challenge, allow: o.allowCredentials };
    };
    let s = await start();
    expect(s.allow.map((a) => a.id)).toEqual([key.credId.toString("base64url")]);
    // bad signature
    const forged = assertion(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey, key.credId, s.challenge, ORIGIN, ++key.counter, ids["admin@lumen.example"]);
    expect((await auth("/clearline/passkey/sign-in", { credential: forged }, { cookie: s.cookie })).status).toBe(400);
    s = await start();
    expect((await auth("/clearline/passkey/sign-in", { credential: assertion(key.privateKey, key.credId, s.challenge, "https://evil.example", ++key.counter, ids["admin@lumen.example"]) }, { cookie: s.cookie })).status).toBe(400);
    s = await start();
    const good = assertion(key.privateKey, key.credId, s.challenge, ORIGIN, ++key.counter, ids["admin@lumen.example"]);
    const ok = await auth("/clearline/passkey/sign-in", { credential: good }, { cookie: s.cookie });
    expect(ok.status).toBe(200);
    const sess = await currentSession(new Headers({ cookie: sessionCookie(ok) }));
    expect(sess?.mfaVerifiedAt).toBeInstanceOf(Date);
    expect((await payments(sessionCookie(ok))).status).toBe(200);
    // the same assertion again (challenge spent, counter not increased)
    s = await start();
    expect((await auth("/clearline/passkey/sign-in", { credential: good }, { cookie: s.cookie })).status).toBe(400);
    // a fresh challenge but an old counter (a cloned authenticator)
    expect((await auth("/clearline/passkey/sign-in", { credential: assertion(key.privateKey, key.credId, s.challenge, ORIGIN, key.counter - 1, ids["admin@lumen.example"]) }, { cookie: s.cookie })).status).toBe(400);
  });

  it("another user's pending sign-in cannot use this passkey", async () => {
    const p = await passwordStep("approver@lumen.example");
    expect((await auth("/clearline/passkey/sign-in-options", {}, { cookie: p.cookie })).status).toBe(400); // they have none
    expect((await auth("/clearline/passkey/sign-in", { credential: assertion(key.privateKey, key.credId, randomBytes(32).toString("base64url"), ORIGIN, ++key.counter, ids["admin@lumen.example"]) }, { cookie: p.cookie })).status).toBe(400);
  });
});

// ------------------------------------------------------------------------------------------------- reset + verification
describe("password reset and e-mail verification (local outbox; tokens single-use, short-lived, hashed at rest)", () => {
  const outbox = (to: string) => q<{ subject: string; text_body: string }>(sql`select subject, text_body from email_outbox where to_address = ${to} order by id`);
  const tokenIn = (text: string) => /#token=([A-Za-z0-9_%-]+)/.exec(text)?.[1];

  // Accounts made by the admin CLI start verified (src/server/admin.ts, pre-existing); these tests start them unverified.
  beforeAll(async () => { await ownerDb().execute(sql`update users set email_verified = false where email in ('ops@lumen.example', 'viewer@lumen.example', 'finance@lumen.example')`); });

  it("e-mail verification: the link is sent to the outbox, only the token's hash is stored, it works once", async () => {
    const cookie = await signInWithMfa("ops@lumen.example");
    expect((await sec("send-verification-email", {}, cookie)).status).toBe(200);
    const mail = await outbox("ops@lumen.example");
    expect(mail).toHaveLength(1);
    const token = tokenIn(mail[0].text_body)!;
    expect(token).toHaveLength(43);
    const rows = await q<{ token_sha256: string }>(sql`select token_sha256 from auth_tokens`);
    expect(rows).toEqual([{ token_sha256: createHash("sha256").update(token).digest("hex") }]);
    expect((await sec("verify-email", { token: token.slice(0, -1) + (token.endsWith("A") ? "B" : "A") })).status).toBe(400);
    expect((await sec("verify-email", { token })).status).toBe(200);
    expect((await q(sql`select email_verified from users where email = 'ops@lumen.example'`))[0].email_verified).toBe(true);
    expect((await sec("verify-email", { token })).status).toBe(400); // single use
    expect(await errorCode(await sec("send-verification-email", {}, cookie))).toBe("ALREADY_VERIFIED");
  });

  it("an expired verification link is refused; sending is limited per account (3 an hour)", async () => {
    const cookie = await signInWithMfa("viewer@lumen.example");
    for (let i = 0; i < 3; i++) expect((await sec("send-verification-email", {}, cookie)).status).toBe(200);
    expect((await sec("send-verification-email", {}, cookie)).status).toBe(429);
    const token = tokenIn((await outbox("viewer@lumen.example")).at(-1)!.text_body)!;
    // earlier links were voided by the newer one
    const first = tokenIn((await outbox("viewer@lumen.example"))[0].text_body)!;
    expect((await sec("verify-email", { token: first })).status).toBe(400);
    await ownerDb().execute(sql`update auth_tokens set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute'`);
    expect((await sec("verify-email", { token })).status).toBe(400);
    expect((await q(sql`select email_verified from users where email = 'viewer@lumen.example'`))[0].email_verified).toBe(false);
  });

  it("reset: a verified user gets one link; it works once; it signs them out everywhere; the old password stops working", async () => {
    const before = await signInWithMfa("ops@lumen.example");
    const r = await auth("/request-password-reset", { email: "ops@lumen.example", redirectTo: "https://evil.example" });
    expect(r.status).toBe(200);
    const generic = await r.json();
    const mail = (await outbox("ops@lumen.example")).filter((m) => /Reset/.test(m.subject));
    expect(mail).toHaveLength(1);
    expect(mail[0].text_body).toContain(`${ORIGIN}/control/sign-in/reset#token=`);
    const token = decodeURIComponent(tokenIn(mail[0].text_body)!);
    // hashed at rest: no verification row holds the token
    expect((await q(sql`select count(*)::int as n from verifications where identifier like ${"%" + token + "%"}`))[0].n).toBe(0);
    // a too-short password is refused and the token survives
    expect((await auth("/reset-password", { token, newPassword: "short" })).status).toBe(400);
    expect((await auth("/reset-password", { token, newPassword: "fictional-new-pass-02" })).status).toBe(200);
    expect(await currentSession(new Headers({ cookie: before }))).toBeNull();
    expect((await auth("/reset-password", { token, newPassword: "fictional-new-pass-03" })).status).toBe(400);
    expect((await passwordStep("ops@lumen.example", PASSWORD)).res.status).toBe(401);
    expect((await passwordStep("ops@lumen.example", "fictional-new-pass-02")).res.status).toBe(200);
    // no enumeration: unknown and unverified addresses get the same answer and no e-mail
    for (const email of ["nobody@lumen.example", "finance@lumen.example"]) {
      const x = await auth("/request-password-reset", { email });
      expect(x.status).toBe(200);
      expect(await x.json()).toEqual(generic);
      expect(await outbox(email)).toHaveLength(0);
    }
  });

  it("an expired reset token is refused", async () => {
    await auth("/request-password-reset", { email: "ops@lumen.example" });
    const token = decodeURIComponent(tokenIn((await outbox("ops@lumen.example")).at(-1)!.text_body)!);
    await ownerDb().execute(sql`update verifications set expires_at = now() - interval '1 minute' where value = ${ids["ops@lumen.example"]}`);
    expect((await auth("/reset-password", { token, newPassword: "fictional-new-pass-04" })).status).toBe(400);
  });

  it("reset requests per account: over 3 an hour the answer is unchanged but no e-mail is sent", async () => {
    const before = (await outbox("ops@lumen.example")).length;
    for (let i = 0; i < 4; i++) expect((await auth("/request-password-reset", { email: "ops@lumen.example" })).status).toBe(200);
    expect((await outbox("ops@lumen.example")).length - before).toBe(3);
  });

  it("the web app's database role can write the outbox but never read it", async () => {
    const rt = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL });
    try { await expect(rt.query("select * from email_outbox")).rejects.toThrow(/permission denied/); } finally { await rt.end(); }
  });
});

// ------------------------------------------------------------------------------------------------- sessions
describe("session list with revoke", () => {
  it("lists only my sessions, without tokens or addresses; revoke one; revoke all others; someone else's id is not found", async () => {
    await ownerDb().execute(sql`delete from sessions where user_id = ${ids["finance@lumen.example"]}`);
    const a = await signInWithMfa("finance@lumen.example");
    const b = await signInWithMfa("finance@lumen.example");
    const c = await signInWithMfa("finance@lumen.example");
    const list = await (await security(a)).json() as { sessions: { id: string; current: boolean; token?: string; ipAddress?: string }[] };
    expect(list.sessions).toHaveLength(3);
    expect(list.sessions.filter((x) => x.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/token|198\.51|203\.0/);
    const bId = (await currentSession(new Headers({ cookie: b })))!.sessionId;
    const other = await signInWithMfa("viewer@lumen.example");
    const otherId = (await currentSession(new Headers({ cookie: other })))!.sessionId;
    expect((await sec("revoke-session", { id: otherId }, a)).status).toBe(404);
    expect(await currentSession(new Headers({ cookie: other }))).not.toBeNull();
    expect(await errorCode(await sec("revoke-session", { id: (await currentSession(new Headers({ cookie: a })))!.sessionId }, a))).toBe("CURRENT_SESSION");
    expect((await sec("revoke-session", { id: bId }, a)).status).toBe(200);
    expect(await currentSession(new Headers({ cookie: b }))).toBeNull();
    expect(await currentSession(new Headers({ cookie: c }))).not.toBeNull();
    const all = await sec("revoke-other-sessions", {}, a);
    expect(await all.json()).toEqual({ revoked: 1 });
    expect(await currentSession(new Headers({ cookie: c }))).toBeNull();
    expect(await currentSession(new Headers({ cookie: a }))).not.toBeNull();
    // a foreign Origin is refused before anything happens
    const csrf = await securityPOST(new Request(`${ORIGIN}/api/control/security/revoke-other-sessions`, { method: "POST", headers: { cookie: a, origin: "https://evil.example", "content-type": "application/json", "idempotency-key": "csrf-test-1" }, body: "{}" }), { params: Promise.resolve({ action: "revoke-other-sessions" }) });
    expect(csrf.status).toBe(403);
  });
});

// ------------------------------------------------------------------------------------------------- per-address limits
describe("rate limits per address, behind a trusted proxy only", () => {
  it("with no trusted proxy configured, a client-chosen X-Forwarded-For never selects a bucket (per-address limits are off, per-account stay on)", async () => {
    const from = "192.0.2.77";
    for (let i = 0; i < 22; i++) await auth("/sign-in/email", { email: `nobody${i}@lumen.example`, password: "wrong-password-123" }, { from });
    expect((await passwordStep("viewer-nomfa@lumen.example", PASSWORD, from)).res.status).toBe(200);
  });

  it("with CLEARLINE_TRUSTED_PROXY_HOPS=1, 20 failed sign-ins from one address (across accounts) trip a 429 for that address only", async () => {
    process.env.CLEARLINE_TRUSTED_PROXY_HOPS = "1";
    const from = "192.0.2.78";
    const st: number[] = [];
    // the client-written left part of the header is ignored; the proxy-appended right part is the address
    for (let i = 0; i < 21; i++) st.push((await auth("/sign-in/email", { email: `nobody${i}@lumen.example`, password: "wrong-password-123" }, { from: `10.9.9.${i}, ${from}` })).status);
    expect(st.slice(0, 20).every((x) => x === 401)).toBe(true);
    expect(st[20]).toBe(429);
    expect((await passwordStep("viewer-nomfa@lumen.example", PASSWORD, from)).res.status).toBe(429);
    expect((await passwordStep("viewer-nomfa@lumen.example", PASSWORD, "192.0.2.79")).res.status).toBe(200);
  });

  it("password-reset requests per address: the 11th in an hour is refused (429)", async () => {
    process.env.CLEARLINE_TRUSTED_PROXY_HOPS = "1";
    const st: number[] = [];
    for (let i = 0; i < 11; i++) st.push((await auth("/request-password-reset", { email: `nobody${i}@lumen.example` }, { from: "192.0.2.80" })).status);
    expect(st.slice(0, 10).every((x) => x === 200)).toBe(true);
    expect(st[10]).toBe(429);
  });

  it("failed reset submissions per address: the 11th is refused even with a right token", async () => {
    process.env.CLEARLINE_TRUSTED_PROXY_HOPS = "1";
    for (let i = 0; i < 10; i++) expect((await auth("/reset-password", { token: `forged-token-${i}`, newPassword: "fictional-new-pass-09" }, { from: "192.0.2.81" })).status).toBe(400);
    expect((await auth("/reset-password", { token: "forged-token-x", newPassword: "fictional-new-pass-09" }, { from: "192.0.2.81" })).status).toBe(429);
  });

  it("the trusted-address header Better Auth reads cannot be set by the client", async () => {
    process.env.CLEARLINE_TRUSTED_PROXY_HOPS = "1";
    const res = await auth("/sign-in/email", { email: "viewer-nomfa@lumen.example", password: PASSWORD }, { from: "192.0.2.90", headers: { "x-clearline-trusted-client-ip": "192.0.2.250" } });
    expect(res.status).toBe(200);
    const s = await currentSession(new Headers({ cookie: sessionCookie(res) }));
    const row = (await q<{ ip_address: string }>(sql`select ip_address from sessions where id = ${s!.sessionId}`))[0];
    expect(row.ip_address).toBe("192.0.2.90");
  });
});

// ------------------------------------------------------------------------------------------------- allow-list
describe("only the Better Auth endpoints Clearline uses are reachable", () => {
  it.each(["/sign-up/email", "/two-factor/disable", "/send-verification-email", "/verify-email", "/change-email", "/revoke-sessions", "/two-factor/send-otp", "/update-user", "/delete-user"])("POST %s is 404", async (p) => {
    expect((await auth(p, {})).status).toBe(404);
  });
  it.each(["/get-session", "/list-sessions", "/verify-email?token=x", "/reset-password/abc"])("GET %s is 404", async (p) => {
    expect((await authGET(new Request(`${ORIGIN}/api/auth${p}`))).status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------- helpers
function base32decode(s: string): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
}

/** Minimal CBOR encoder (test-only) for a software authenticator. */
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : n < 65536 ? Buffer.from([(major << 5) | 25, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b; })();
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v.entries()].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  if (v && typeof v === "object") return cbor(new Map(Object.entries(v)));
  throw new Error("cbor: unsupported");
}
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
function clientData(type: string, challenge: string, origin: string) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }
function registration(pub: KeyObject, credId: Buffer, challenge: string, origin: string, flags: number) {
  const jwk = pub.export({ format: "jwk" }) as { x: string; y: string };
  const cose = new Map<number, number | Buffer>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
  const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
  const authData = Buffer.concat([sha(RP_ID), Buffer.from([flags]), Buffer.from([0, 0, 0, 0]), Buffer.alloc(16), len, credId, cbor(cose)]);
  const att = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
  const id = credId.toString("base64url");
  return { id, rawId: id, type: "public-key", response: { clientDataJSON: clientData("webauthn.create", challenge, origin).toString("base64url"), attestationObject: att.toString("base64url"), transports: ["internal"] } };
}
function assertion(priv: KeyObject, credId: Buffer, challenge: string, origin: string, counter: number, userId: string) {
  const c = Buffer.alloc(4); c.writeUInt32BE(Math.max(0, counter));
  const authData = Buffer.concat([sha(RP_ID), Buffer.from([0x05]), c]);
  const cdj = clientData("webauthn.get", challenge, origin);
  const sig = createSign("sha256").update(Buffer.concat([authData, sha(cdj)])).sign(priv);
  const id = credId.toString("base64url");
  return { id, rawId: id, type: "public-key", response: { clientDataJSON: cdj.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: sig.toString("base64url"), userHandle: Buffer.from(userId).toString("base64url") } };
}
