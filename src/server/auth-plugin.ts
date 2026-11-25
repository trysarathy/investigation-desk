import "server-only";
import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import type { GenericEndpointContext } from "@better-auth/core";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { and, count as countRows, eq } from "drizzle-orm";
import * as z from "zod";
import { database } from "./db/client";
import { passkeys, twoFactors } from "./db/schema";
import { freshlyAuthenticated } from "./auth-constants";
import { b64url, verifyAssertion, verifyRegistration, WebAuthnError, type AssertionResponse, type RegistrationResponse } from "./webauthn";

/**
 * Clearline's Better Auth plugin (v1 phase 1.2): passkeys (WebAuthn, src/server/webauthn.ts) as a second factor.
 *
 * - A passkey is added on top of a verified TOTP authenticator (which also gives the recovery codes), only within a
 *   fresh step-up, and at most 10 per user.
 * - Sign-in: after a correct password the two-factor plugin issues its signed `two_factor` challenge cookie; a valid
 *   passkey assertion for THAT user spends the challenge and creates the session (marked MFA-verified by the
 *   session hook in src/server/auth.ts, because the path is in SECOND_FACTOR_PATHS).
 * - Step-up: an assertion within an existing session (the auth route stamps the session on success).
 * Challenges are 256-bit, single-use, bound to the user and stored hashed (verification.storeIdentifier) for 5 min.
 * Attempt limits per account and per address are applied by src/server/auth-route.ts around these endpoints.
 */
const CHALLENGE_SECONDS = 5 * 60;
const MAX_PASSKEYS = 10;

const Credential = z.object({
  id: z.string().max(1400), rawId: z.string().max(1400), type: z.string().max(20),
  response: z.object({
    clientDataJSON: z.string().max(4000),
    attestationObject: z.string().max(20000).optional(),
    authenticatorData: z.string().max(4000).optional(),
    signature: z.string().max(2000).optional(),
    userHandle: z.string().max(200).nullable().optional(),
    transports: z.array(z.string().max(20)).max(10).optional(),
  }),
}).passthrough();

function rp() {
  const origin = process.env.CLEARLINE_ORIGIN ?? "";
  return { origin, rpId: new URL(origin).hostname };
}
const refuse = (message = "The passkey could not be verified.") => APIError.from("BAD_REQUEST", { code: "PASSKEY_INVALID", message });

/** The challenge named in a response's clientDataJSON (verified again, with everything else, by webauthn.ts). */
function challengeOf(clientDataJSON: string): string {
  try {
    const c = JSON.parse(b64url.decode(clientDataJSON).toString("utf8")) as { challenge?: unknown };
    if (typeof c.challenge === "string" && /^[A-Za-z0-9_-]{43}$/.test(c.challenge)) return c.challenge;
  } catch { /* falls through */ }
  throw refuse();
}

type Ctx = GenericEndpointContext;

async function issueChallenge(ctx: Ctx, purpose: "register" | "auth", userId: string): Promise<string> {
  const challenge = randomBytes(32).toString("base64url");
  await ctx.context.internalAdapter.createVerificationValue({ identifier: `cl-passkey-${purpose}:${challenge}`, value: userId, expiresAt: new Date(Date.now() + CHALLENGE_SECONDS * 1000) });
  return challenge;
}
/** Spend a challenge; it must exist, be unexpired and belong to `userId`. */
async function spendChallenge(ctx: Ctx, purpose: "register" | "auth", challenge: string, userId: string): Promise<void> {
  const v = await ctx.context.internalAdapter.consumeVerificationValue(`cl-passkey-${purpose}:${challenge}`).catch(() => null);
  if (!v || v.value !== userId || new Date(v.expiresAt).getTime() <= Date.now()) throw refuse();
}

/** The user of the pending second-factor challenge (the two-factor plugin's signed cookie), unspent. */
async function pendingUser(ctx: Ctx): Promise<{ userId: string; identifier: string }> {
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) throw APIError.from("UNAUTHORIZED", { code: "INVALID_TWO_FACTOR_COOKIE", message: "Sign in with your password first." });
  const v = await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (!v || new Date(v.expiresAt).getTime() <= Date.now()) throw APIError.from("UNAUTHORIZED", { code: "INVALID_TWO_FACTOR_COOKIE", message: "Sign in with your password first." });
  return { userId: v.value, identifier };
}

