import "server-only";
import { NextResponse } from "next/server";
import { AccessDenied } from "./tenant";
import { RequestRefused } from "./errors";
import { ZodError } from "zod";

/**
 * CSRF defence for every state-changing request to /api/auth and /api/control: the Origin header must be exactly the
 * pilot's origin (CLEARLINE_ORIGIN). Session cookies are also SameSite=Strict. Requests without an Origin are refused
 * (browsers send Origin on every cross-origin and same-origin POST/PUT/PATCH/DELETE).
 */
export function sameOriginOrNull(req: Request): Response | null {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return null;
  const expected = process.env.CLEARLINE_ORIGIN;
  const origin = req.headers.get("origin");
  if (!expected || origin !== expected) return json(403, { error: { code: "CSRF_ORIGIN", message: "Cross-origin request refused." } });
  return null;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Maps refusals to HTTP without leaking internals; unexpected errors are logged server-side without request data. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AccessDenied) return json(e.status, { error: { code: e.status === 401 ? "UNAUTHENTICATED" : e.status === 403 ? "FORBIDDEN" : "NOT_FOUND", message: e.message } });
  if (e instanceof RequestRefused) return json(e.status, { error: { code: e.code, message: e.message, ...(e.choices ? { choices: e.choices } : {}) } });
  if (e instanceof ZodError) return json(400, { error: { code: "INVALID_REQUEST", message: "The request is not valid.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } });
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === "23514" || cause?.code === "23505" || cause?.code === "23503" || cause?.code === "42501") return json(409, { error: { code: "REFUSED_BY_DATABASE", message: "The database refused this change." } });
  console.error("clearline-control: unexpected error", e instanceof Error ? e.name : typeof e);
  return json(500, { error: { code: "INTERNAL", message: "Something went wrong. Nothing was changed." } });
}
