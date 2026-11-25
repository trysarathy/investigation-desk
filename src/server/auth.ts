import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { headers as nextHeaders } from "next/headers";
import { eq } from "drizzle-orm";
import { database } from "./db/client";
import * as schema from "./db/schema";
import type { Principal } from "./tenant";
import { AccessDenied } from "./tenant";
import { clearlineSecurityPlugin } from "./auth-plugin";
import { sendPasswordResetEmail } from "./password-reset";
import { SECOND_FACTOR_PATHS, TRUSTED_IP_HEADER } from "./auth-constants";

/**
 * Session lifetime: ABSOLUTE 8 h from sign-in (enforced in currentSession: Better Auth's refresh would otherwise
 * extend it), refreshed at most hourly while in use. Revocation = deleting the session row.
 */
export const SESSION_SECONDS = 8 * 60 * 60;

export { TRUSTED_IP_HEADER, SECOND_FACTOR_PATHS } from "./auth-constants";

function build() {
  const origin = process.env.CLEARLINE_ORIGIN;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!origin || !secret || secret.length < 32) throw new Error("CLEARLINE_ORIGIN and BETTER_AUTH_SECRET (≥ 32 chars) are required for Clearline Control sign-in");
  const knownIp = (req: Request) => !!req.headers.get(TRUSTED_IP_HEADER);
  return betterAuth({
    appName: "Clearline Control",
    baseURL: origin,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [origin],
    database: drizzleAdapter(database(), { provider: "pg", usePlural: true, schema }),
    // Accounts are created by an administrator (scripts/control/admin.ts); there is no public sign-up.
    emailAndPassword: {
      enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false,
      // v1 1.2: password reset by e-mail. The token is single-use (consumed with the password change), lives 30
      // minutes and is stored hashed (verification.storeIdentifier below); every session of the user is revoked.
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => { await sendPasswordResetEmail(user, token); },
    },
    // Every verification identifier (reset tokens, second-factor challenges, passkey challenges) is stored as its
    // SHA-256: a database read never yields a usable token.
    verification: { storeIdentifier: "hashed" },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: 60 * 60,
      // No cookie cache: every request checks the session row, so a revoked session stops working immediately.
      cookieCache: { enabled: false },
      additionalFields: {
        mfaVerifiedAt: { type: "date", required: false, input: false },
        reauthenticatedAt: { type: "date", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A session created by a successful second-factor check is MFA-verified; any other session is not.
          before: async (session, ctx) => {
            const proved = !!ctx?.path && SECOND_FACTOR_PATHS.has(ctx.path);
            const now = new Date();
            return { data: { ...session, mfaVerifiedAt: proved ? now : null, reauthenticatedAt: proved ? now : null } };
          },
        },
      },
    },
    // Per-ACCOUNT and per-ADDRESS limits are database-backed in src/server/auth-route.ts. Better Auth's in-memory
    // limiter is kept as a second layer, keyed ONLY on the trusted address; when the address is unknown it is
    // skipped, so unknown clients never share one bucket (which would let anyone lock everyone out).
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": (req) => (knownIp(req) ? { window: 15 * 60, max: 20 } : false),
        // the same budgets as the database limits, so this second layer never refuses earlier than they do
        "/request-password-reset": (req) => (knownIp(req) ? { window: 60 * 60, max: 10 } : false),
        "/two-factor/*": (req) => (knownIp(req) ? { window: 15 * 60, max: 30 } : false),
        "/clearline/passkey/*": (req) => (knownIp(req) ? { window: 15 * 60, max: 30 } : false),
        "/**": (req, current) => (knownIp(req) ? current : false),
      },
    },
    advanced: {
      cookiePrefix: "clearline",
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict", path: "/" },
      ipAddress: { ipAddressHeaders: [TRUSTED_IP_HEADER] },
      // Better Auth skips its origin check under NODE_ENV=test by default; keep it on everywhere (tests = deployment).
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    telemetry: { enabled: false },
    plugins: [
      twoFactor({
        issuer: "Clearline Control",
        // The second-factor challenge after a correct password lasts 5 minutes; "trust this device" is not offered
        // (the auth route strips it), so every sign-in of an enrolled user asks for the second factor.
        twoFactorCookieMaxAge: 5 * 60,
        trustDeviceMaxAge: 60,
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
        // Consecutive failed second-factor checks per account, across challenges and factors.
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
      clearlineSecurityPlugin(),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof build>;
declare global { var __clearlineAuth: Auth | undefined }

export function auth(): Auth {
  return (globalThis.__clearlineAuth ??= build());
}

/** The session behind a request, with what the MFA gate and step-up need. */
export interface SessionInfo {
  principal: Principal;
  sessionId: string;
  createdAt: Date;
  /** The user has a verified second factor (TOTP; passkeys are added on top of it). */
  mfaEnrolled: boolean;
  mfaVerifiedAt: Date | null;
  reauthenticatedAt: Date | null;
}

/** The signed-in session for this request, from the session cookie only. */
export async function currentSession(h?: Headers): Promise<SessionInfo | null> {
  const s = await auth().api.getSession({ headers: h ?? (await nextHeaders()) });
  if (!s) return null;
  if (Date.now() - new Date(s.session.createdAt).getTime() > SESSION_SECONDS * 1000) {
    await database().delete(schema.sessions).where(eq(schema.sessions.id, s.session.id));
    return null;
  }
  const sess = s.session as typeof s.session & { mfaVerifiedAt?: Date | string | null; reauthenticatedAt?: Date | string | null };
  const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
  return {
    principal: { userId: s.user.id, name: s.user.name, email: s.user.email },
    sessionId: s.session.id,
    createdAt: new Date(s.session.createdAt),
    mfaEnrolled: (s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
    mfaVerifiedAt: d(sess.mfaVerifiedAt),
    reauthenticatedAt: d(sess.reauthenticatedAt),
  };
}

/** The signed-in user for this request, from the session cookie only. */
export async function currentPrincipal(h?: Headers): Promise<Principal | null> {
  return (await currentSession(h))?.principal ?? null;
}

export async function requirePrincipal(h?: Headers): Promise<Principal> {
  const p = await currentPrincipal(h);
  if (!p) throw new AccessDenied(401, "Sign in to continue.");
  return p;
}

/** Better Auth's cookie name for `name` ("clearline.<name>", "__Secure-" prefixed on https). */
export function authCookieName(name: string): string {
  return `${(process.env.CLEARLINE_ORIGIN ?? "").startsWith("https://") ? "__Secure-" : ""}clearline.${name}`;
}

/** The value of a cookie Better Auth signed (`value.base64(HMAC-SHA256(secret, value))`), or null if unsigned/forged. */
export function readSignedCookie(h: Headers, name: string): string | null {
  const raw = h.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== authCookieName(name)) continue;
    let v: string;
    try { v = decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    const dot = v.lastIndexOf(".");
    if (dot <= 0) return null;
    const value = v.slice(0, dot), sig = Buffer.from(v.slice(dot + 1));
    const want = Buffer.from(createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(value).digest("base64"));
    return sig.length === want.length && timingSafeEqual(sig, want) ? value : null;
  }
  return null;
}

/** The user waiting for a second factor after a correct password (Better Auth's two_factor cookie), if any. */
export async function pendingSecondFactorUser(h: Headers): Promise<string | null> {
  const id = readSignedCookie(h, "two_factor");
  if (!id) return null;
  const v = await (await auth().$context).internalAdapter.findVerificationValue(id);
  if (!v || new Date(v.expiresAt).getTime() <= Date.now()) return null;
  return v.value;
}
