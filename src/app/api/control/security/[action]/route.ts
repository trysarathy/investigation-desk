import { z } from "zod";
import { disableMfa, passwordStepUp, removePasskey, revokeMyOtherSessions, revokeMySession, setOrgMfaPolicy } from "@/server/account-security";
import { clientIp } from "@/server/client-ip";
import { jsonBody, mutateOwnSecurity, sessionFrom, tenantFrom, idempotencyKeyFrom } from "@/server/control-http";
import { sendVerificationEmail, verifyEmailToken } from "@/server/email-verification";
import { errorResponse, json, sameOriginOrNull } from "@/server/http";

export const dynamic = "force-dynamic";

const Id = z.object({ id: z.string().max(64) }).strict();
const Password = z.object({ password: z.string().max(128) }).strict();
const Token = z.object({ token: z.string().max(100) }).strict();
const Empty = z.object({}).strict();

/**
 * POST /api/control/security/<action> — the caller's own sign-in security (src/server/account-security.ts):
 *   revoke-session {id} · revoke-other-sessions · step-up {password} · disable-mfa · remove-passkey {id}
 *   send-verification-email · verify-email {token} (no session needed: the single-use token is the proof)
 *   org-mfa-policy {requireMfaAll} (an Admin, for the selected organisation; behind the MFA gate)
 */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const ip = clientIp(req.headers);
  switch (action) {
    case "revoke-session": return mutateOwnSecurity(req, async (s, b) => { await revokeMySession(s, Id.parse(b).id); return json(200, { ok: true }); });
    case "revoke-other-sessions": return mutateOwnSecurity(req, async (s, b) => { Empty.parse(b); return json(200, { revoked: await revokeMyOtherSessions(s) }); });
    case "step-up": return mutateOwnSecurity(req, async (s, b) => { await passwordStepUp(s, Password.parse(b).password); return json(200, { ok: true }); });
    case "disable-mfa": return mutateOwnSecurity(req, async (s, b) => { Empty.parse(b); await disableMfa(s); return json(200, { ok: true }); });
    case "remove-passkey": return mutateOwnSecurity(req, async (s, b) => { await removePasskey(s, Id.parse(b).id); return json(200, { ok: true }); });
    case "send-verification-email": return mutateOwnSecurity(req, async (s, b) => { Empty.parse(b); await sendVerificationEmail(s.principal, ip); return json(200, { ok: true }); });
    case "verify-email": {
      const csrf = sameOriginOrNull(req);
      if (csrf) return csrf;
      try {
        idempotencyKeyFrom(req);
        await verifyEmailToken(Token.parse(await jsonBody(req)).token, ip);
        return json(200, { ok: true });
      } catch (e) { return errorResponse(e); }
    }
    case "org-mfa-policy": {
      const csrf = sameOriginOrNull(req);
      if (csrf) return csrf;
      try {
        const s = await sessionFrom(req);
        const ctx = await tenantFrom(req);
        idempotencyKeyFrom(req);
        return json(200, await setOrgMfaPolicy(ctx, s, await jsonBody(req)));
      } catch (e) { return errorResponse(e); }
    }
    default: return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  }
}
