import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers as nextHeaders } from "next/headers";
import { database } from "./db/client";
import * as schema from "./db/schema";
import type { Principal } from "./tenant";
import { AccessDenied } from "./tenant";

/** Session lifetime: absolute 8 h, refreshed at most hourly while in use. Revocation = deleting the session row. */
export const SESSION_SECONDS = 8 * 60 * 60;

function build() {
  const origin = process.env.CLEARLINE_ORIGIN;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!origin || !secret || secret.length < 32) throw new Error("CLEARLINE_ORIGIN and BETTER_AUTH_SECRET (≥ 32 chars) are required for Clearline Control sign-in");
  return betterAuth({
    appName: "Clearline Control",
    baseURL: origin,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [origin],
    database: drizzleAdapter(database(), { provider: "pg", usePlural: true, schema }),
    // Accounts are created by an administrator (scripts/control/admin.ts); there is no public sign-up.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: 60 * 60,
      // No cookie cache: every request checks the session row, so a revoked session stops working immediately.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { "/sign-in/email": { window: 15 * 60, max: 5 } },
    },
    advanced: {
      cookiePrefix: "clearline",
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      // Better Auth skips its origin check under NODE_ENV=test by default; keep it on everywhere (tests = deployment).
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof build>;
declare global { var __clearlineAuth: Auth | undefined }

export function auth(): Auth {
  return (globalThis.__clearlineAuth ??= build());
}

/** The signed-in user for this request, from the session cookie only. */
export async function currentPrincipal(h?: Headers): Promise<Principal | null> {
  const s = await auth().api.getSession({ headers: h ?? (await nextHeaders()) });
  if (!s) return null;
  return { userId: s.user.id, name: s.user.name, email: s.user.email };
}

export async function requirePrincipal(h?: Headers): Promise<Principal> {
  const p = await currentPrincipal(h);
  if (!p) throw new AccessDenied(401, "Sign in to continue.");
  return p;
}
