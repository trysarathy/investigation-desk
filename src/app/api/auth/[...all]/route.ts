import { authGET, authPOST } from "@/server/auth-route";
import { json } from "@/server/http";

// Better Auth's endpoints behind Clearline's allow-list, exact-Origin CSRF check, trusted client address and
// database-backed attempt limits per account and per address (src/server/auth-route.ts).
export const dynamic = "force-dynamic";

/**
 * v1 phase 1.1: invite-only. Better Auth is configured with `disableSignUp`; on top of that every sign-up path is
 * refused HERE, before Better Auth sees it, on every method (a later library default or plugin cannot reopen it).
 * New people join only by accepting an invitation (/control/invite) or through the operator's CLI.
 * (Integration, wave 1: kept in front of phase 1.2's endpoint allow-list, which also refuses sign-up.)
 */
const SIGN_UP = /(^|\/)sign-?up(\/|$)/i;
const decoded = (p: string) => { try { return decodeURIComponent(p); } catch { return p; } };
const signUpRefused = (req: Request) => (SIGN_UP.test(decoded(new URL(req.url).pathname))
  ? json(404, { error: { code: "NOT_FOUND", message: "There is no sign-up. Ask your organisation's admin for an invitation." } }) : null);

export const GET = (req: Request) => signUpRefused(req) ?? authGET(req);
export const POST = (req: Request) => signUpRefused(req) ?? authPOST(req);
