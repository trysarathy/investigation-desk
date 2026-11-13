// Deployment gates.
//
// Gates (unchanged semantics, now one pure function shared with the test-API routes):
// - CLEARLINE_CUSTOMER_PREVIEW=1: an allow-list (only the console, /mentor-demo, the test API and assets).
// - /clearline and /mentor-demo: the synthetic console and mentor demo, never behind the gates below.
// - CLEARLINE_FUNDING_ONLY=1: only the funding desk and assets; everything else is a plain 404.
// - PREVIEW_USER + PREVIEW_PASSWORD: HTTP Basic auth on every other page and API route (a gate for a
//   demo link, not the week 5 login). Unset, nothing changes.
//
// QA L3 (rc3): /api/clearline/test/** is excluded from the matcher below so Next never clones or drains
// its request bodies (middlewareClientMaxBodySize is 21 MB for the legacy upload routes). Those routes
// call deploymentGate() + gateResponse() themselves, before reading any body, so the gates cannot drift.

import { NextResponse, type NextRequest } from "next/server";

// Compares every character so the time taken doesn't reveal how much of a guess was right.
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

/** Reads CLEARLINE_CUSTOMER_PREVIEW, CLEARLINE_FUNDING_ONLY, PREVIEW_USER and PREVIEW_PASSWORD (process.env fits). */
export type GateEnv = Readonly<Record<string, string | undefined>>;

/** What the deployment gates decide for one request. Pure: no I/O, no clock, no randomness. */
export type GateDecision =
  /** Serve it. `consoleShell`: render with the bare console layout (customer preview, console, mentor demo). */
  | { action: "next"; consoleShell: boolean }
  | { action: "redirect"; location: "/clearline" }
  /** `noStore`: the customer-preview 404 carries Cache-Control: no-store; the funding-only 404 does not. */
  | { action: "not_found"; noStore: boolean }
  | { action: "unauthorized" };

const isConsolePath = (p: string) => p === "/mentor-demo" || p === "/clearline" || p.startsWith("/clearline/");

export function deploymentGate(pathname: string, authorization: string | null, env: GateEnv): GateDecision {
  if (env.CLEARLINE_CUSTOMER_PREVIEW === "1") {
    if (pathname === "/") return { action: "redirect", location: "/clearline" };
    const allowed = pathname === "/clearline" || pathname.startsWith("/clearline/") ||
      pathname === "/mentor-demo" || pathname.startsWith("/api/clearline/test/") ||
      pathname === "/favicon.ico" || pathname === "/icon.svg" || pathname.startsWith("/_next/");
    // QA L1: every allowed request in the customer preview renders with the console layout, so a
    // 404 for an allowed-prefix lookalike (e.g. /_next/imagex) can never show the legacy app shell.
    return allowed ? { action: "next", consoleShell: true } : { action: "not_found", noStore: true };
  }
  // Self-contained, synthetic-only mentor demonstration. It neither touches
  // the private funding store nor exposes the real approval API.
  if (isConsolePath(pathname)) return { action: "next", consoleShell: true };
  if (env.CLEARLINE_FUNDING_ONLY === "1") {
    const ok = ["/", "/funding", "/api/funding", "/icon.svg", "/favicon.ico"].includes(pathname) || pathname.startsWith("/_next/");
    return ok ? { action: "next", consoleShell: false } : { action: "not_found", noStore: false };
  }
  const user = env.PREVIEW_USER;
  const password = env.PREVIEW_PASSWORD;
  if (!user || !password) return { action: "next", consoleShell: false };
  // The sender's payment page is customer-facing: it carries its own unguessable link ID.
  if (pathname.startsWith("/pay/")) return { action: "next", consoleShell: false };
  const header = authorization ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { /* malformed: ask again */ }
    const i = decoded.indexOf(":");
    if (i >= 0 && same(decoded.slice(0, i), user) && same(decoded.slice(i + 1), password)) return { action: "next", consoleShell: false };
  }
  return { action: "unauthorized" };
}

/** The response for a refused request, or null when the request may proceed. Same bytes from middleware and routes. */
export function gateResponse(decision: GateDecision, requestUrl: string): Response | null {
  switch (decision.action) {
    case "next": return null;
    case "redirect": return NextResponse.redirect(new URL(decision.location, requestUrl));
    case "not_found": return decision.noStore
      ? new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })
      : new NextResponse("Not found", { status: 404 });
    case "unauthorized": return new NextResponse("Sign in to view this preview.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Investigation Desk preview", charset="UTF-8"' },
    });
  }
}

export function middleware(req: NextRequest) {
  const decision = deploymentGate(req.nextUrl.pathname, req.headers.get("authorization"), process.env);
  const refused = gateResponse(decision, req.url);
  if (refused) return refused;
  if (decision.action !== "next" || !decision.consoleShell) return NextResponse.next();
  const h = new Headers(req.headers);
  h.set("x-clearline-mentor-demo-route", "1");
  return NextResponse.next({ request: { headers: h } });
}

// QA L1: exclusions are anchored, so lookalike paths (/favicon.icox, /_next/imagex) still pass through the middleware.
// QA L3: /api/clearline/test/v1/<segments> and /api/clearline/test/<segment> are excluded ONLY when every segment is
// [A-Za-z0-9_-]+ (no dots, no percent-encoding, no empty segments). Such a path can only be routed to the v1
// catch-all or the retired legacy route, which run deploymentGate() themselves. Anything else (an encoded or
// dotted path that Next might normalise to another route) still goes through this middleware.
export const TEST_API_EXCLUSION = "api/clearline/test/v1/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$|api/clearline/test/[A-Za-z0-9_-]+$";
export const config = { matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$|api/clearline/test/v1/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$|api/clearline/test/[A-Za-z0-9_-]+$).*)"] };
