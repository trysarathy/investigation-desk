import "server-only";
import { tenantFrom } from "./control-http";
import { errorResponse, json, sameOriginOrNull } from "./http";
import { orgDataMode } from "./chain-verify";
import { demoBuild } from "./demo-build";
import { DemoResetRefused, demoResetConfigFromEnv, resetDemoDatabase } from "./demo-reset";
import { DEMO_DATA_LABEL } from "@/lib/clearline/data-mode";

/**
 * POST /api/control/demo/reset (demo build only; the route answers 404 in any other build before this is loaded).
 * Who may reset: any signed-in member of a DEMO organisation (data_mode 'demo'), whatever their role, because every
 * demo login is a presenter's and the data is fictional [ASSUMPTION, documented in docs/demo/DEMO_RUNBOOK.md]. A
 * member of a live or sample organisation gets 404. The exact-Origin check comes first, as for every mutation.
 *
 * The reset ends the app's own connections too; the pool drops them (src/server/db/client.ts) and opens new ones on
 * the next request. The pool itself is NOT closed: Better Auth holds the same pool, and a closed pool cannot be
 * reopened. The seeded state has no sign-in sessions, so the presenter signs in again.
 */
let running = false;
const MARKER = "clearline-demo[demo-build-only]";

export async function demoResetRequest(req: Request): Promise<Response> {
  const csrf = sameOriginOrNull(req);
  if (csrf) return csrf;
  try {
    if (!demoBuild()) return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
    const ctx = await tenantFrom(req);
    if ((await orgDataMode(ctx)) !== "demo") return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
    if (running) return json(409, { error: { code: "DEMO_RESET_RUNNING", message: "A reset is already running." } });
    running = true;
    try {
      const cfg = demoResetConfigFromEnv();
      const r = await resetDemoDatabase(cfg);
      console.log(JSON.stringify({ event: "demo_reset", ms: r.ms, marker: MARKER }));
      return json(200, { label: DEMO_DATA_LABEL, reset: true, ms: r.ms, next: "/control/sign-in" });
    } finally { running = false; }
  } catch (e) {
    if (e instanceof DemoResetRefused) return json(409, { error: { code: e.code, message: e.message } });
    return errorResponse(e);
  }
}
