import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
import { json, sameOriginOrNull } from "@/server/http";
import { signInAllowed, recordSignInResult } from "@/server/signin-limit";

// Better Auth's endpoints (sign-in, sign-out, session), behind our exact-Origin CSRF check and a per-ACCOUNT sign-in
// limit stored in PostgreSQL (shared by every instance; not keyed on any client-supplied header). Pilot only.
export const dynamic = "force-dynamic";

/**
 * v1 phase 1.1: invite-only. Better Auth is configured with `disableSignUp`; on top of that every sign-up path is
 * refused HERE, before Better Auth sees it, on every method (a later library default or plugin cannot reopen it).
 * New people join only by accepting an invitation (/control/invite) or through the operator's CLI.
 */
const SIGN_UP = /(^|\/)sign-?up(\/|$)/i;
const decoded = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
const signUpRefused = (req: Request) => (SIGN_UP.test(decoded(new URL(req.url).pathname))
  ? json(404, { error: { code: "NOT_FOUND", message: "There is no sign-up. Ask your organisation's admin for an invitation." } }) : null);

export const GET = (req: Request) => signUpRefused(req) ?? toNextJsHandler(auth()).GET(req);
export async function POST(req: Request): Promise<Response> {
  const closed = signUpRefused(req);
  if (closed) return closed;
  const refused = sameOriginOrNull(req);
  if (refused) return refused;
  if (!new URL(req.url).pathname.endsWith("/sign-in/email")) return toNextJsHandler(auth()).POST(req);
  let email = "";
  try { email = String(((await req.clone().json()) as { email?: unknown }).email ?? ""); } catch { /* Better Auth rejects it */ }
  if (email && !(await signInAllowed(email))) {
    return json(429, { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many failed sign-ins for this account. Try again in 15 minutes." } });
  }
  const res = await toNextJsHandler(auth()).POST(req);
  if (email) await recordSignInResult(email, res.status === 200);
  return res;
}
