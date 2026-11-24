import "server-only";
import { auth } from "./auth";
import { ORG_COOKIE, jsonBody } from "./control-http";
import { errorResponse, json, sameOriginOrNull } from "./http";
import { demoBuild } from "./demo-build";
import { DemoSwitchRefused, sessionCookie, switchDemoUser } from "./demo-switch";
import { DEMO_DATA_LABEL } from "@/lib/clearline/data-mode";

/**
 * POST /api/control/demo/switch {"email": "approver@northwind.demo"} (demo build only; the route answers 404 in any
 * other build before this is loaded). Exact Origin first, as for every mutation; then the caller's own session (from
 * the cookie only). Answers with the new session cookie (signed as Better Auth signs it), clears the organisation
 * cookie, and says where the new user lands. See src/server/demo-switch.ts for who may switch.
 */
export async function demoSwitchRequest(req: Request): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    if (!demoBuild()) return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
    const s = await auth().api.getSession({ headers: req.headers });
    if (!s) return json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    const body = (await jsonBody(req)) as { email?: unknown } | null;
    const r = await switchDemoUser({ userId: s.user.id, name: s.user.name, email: s.user.email }, s.session.id, body?.email);
    const res = json(200, { label: DEMO_DATA_LABEL, signedInAs: { email: r.email, name: r.name, role: r.role }, next: r.next });
    res.headers.append("Set-Cookie", await sessionCookie(r.token));
    res.headers.append("Set-Cookie", `${ORG_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`);
    return res;
  } catch (e) {
    if (e instanceof DemoSwitchRefused) return json(e.status, { error: { code: e.code, message: e.message } });
    return errorResponse(e);
  }
}
