import { readyResponse } from "@/server/ops/health";

// v1 phase 5.5: readiness (database + job worker heartbeat; src/server/ops/health.ts). No detail beyond ok/fail.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return readyResponse();
}
