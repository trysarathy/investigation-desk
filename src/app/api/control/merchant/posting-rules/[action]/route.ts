import { revokePostingRulesSignature, signPostingRules } from "@/server/posting-rules";
import { idempotencyKeyFrom, jsonBody, sessionFrom, tenantFrom } from "@/server/control-http";
import { errorResponse, json, sameOriginOrNull } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/control/merchant/posting-rules/sign {version, sha256} · /revoke {signatureId, reason}. A merchant Admin with
 * access to every entity, after a second-factor step-up in the last 10 minutes (the service checks both; the database
 * checks the Admin again). Exact Origin, session, organisation (behind the MFA gate), Idempotency-Key, JSON body.
 */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "sign" && action !== "revoke") return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    const s = await sessionFrom(req);
    const ctx = await tenantFrom(req);
    idempotencyKeyFrom(req);
    const body = await jsonBody(req);
    return json(200, action === "sign" ? await signPostingRules(ctx, s, body) : await revokePostingRulesSignature(ctx, s, body));
  } catch (e) { return errorResponse(e); }
}
