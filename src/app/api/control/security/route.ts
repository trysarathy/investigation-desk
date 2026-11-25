import { listMySessions, securityStatus } from "@/server/account-security";
import { sessionFrom } from "@/server/control-http";
import { errorResponse, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The caller's own sign-in security: MFA, passkeys, e-mail verification and sessions (no session tokens, no addresses). */
export async function GET(req: Request) {
  try {
    const s = await sessionFrom(req);
    const [status, sessions] = await Promise.all([securityStatus(s), listMySessions(s)]);
    return json(200, { ...status, sessions });
  } catch (e) { return errorResponse(e); }
}
