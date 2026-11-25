import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { database } from "./db/client";
import { authRateEvents } from "./db/schema";

/**
 * Database-backed attempt limits for sign-in security (shared by every instance; v1 phase 1.2). One row per counted
 * attempt: (scope, HMAC of the key, time). Keys are an account's e-mail (lower-cased) or a client address bucket
 * from src/server/client-ip.ts; they are HMAC-keyed with the server secret, so the table holds no e-mail addresses or
 * network addresses. Rows older than a day are pruned as new ones arrive.
 *
 * Every limit has a per-ACCOUNT and a per-ADDRESS rule. The per-address rule is skipped when the address is unknown
 * (no trusted proxy configured): an unknown address must never put every user into one shared bucket.
 */
export interface Rule { max: number; windowSeconds: number }

export const LIMITS = {
  /** Failed password sign-ins from one address (per account is src/server/signin-limit.ts: 5 per 15 minutes). */
  sign_in_ip: { max: 20, windowSeconds: 15 * 60 },
  /** Failed second-factor attempts (TOTP, recovery code, passkey, step-up), per account and per address. */
  mfa_account: { max: 5, windowSeconds: 15 * 60 },
  mfa_ip: { max: 20, windowSeconds: 15 * 60 },
  /** Password-reset requests. Over the account limit the answer is unchanged and no e-mail is sent. */
  reset_request_account: { max: 3, windowSeconds: 60 * 60 },
  reset_request_ip: { max: 10, windowSeconds: 60 * 60 },
  /** Failed password-reset submissions (a wrong, used or expired token) from one address. */
  reset_submit_ip: { max: 10, windowSeconds: 15 * 60 },
  /** Verification e-mails sent, and failed verification links. */
  verify_send_account: { max: 3, windowSeconds: 60 * 60 },
  verify_send_ip: { max: 10, windowSeconds: 60 * 60 },
  verify_submit_ip: { max: 10, windowSeconds: 15 * 60 },
  /** A TOTP code already accepted for an account (replay guard: once per code within its validity window). */
  totp_used: { max: 1, windowSeconds: 120 },
} as const satisfies Record<string, Rule>;
export type Scope = keyof typeof LIMITS;

function keyHash(scope: Scope, key: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  return createHmac("sha256", secret).update(`clearline-rate:${scope}:${key.trim().toLowerCase()}`).digest("hex");
}

/** True while fewer than `max` attempts were counted in the window. A null key (unknown address) is never limited. */
export async function underLimit(scope: Scope, key: string | null): Promise<boolean> {
  if (!key) return true;
  const rule: Rule = LIMITS[scope];
  const since = new Date(Date.now() - rule.windowSeconds * 1000);
  const r = await database().select({ n: sql<number>`count(*)::int` }).from(authRateEvents)
    .where(and(eq(authRateEvents.scope, scope), eq(authRateEvents.keyHash, keyHash(scope, key)), gt(authRateEvents.at, since)));
  return (r[0]?.n ?? 0) < rule.max;
}

/** Count one attempt. */
export async function count(scope: Scope, key: string | null): Promise<void> {
  if (!key) return;
  const db = database();
  await db.insert(authRateEvents).values({ scope, keyHash: keyHash(scope, key) });
  await db.delete(authRateEvents).where(lt(authRateEvents.at, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}

/** Forget a key's attempts (after a success, for failure-counting scopes). */
export async function clear(scope: Scope, key: string | null): Promise<void> {
  if (!key) return;
  await database().delete(authRateEvents).where(and(eq(authRateEvents.scope, scope), eq(authRateEvents.keyHash, keyHash(scope, key))));
}
