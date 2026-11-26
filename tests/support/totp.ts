import { createHmac } from "node:crypto";
import { Pool } from "pg";

/**
 * TEST-ONLY second factor for the fictional Admins and Approvers of the browser suites (v1 1.2 requires MFA for those
 * roles; the gate is unchanged). Seeded users get a KNOWN fictional TOTP secret, stored exactly as Better Auth stores
 * one (encrypted with the suite's test-only auth secret), as tests/control/harness.ts and tests/e2e-control/db.ts do.
 * Never used outside tests; no real person or authenticator.
 */
export const FICTIONAL_TOTP_SECRET = "fictional-e2e-totp-secret-000001";
/** Roles the MFA gate requires a second factor for (src/server/mfa-gate.ts MFA_REQUIRED_ROLES). */
export const MFA_ROLES = ["admin", "approver"] as const;

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) over the secret's UTF-8 bytes, as Better Auth's two-factor plugin does. */
export function totp(secret: string = FICTIONAL_TOTP_SECRET, at: number = Date.now()): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", Buffer.from(secret, "utf8")).update(buf).digest();
  return String((h.readUInt32BE(h[h.length - 1] & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/**
 * Enrol the fictional TOTP secret for every user with an active Admin or Approver membership who has no second factor
 * yet (or only `emails`, when given). Idempotent. Returns how many users were enrolled.
 */
export async function enrolFictionalTotp(ownerUrl: string, authSecret: string, o: { emails?: string[]; secret?: string } = {}): Promise<number> {
  const { symmetricEncrypt } = await import("better-auth/crypto");
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const r = await pool.query(`select distinct u.id from users u join organization_memberships m on m.user_id = u.id
      where m.revoked_at is null and m.role = any($1) and not u.two_factor_enabled ${o.emails ? "and u.email = any($2)" : ""}`, o.emails ? [MFA_ROLES, o.emails] : [MFA_ROLES]);
    for (const { id } of r.rows as { id: string }[]) {
      await pool.query("delete from two_factors where user_id = $1", [id]);
      await pool.query("insert into two_factors (id, secret, backup_codes, user_id, verified) values ($1, $2, $3, $4, true)",
        [`tf_${id}`, await symmetricEncrypt({ key: authSecret, data: o.secret ?? FICTIONAL_TOTP_SECRET }), await symmetricEncrypt({ key: authSecret, data: JSON.stringify(["FICT0-E2E00"]) }), id]);
      await pool.query("update users set two_factor_enabled = true where id = $1", [id]);
    }
    return r.rows.length;
  } finally { await pool.end(); }
}

/** Test-only: forget accepted codes, so the TOTP replay guard does not refuse a suite that signs in many times. */
export async function forgetUsedCodes(ownerUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try { await pool.query("delete from auth_rate_events where scope = 'totp_used'"); } finally { await pool.end(); }
}

/** The key shown on the Security page (base32, RFC 4648) back to the secret's text. */
export function base32decode(s: string): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/[\s=]/g, "").toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out).toString("utf8");
}