async function assertNotLocked(userId: string) {
  const [tf] = await database().select({ lockedUntil: twoFactors.lockedUntil }).from(twoFactors).where(eq(twoFactors.userId, userId));
  if (tf?.lockedUntil && tf.lockedUntil.getTime() > Date.now()) throw APIError.from("TOO_MANY_REQUESTS", { code: "ACCOUNT_TEMPORARILY_LOCKED", message: "Too many failed attempts. Try again later." });
}

async function requestOptions(ctx: Ctx, userId: string) {
  const creds = await database().select({ id: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, userId));
  if (creds.length === 0) throw APIError.from("BAD_REQUEST", { code: "NO_PASSKEY", message: "No passkey is registered for this account." });
  const challenge = await issueChallenge(ctx, "auth", userId);
  return { challenge, rpId: rp().rpId, timeout: 120_000, userVerification: "required", allowCredentials: creds.map((c) => ({ type: "public-key", id: c.id, ...(c.transports ? { transports: c.transports.split(",") } : {}) })) };
}

/** Verify an assertion for `userId` against their stored passkeys; updates the counter. */
async function checkAssertion(ctx: Ctx, userId: string, credential: unknown): Promise<void> {
  const r = Credential.safeParse(credential);
  if (!r.success) throw refuse();
  const a = r.data as unknown as AssertionResponse;
  const challenge = challengeOf(a.response.clientDataJSON);
  await spendChallenge(ctx, "auth", challenge, userId);
  const [cred] = await database().select().from(passkeys).where(and(eq(passkeys.userId, userId), eq(passkeys.credentialId, a.id)));
  if (!cred) throw refuse();
  try {
    const { signCount } = verifyAssertion(a, cred, { ...rp(), challenge, userHandle: userId });
    await database().update(passkeys).set({ signCount, lastUsedAt: new Date() }).where(eq(passkeys.id, cred.id));
  } catch (e) {
    if (e instanceof WebAuthnError) throw refuse();
    throw e;
  }
}

type SessionCtx = Ctx & { context: { session: { user: { id: string; email: string; name: string; twoFactorEnabled?: boolean | null }; session: { id: string; createdAt: Date; mfaVerifiedAt?: Date | null; reauthenticatedAt?: Date | null } } } };
const sessionFacts = (ctx: SessionCtx) => {
  const { user, session } = ctx.context.session;
  const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
  return { mfaEnrolled: user.twoFactorEnabled === true, createdAt: new Date(session.createdAt), mfaVerifiedAt: d(session.mfaVerifiedAt), reauthenticatedAt: d(session.reauthenticatedAt) };
};

