import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { database } from "./db/client";
import { authTokens, users } from "./db/schema";
import { emailSender } from "./email";
import { RequestRefused } from "./errors";
import { count, underLimit } from "./rate-limit";
import type { Principal } from "./tenant";

/**
 * E-mail verification (v1 phase 1.2). Better Auth's own verification links are stateless signed tokens that can be
 * replayed until they expire, so Clearline issues its own: 256 random bits, only the SHA-256 stored, 30 minutes,
 * spent by a single conditional UPDATE (a second use, or a use after expiry, changes nothing). Requesting a new link
 * voids the user's earlier unused ones.
 */
export const VERIFY_MINUTES = 30;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function sendVerificationEmail(p: Principal, ip: string | null): Promise<void> {
  if (!(await underLimit("verify_send_account", p.userId)) || !(await underLimit("verify_send_ip", ip))) {
    throw new RequestRefused(429, "TOO_MANY_ATTEMPTS", "Too many verification e-mails. Try again in an hour.");
  }
  const [u] = await database().select({ email: users.email, verified: users.emailVerified }).from(users).where(eq(users.id, p.userId));
  if (!u) throw new RequestRefused(400, "UNKNOWN_USER", "Sign in again.");
  if (u.verified) throw new RequestRefused(409, "ALREADY_VERIFIED", "Your e-mail address is already verified.");
  await count("verify_send_account", p.userId);
  await count("verify_send_ip", ip);
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await database().transaction(async (tx) => {
    await tx.delete(authTokens).where(and(eq(authTokens.userId, p.userId), eq(authTokens.purpose, "verify_email"), isNull(authTokens.usedAt)));
    await tx.insert(authTokens).values({ purpose: "verify_email", tokenSha256: hash(token), userId: p.userId, email: u.email, createdAt: new Date(now), expiresAt: new Date(now + VERIFY_MINUTES * 60_000) });
  });
  const link = `${process.env.CLEARLINE_ORIGIN ?? ""}/control/sign-in/verify-email#token=${token}`;
  await emailSender().send({
    to: u.email,
    kind: "email_verification",
    subject: "Verify your e-mail address for Clearline Control",
    text: [`To verify ${u.email} for Clearline Control, open this link within ${VERIFY_MINUTES} minutes. It works once:`, link, "", "If you did not ask for this, ignore this e-mail."].join("\n"),
  });
}

/** Spend a verification token. One generic answer for unknown, used and expired tokens. */
export async function verifyEmailToken(token: unknown, ip: string | null): Promise<void> {
  if (!(await underLimit("verify_submit_ip", ip))) throw new RequestRefused(429, "TOO_MANY_ATTEMPTS", "Too many attempts. Try again in 15 minutes.");
  const bad = async () => { await count("verify_submit_ip", ip); return new RequestRefused(400, "INVALID_TOKEN", "This link is not valid. It may have been used already or expired; ask for a new one."); };
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw await bad();
  const spent = await database().update(authTokens).set({ usedAt: sql`now()` })
    .where(and(eq(authTokens.tokenSha256, hash(token)), eq(authTokens.purpose, "verify_email"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, sql`now()`)))
    .returning({ userId: authTokens.userId, email: authTokens.email });
  if (spent.length !== 1) throw await bad();
  // Only the address the link was sent to is verified: if the account's address changed since, nothing is.
  const done = await database().update(users).set({ emailVerified: true, updatedAt: new Date() })
    .where(and(eq(users.id, spent[0].userId), eq(users.email, spent[0].email))).returning({ id: users.id });
  if (done.length !== 1) throw await bad();
}
