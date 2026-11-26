import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Demo build only (src/server/demo-build.ts): save a presenter's feedback note (src/server/demo-feedback.ts). In any
 * other build this answers 404 and nothing else is in the bundle: the condition is the inlined build constant and the
 * import sits INSIDE the branch, so the bundler drops it (scripts/build/check-chain-recording.mjs --marker demo).
 */
export async function POST(req: Request): Promise<Response> {
  if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {
    const { demoFeedbackRequest } = await import("@/server/demo-feedback-http");
    return demoFeedbackRequest(req);
  }
  return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
}
