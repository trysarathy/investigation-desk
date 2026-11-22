import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
import { json, sameOriginOrNull } from "@/server/http";
import { signInAllowed, recordSignInResult } from "@/server/signin-limit";

// Better Auth's endpoints (sign-in, sign-out, session), behind our exact-Origin CSRF check and a per-ACCOUNT sign-in
// limit stored in PostgreSQL (shared by every instance; not keyed on any client-supplied header). Pilot only.
export const dynamic = "force-dynamic";
export const GET = (req: Request) => toNextJsHandler(auth()).GET(req);
export async function POST(req: Request): Promise<Response> {
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
