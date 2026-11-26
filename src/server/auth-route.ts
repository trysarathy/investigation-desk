import "server-only";
import { toNextJsHandler } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { auth, currentSession, pendingSecondFactorUser, type SessionInfo } from "./auth";
import { freshlyAuthenticated, TRUSTED_IP_HEADER } from "./auth-constants";
import { clientIp } from "./client-ip";
import { database } from "./db/client";
import { sessions } from "./db/schema";
import { json, sameOriginOrNull } from "./http";
import { clear, count, underLimit } from "./rate-limit";
import { recordSignInResult, signInAllowed } from "./signin-limit";

/**
 * Every request to /api/auth/* (v1 phase 1.2). In order:
 * 1. an ALLOW-LIST of Better Auth endpoints: anything else (sign-up, change-email, Better Auth's stateless e-mail
 *    verification, disabling two-factor without Clearline's checks, listing session tokens, …) is a 404;
 * 2. the exact-Origin CSRF check on every POST;
 * 3. the client address from TRUSTED configuration only (src/server/client-ip.ts), passed to Better Auth in a header
 *    the client cannot set (any client copy is removed);
 * 4. database-backed attempt limits per account and per address (src/server/rate-limit.ts, src/server/signin-limit.ts);
 * 5. after a successful second factor inside an existing session (a step-up), the session is stamped.
 */
const BASE = "/api/auth";
const MAX_BODY = 64 * 1024;
const tooMany = (message: string) => json(429, { error: { code: "TOO_MANY_ATTEMPTS", message } });
const notFound = () => json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
const GENERIC_RESET = { status: true, message: "If this address belongs to an account with a verified e-mail address, a reset link is on its way." };

const POST_ALLOWED = new Set([
  "/sign-in/email", "/sign-out",
  "/two-factor/enable", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/generate-backup-codes",
  "/request-password-reset", "/reset-password",
  "/clearline/passkey/register-options", "/clearline/passkey/register",
  "/clearline/passkey/sign-in-options", "/clearline/passkey/sign-in",
  "/clearline/passkey/step-up-options", "/clearline/passkey/step-up",
]);
const GET_ALLOWED = new Set(["/ok"]);
/** Second-factor checks: limited per account and per address; a success inside a session is a step-up. */
const MFA_CHECKS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/clearline/passkey/sign-in", "/clearline/passkey/step-up"]);

const endpoint = (req: Request) => {
  const p = new URL(req.url).pathname;
  return p.startsWith(`${BASE}/`) ? p.slice(BASE.length) : null;
};

/** A copy of the request with the trusted client-address header (and nothing the client claimed under that name). */
function forward(req: Request, body: string | null, ip: string | null): Request {
  const h = new Headers(req.headers);
  h.delete(TRUSTED_IP_HEADER);
  if (ip) h.set(TRUSTED_IP_HEADER, ip);
  return new Request(req.url, { method: req.method, headers: h, body: body ?? undefined });
}

async function readBody(req: Request): Promise<{ text: string; json: Record<string, unknown> } | Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json(413, { error: { code: "BODY_TOO_LARGE", message: "The request body is too large." } });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: { code: "BODY_TOO_LARGE", message: "The request body is too large." } });
  let parsed: unknown = {};
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
  return { text, json: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} };
}

export async function authGET(req: Request): Promise<Response> {
  const path = endpoint(req);
  if (!path || !GET_ALLOWED.has(path)) return notFound();
  return toNextJsHandler(auth()).GET(forward(req, null, clientIp(req.headers)));
}

