import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";

process.env.DATABASE_URL = process.env.CLEARLINE_TEST_RUNTIME_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-deployment-0123456789";
process.env.CLEARLINE_ORIGIN ??= "http://127.0.0.1:3199";

export const PASSWORD = "fictional-test-pass-01";
let ownerPool: Pool | undefined;
export function ownerDb(): Db {
  ownerPool ??= new Pool({ connectionString: process.env.CLEARLINE_TEST_OWNER_URL });
  return drizzle(ownerPool, { schema }) as Db;
}
export async function closeOwner() { await ownerPool?.end(); ownerPool = undefined; }
let jobsPool: Pool | undefined;
/** The job worker's limited queue login (rc8, `clearline_jobs`; scripts/db/setup-local.sh creates it). */
export function jobsDb(): Db {
  jobsPool ??= new Pool({ connectionString: process.env.CLEARLINE_TEST_JOBS_URL });
  return drizzle(jobsPool, { schema }) as Db;
}
export async function closeJobs() { await jobsPool?.end(); jobsPool = undefined; }

/** Truncate all data (owner; triggers disabled only for the reset): a blank database, no organisation and no user. */
export async function resetBlank() {
  const db = ownerDb();
  // Test-only reset as the schema owner: the owner can always alter its own tables (documented in the threat model);
  // the runtime role can never do this.
  const TABLES = `audit_events, investigation_notes, approval_decisions, approval_requests, idempotency_records, statement_imports,
    accounting_exports, accounting_proposals, repayment_allocations, funding_obligations, investigations, exceptions, reconciliation_records,
    settlement_evidence, provider_events, engine_records, payment_intents, org_engine_state, organization_memberships, organizations,
    sessions, accounts, verifications, users, email_outbox, auth_rate_events, login_failures`;
  for (const tb of ["audit_events", "investigation_notes", "approval_decisions", "approval_requests"]) await db.execute(sql.raw(`ALTER TABLE ${tb} DISABLE TRIGGER USER`));
  await db.execute(sql.raw(`TRUNCATE ${TABLES} CASCADE`));
  for (const tb of ["audit_events", "investigation_notes", "approval_decisions", "approval_requests"]) await db.execute(sql.raw(`ALTER TABLE ${tb} ENABLE TRIGGER USER`));
}

/** A blank database, then two fictional organisations. */
export async function resetAndSeed() {
  const db = ownerDb();
  await resetBlank();
  const { createOrganization, createUser, grantMembership } = await import("../../src/server/admin");
  await createOrganization(db, { slug: "lumen-demo", name: "Lumen (fictional)", seed: "sample" });
  await createOrganization(db, { slug: "harbour-demo", name: "Harbour (fictional)", seed: "sample" });
  const users = [
    ["ops@lumen.example", "lumen-demo", "payment_ops"], ["approver@lumen.example", "lumen-demo", "approver"],
    ["approver2@lumen.example", "lumen-demo", "approver"], ["finance@lumen.example", "lumen-demo", "finance"],
    ["viewer@lumen.example", "lumen-demo", "viewer"], ["admin@lumen.example", "lumen-demo", "admin"],
    ["ops@harbour.example", "harbour-demo", "payment_ops"], ["approver@harbour.example", "harbour-demo", "approver"],
  ] as const;
  const ids: Record<string, string> = {};
  for (const [email, org, role] of users) {
    ids[email] = await createUser(db, { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: org, email, role });
    // v1 1.2: Admins and Approvers cannot use Control without MFA; the fictional ones get a known test authenticator.
    if (role === "admin" || role === "approver") await enrolTestTotp(ids[email]);
  }
  return ids;
}

// ---- v1 1.2: multi-factor sign-in for tests (fictional secrets; test-only) ----------------------------------------

/** The authenticator secret every enrolled test user shares (Better Auth's format: a 32-character string). */
export const TOTP_SECRET = "fictional-totp-test-secret-00001";
export const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `FICT${i}-CODE${i}`);

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s), written independently of Better Auth so each checks the other. */
export function totp(secret: string = TOTP_SECRET, at: number = Date.now(), offsetSteps = 0): string {
  const counter = Math.floor(at / 30_000) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", Buffer.from(secret, "utf8")).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Give a user a verified authenticator directly (as the owner), exactly as Better Auth stores one: encrypted. */
export async function enrolTestTotp(userId: string, secret: string = TOTP_SECRET, codes: string[] = RECOVERY_CODES) {
  const { symmetricEncrypt } = await import("better-auth/crypto");
  const key = process.env.BETTER_AUTH_SECRET!;
  const db = ownerDb();
  await db.execute(sql`delete from two_factors where user_id = ${userId}`);
  await db.execute(sql`insert into two_factors (id, secret, backup_codes, user_id, verified) values (${`tf_${userId}`}, ${await symmetricEncrypt({ key, data: secret })}, ${await symmetricEncrypt({ key, data: JSON.stringify(codes) })}, ${userId}, true)`);
  await db.execute(sql`update users set two_factor_enabled = true where id = ${userId}`);
}

const setCookies = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c));

/**
 * Sign in the way the browser does: password, then (if the account has MFA) the authenticator code. Returns the
 * session cookie. The TOTP replay guard would refuse the same code twice in a test run, so this test-only helper
 * forgets the user's used codes first.
 */
export async function signInWithMfa(email: string, password: string = PASSWORD, ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`): Promise<string> {
  const origin = process.env.CLEARLINE_ORIGIN!;
  const { POST } = await import("../../src/app/api/auth/[...all]/route");
  const h = { "content-type": "application/json", origin, "x-forwarded-for": ip };
  const res = await POST(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: h, body: JSON.stringify({ email, password }) }));
  if (res.status !== 200) throw new Error(`sign-in ${email}: HTTP ${res.status}`);
  const body = await res.json() as { twoFactorRedirect?: boolean };
  if (!body.twoFactorRedirect) return setCookies(res).join("; ");
  const pending = setCookies(res).join("; ");
  await ownerDb().execute(sql`delete from auth_rate_events where scope = 'totp_used'`);
  const v = await POST(new Request(`${origin}/api/auth/two-factor/verify-totp`, { method: "POST", headers: { ...h, cookie: pending }, body: JSON.stringify({ code: totp() }) }));
  if (v.status !== 200) throw new Error(`second factor ${email}: HTTP ${v.status} ${await v.text()}`);
  return setCookies(v).filter((c) => c.includes("session_token")).join("; ");
}

export function principal(ids: Record<string, string>, email: string) {
  return { userId: ids[email], name: email, email };
}
