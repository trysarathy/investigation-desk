/**
 * RETIRED (2026-11-13, code review M10). The unversioned legacy test API ran on the old prototype
 * engine (float amounts, a weaker webhook verifier). Every method now returns HTTP 410 Gone with a
 * pointer to the versioned API, which runs on the unified engine in @/lib/clearline.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const gone = (_req?: unknown, _ctx?: unknown) =>
  NextResponse.json(
    {
      error: {
        code: "endpoint_retired",
        message: "This unversioned test endpoint has been retired. Use /api/clearline/test/v1 (see docs/clearline/openapi.yaml).",
        replacement: "/api/clearline/test/v1",
        help: "Test mode only. No money movement.",
      },
    },
    { status: 410, headers: { "Cache-Control": "no-store", "X-Clearline-Mode": "synthetic-test-only" } },
  );

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