export async function authPOST(req: Request): Promise<Response> {
  const path = endpoint(req);
  if (!path || !POST_ALLOWED.has(path)) return notFound();
  const refused = sameOriginOrNull(req);
  if (refused) return refused;
  const read = await readBody(req);
  if (read instanceof Response) return read;
  const ip = clientIp(req.headers);
  const call = (body: Record<string, unknown> | string = read.text) => toNextJsHandler(auth()).POST(forward(req, typeof body === "string" ? body : JSON.stringify(body), ip));

  if (path === "/sign-in/email") {
    const email = typeof read.json.email === "string" ? read.json.email : "";
    if (!(await underLimit("sign_in_ip", ip))) return tooMany("Too many failed sign-ins from this network. Try again in 15 minutes.");
    if (email && !(await signInAllowed(email))) return tooMany("Too many failed sign-ins for this account. Try again in 15 minutes.");
    const res = await call();
    if (email) await recordSignInResult(email, res.status === 200);
    if (res.status !== 200) await count("sign_in_ip", ip);
    return res;
  }

  if (path === "/request-password-reset") {
    // Over either limit the person sees nothing different about the account: the address limit says so plainly
    // (it reveals nothing about any account), the account limit answers exactly as a normal request does.
    if (!(await underLimit("reset_request_ip", ip))) return tooMany("Too many reset requests from this network. Try again in an hour.");
    await count("reset_request_ip", ip);
    const email = typeof read.json.email === "string" ? read.json.email.trim().toLowerCase() : "";
    if (!email || email.length > 254) return json(400, { error: { code: "INVALID_EMAIL", message: "Enter your e-mail address." } });
    const accountOk = await underLimit("reset_request_account", email);
    await count("reset_request_account", email);
    if (accountOk) {
      const res = await call({ email });
      if (res.status === 429) return res;
      if (res.status !== 200) return json(400, { error: { code: "INVALID_EMAIL", message: "Enter your e-mail address." } });
    }
    return json(200, GENERIC_RESET);
  }

  if (path === "/reset-password") {
    if (!(await underLimit("reset_submit_ip", ip))) return tooMany("Too many attempts. Try again in 15 minutes.");
    const res = await call({ token: read.json.token, newPassword: read.json.newPassword });
    if (res.status !== 200) await count("reset_submit_ip", ip);
    return res;
  }

  // Everything below acts for a known user: the session's, or the one waiting for a second factor.
  const session = await currentSession(req.headers);

  if (path === "/two-factor/enable" || path === "/two-factor/generate-backup-codes") {
    if (!session) return json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    // These take the password: the per-account password limit applies, so a stolen session cannot guess it.
    if (!(await signInAllowed(session.principal.email))) return tooMany("Too many wrong passwords for this account. Try again in 15 minutes.");
    if (path === "/two-factor/generate-backup-codes" && !freshlyAuthenticated(session)) return json(403, { error: { code: "REAUTHENTICATION_REQUIRED", message: "Confirm it is you first." } });
    const body = path === "/two-factor/enable" ? { password: read.json.password, method: "totp" } : { password: read.json.password };
    const res = await call(body);
    const wrongPassword = res.status === 400 && /INVALID_PASSWORD/.test(await res.clone().text());
    if (wrongPassword) await recordSignInResult(session.principal.email, false);
    return res;
  }

  if (MFA_CHECKS.has(path)) {
    const userId = session?.principal.userId ?? (path === "/clearline/passkey/sign-in" || path.startsWith("/two-factor/") ? await pendingSecondFactorUser(req.headers) : null);
    if (!userId) return json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in with your password first." } });
    if (!(await underLimit("mfa_account", userId)) || !(await underLimit("mfa_ip", ip))) return tooMany("Too many failed attempts. Try again in 15 minutes.");
    let body: Record<string, unknown> | string = read.text;
    if (path === "/two-factor/verify-totp" || path === "/two-factor/verify-backup-code") {
      const code = typeof read.json.code === "string" ? read.json.code.trim() : "";
      // A TOTP code is accepted once: a code seen (stolen, shoulder-surfed) is useless for the rest of its window.
      if (path === "/two-factor/verify-totp" && !(await underLimit("totp_used", `${userId}:${code}`))) {
        await count("mfa_account", userId); await count("mfa_ip", ip);
        return json(401, { code: "INVALID_CODE", message: "Invalid code" });
      }
      body = { code }; // never "trust this device"
    }
    const res = await call(body);
    if (res.status === 200) {
      await clear("mfa_account", userId);
      if (path === "/two-factor/verify-totp") await count("totp_used", `${userId}:${typeof read.json.code === "string" ? read.json.code.trim() : ""}`);
      if (session) await stampStepUp(session);
    } else if (res.status !== 429) {
      await count("mfa_account", userId);
      await count("mfa_ip", ip);
    }
    return res;
  }

  return call();
}

/** A second factor proved inside a session: the session is MFA-verified and freshly re-authenticated. */
async function stampStepUp(s: SessionInfo): Promise<void> {
  const now = new Date();
  await database().update(sessions).set({ mfaVerifiedAt: now, reauthenticatedAt: now }).where(eq(sessions.id, s.sessionId));
}