export const clearlineSecurityPlugin = () => ({
  id: "clearline-security",
  endpoints: {
    passkeyRegisterOptions: createAuthEndpoint("/clearline/passkey/register-options", { method: "POST", use: [sessionMiddleware] }, async (raw) => {
      const ctx = raw as unknown as SessionCtx;
      const { user } = ctx.context.session;
      const facts = sessionFacts(ctx);
      if (!facts.mfaEnrolled) throw APIError.from("BAD_REQUEST", { code: "TOTP_REQUIRED_FIRST", message: "Set up an authenticator app first; a passkey is added on top of it." });
      if (!freshlyAuthenticated(facts)) throw APIError.from("FORBIDDEN", { code: "REAUTHENTICATION_REQUIRED", message: "Confirm it is you first." });
      const existing = await database().select({ id: passkeys.credentialId }).from(passkeys).where(eq(passkeys.userId, user.id));
      if (existing.length >= MAX_PASSKEYS) throw APIError.from("BAD_REQUEST", { code: "TOO_MANY_PASSKEYS", message: `At most ${MAX_PASSKEYS} passkeys per account.` });
      const challenge = await issueChallenge(raw, "register", user.id);
      const { rpId } = rp();
      return raw.json({
        challenge, timeout: 120_000, attestation: "none",
        rp: { id: rpId, name: "Clearline Control" },
        user: { id: b64url.encode(Buffer.from(user.id, "utf8")), name: user.email, displayName: user.name },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        excludeCredentials: existing.map((c) => ({ type: "public-key", id: c.id })),
      });
    }),
    passkeyRegister: createAuthEndpoint("/clearline/passkey/register", {
      method: "POST", use: [sessionMiddleware],
      body: z.object({ name: z.string().trim().min(1).max(60), credential: Credential }),
    }, async (raw) => {
      const ctx = raw as unknown as SessionCtx & { body: { name: string; credential: unknown } };
      const { user } = ctx.context.session;
      const facts = sessionFacts(ctx);
      if (!facts.mfaEnrolled) throw APIError.from("BAD_REQUEST", { code: "TOTP_REQUIRED_FIRST", message: "Set up an authenticator app first." });
      if (!freshlyAuthenticated(facts)) throw APIError.from("FORBIDDEN", { code: "REAUTHENTICATION_REQUIRED", message: "Confirm it is you first." });
      const reg = ctx.body.credential as unknown as RegistrationResponse;
      if (!reg.response.attestationObject) throw refuse();
      const challenge = challengeOf(reg.response.clientDataJSON);
      await spendChallenge(raw, "register", challenge, user.id);
      let cred;
      try { cred = verifyRegistration(reg, { ...rp(), challenge }); } catch (e) { if (e instanceof WebAuthnError) throw refuse(); throw e; }
      const [{ n }] = await database().select({ n: countRows() }).from(passkeys).where(eq(passkeys.userId, user.id));
      if (n >= MAX_PASSKEYS) throw APIError.from("BAD_REQUEST", { code: "TOO_MANY_PASSKEYS", message: `At most ${MAX_PASSKEYS} passkeys per account.` });
      const inserted = await database().insert(passkeys).values({ userId: user.id, name: ctx.body.name, ...cred }).onConflictDoNothing().returning({ id: passkeys.id });
      if (inserted.length !== 1) throw refuse("This passkey is already registered.");
      return raw.json({ ok: true, id: inserted[0].id });
    }),
    passkeySignInOptions: createAuthEndpoint("/clearline/passkey/sign-in-options", { method: "POST" }, async (ctx) => {
      const { userId } = await pendingUser(ctx);
      return ctx.json(await requestOptions(ctx, userId));
    }),
    passkeySignIn: createAuthEndpoint("/clearline/passkey/sign-in", { method: "POST", body: z.object({ credential: z.unknown() }) }, async (ctx) => {
      const { userId, identifier } = await pendingUser(ctx);
      await assertNotLocked(userId);
      await checkAssertion(ctx, userId, ctx.body.credential);
      const consumed = await ctx.context.internalAdapter.consumeVerificationValue(identifier).catch(() => null);
      if (!consumed || consumed.value !== userId) throw APIError.from("UNAUTHORIZED", { code: "INVALID_TWO_FACTOR_COOKIE", message: "Sign in with your password first." });
      const user = await ctx.context.internalAdapter.findUserById(userId);
      if (!user) throw APIError.from("UNAUTHORIZED", { code: "INVALID_TWO_FACTOR_COOKIE", message: "Sign in with your password first." });
      const session = await ctx.context.internalAdapter.createSession(userId, false);
      if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_CREATE_SESSION", message: "Sign-in failed." });
      await setSessionCookie(ctx, { session, user });
      expireCookie(ctx, ctx.context.createAuthCookie("two_factor"));
      return ctx.json({ ok: true });
    }),
    passkeyStepUpOptions: createAuthEndpoint("/clearline/passkey/step-up-options", { method: "POST", use: [sessionMiddleware] }, async (ctx) => {
      return ctx.json(await requestOptions(ctx, ctx.context.session.user.id));
    }),
    passkeyStepUp: createAuthEndpoint("/clearline/passkey/step-up", { method: "POST", use: [sessionMiddleware], body: z.object({ credential: z.unknown() }) }, async (ctx) => {
      const userId = ctx.context.session.user.id;
      await assertNotLocked(userId);
      await checkAssertion(ctx, userId, ctx.body.credential);
      return ctx.json({ ok: true });
    }),
  },
}) satisfies BetterAuthPlugin;
