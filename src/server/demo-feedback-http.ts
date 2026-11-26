import "server-only";
import { jsonBody, tenantFrom } from "./control-http";
import { errorResponse, json, sameOriginOrNull } from "./http";
import { demoBuild } from "./demo-build";
import { DemoFeedbackRefused, saveDemoFeedback } from "./demo-feedback";
import { DEMO_DATA_LABEL } from "@/lib/clearline/data-mode";

/**
 * POST /api/control/demo/feedback {"screen", "route", "note"} (demo build only; the route answers 404 in any other
 * build before this is loaded). Exact Origin first, as for every mutation; then the session and the organisation; a
 * member of a live or sample organisation gets 404. See src/server/demo-feedback.ts.
 */
export async function demoFeedbackRequest(req: Request): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    if (!demoBuild()) return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
    const ctx = await tenantFrom(req);
    const saved = await saveDemoFeedback(ctx, await jsonBody(req));
    return json(201, { label: DEMO_DATA_LABEL, saved });
  } catch (e) {
    if (e instanceof DemoFeedbackRefused) return json(e.status, { error: { code: e.code, message: e.message } });
    return errorResponse(e);
  }
}
