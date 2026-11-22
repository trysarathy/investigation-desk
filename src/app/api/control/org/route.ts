import { z } from "zod";
import { ORG_COOKIE, idempotencyKeyFrom, jsonBody, principalFrom } from "@/server/control-http";
import { errorResponse, json, sameOriginOrNull } from "@/server/http";
import { resolveTenant } from "@/server/tenant";

export const dynamic = "force-dynamic";

const Selection = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/) }).strict();

const cookie = (value: string, maxAge: number) => {
  const secure = (process.env.CLEARLINE_ORIGIN ?? "").startsWith("https://") ? "; Secure" : "";
  return `${ORG_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
};

/**
 * Select the organisation for this browser. The slug is checked against the signed-in user's OWN active memberships:
 * a foreign or unknown organisation is a 404 and no cookie is set. The cookie remains a selection only; every
 * request resolves it against the memberships again.
 */
export async function POST(req: Request) {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    const p = await principalFrom(req);
    idempotencyKeyFrom(req);
    const { slug } = Selection.parse(await jsonBody(req));
    const ctx = await resolveTenant(p, slug);
    return json(200, { org: { slug: ctx.orgSlug, name: ctx.orgName }, role: ctx.role }, { "Set-Cookie": cookie(ctx.orgSlug, 60 * 60 * 24 * 30) });
  } catch (e) { return errorResponse(e); }
}

/** Clear the selection (used on sign-out). Needs no session: only the exact Origin and an Idempotency-Key. */
export async function DELETE(req: Request) {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try { idempotencyKeyFrom(req); } catch (e) { return errorResponse(e); }
  return json(200, { ok: true }, { "Set-Cookie": cookie("", 0) });
}
