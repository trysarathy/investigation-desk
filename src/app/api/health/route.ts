import { healthResponse } from "@/server/ops/health";

// v1 phase 5.5: liveness (src/server/ops/health.ts). No detail beyond ok/fail per check.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return healthResponse();
}
