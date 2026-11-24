import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Demo build only (src/server/demo-build.ts): reset the demo to its seeded state. In any other build this answers 404
 * and nothing else is in the bundle: the condition is the inlined build constant, so the bundler drops the import.
 */
export async function POST(req: Request): Promise<Response> {
  if (!(process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false)) return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  const { demoResetRequest } = await import("@/server/demo-reset-http");
  return demoResetRequest(req);
}
