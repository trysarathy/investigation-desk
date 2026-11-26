// Deployment gates and the per-request Content-Security-Policy.
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

/** Reads CLEARLINE_CUSTOMER_PREVIEW, CLEARLINE_FUNDING_ONLY, PREVIEW_USER, PREVIEW_PASSWORD and CLEARLINE_PUBLIC_STATUS (process.env fits). */
export type GateEnv = Readonly<Record<string, string | undefined>>;

/** What the deployment gates decide for one request. Pure: no I/O, no clock, no randomness. */
export type GateDecision =
  /** Serve it. `consoleShell`: render with the bare console layout (customer preview, console, mentor demo). */
  | { action: "next"; consoleShell: boolean }
  | { action: "redirect"; location: "/clearline" | "/control" }
  /** `noStore`: the customer-preview 404 carries Cache-Control: no-store; the funding-only 404 does not. */
  | { action: "not_found"; noStore: boolean }
  | { action: "unauthorized" };

const isConsolePath = (p: string) => p === "/mentor-demo" || p === "/clearline" || p.startsWith("/clearline/");

const isPilotPath = (p: string) =>
  p === "/control" || p.startsWith("/control/") || p.startsWith("/api/control/") || p === "/api/control" || p.startsWith("/api/auth/");

/**
 * v1 phase 5.5: the uptime checks and the public status page (src/server/ops). They show ok/fail per component and the
 * operator's incident notes, nothing else. APPROVAL-ONLY (v1 E4): they are served past every gate below ONLY when
 * CLEARLINE_PUBLIC_STATUS=1; unset, every deployment treats them exactly as before (the pilot answers 404).
 */
export const PUBLIC_STATUS_PATHS: readonly string[] = ["/api/health", "/api/ready", "/status"];

/** v1: the three fictional sample files a pilot customer may download (public/samples/); exact paths only. */
export const PILOT_SAMPLE_FILES: ReadonlySet<string> = new Set([
  "/samples/kestrelbay-sample-provider-settlement-report.csv",
  "/samples/kestrelbay-sample-bank-statement.csv",
  "/samples/kestrelbay-sample-invoices-orders.csv",
]);

export function deploymentGate(pathname: string, authorization: string | null, env: GateEnv): GateDecision {
  if (env.CLEARLINE_PUBLIC_STATUS === "1" && PUBLIC_STATUS_PATHS.includes(pathname)) return { action: "next", consoleShell: true };
  // rc5 private staging: Clearline Control with real sign-in and PostgreSQL. A pilot deployment serves ONLY the pilot
  // (no public sandbox, no legacy app), and every other deployment refuses the pilot paths, so the authenticated
  // product and the fictional public demo never share a surface, a cookie or a session.
  if (env.CLEARLINE_CONTROL_PILOT === "1") {
    if (pathname === "/") return { action: "redirect", location: "/control" };
    const allowed = isPilotPath(pathname) || pathname === "/favicon.ico" || pathname === "/icon.svg" || pathname.startsWith("/_next/") || PILOT_SAMPLE_FILES.has(pathname);
    return allowed ? { action: "next", consoleShell: true } : { action: "not_found", noStore: true };
  }
  if (isPilotPath(pathname)) return { action: "not_found", noStore: true };
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

// ---- R2: nonce-based Content-Security-Policy ----------------------------------------------------
// Directives other than script-src are identical to the static fallback policy in next.config.mjs
// (a test checks this). v1 E1 tightening: style ELEMENTS are 'self' only (no 'unsafe-inline'); only style
// ATTRIBUTES keep 'unsafe-inline' via style-src-attr, because React renders `style={...}` props as inline
// style attributes in the server HTML, which a nonce cannot cover. A style attribute cannot run script.
// base-uri is 'none' (nothing uses <base>), and frame-src/worker-src/manifest-src are pinned explicitly.
export function nonceContentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== "production"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    ...sharedCspDirectives(dev),
  ].join("; ");
}

/** Every directive but default-src and script-src; next.config.mjs builds the same list (a test checks they agree). */
function sharedCspDirectives(dev: boolean): string[] {
  return [
    // Development keeps 'unsafe-inline' for styles: Next's dev overlay and React Refresh inject <style> elements.
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * A Control page that needs a signed-in member: everything under /control except the sign-in page and (v1 phase 1.1)
 * the invitation page, whose one-time token is the proof (the person has no account yet).
 */
const PUBLIC_CONTROL_PAGES = ["/control/sign-in", "/control/invite"];
export const isControlPage = (p: string) => (p === "/control" || p.startsWith("/control/")) && !PUBLIC_CONTROL_PAGES.some((x) => p === x || p.startsWith(`${x}/`));

/** Better Auth's session cookie for the pilot (cookiePrefix "clearline"; "__Secure-" prefixed on https). */
const hasSessionCookie = (req: NextRequest) => req.cookies.has("clearline.session_token") || req.cookies.has("__Secure-clearline.session_token");

export function middleware(req: NextRequest) {
  const decision = deploymentGate(req.nextUrl.pathname, req.headers.get("authorization"), process.env);
  const refused = gateResponse(decision, req.url);
  if (refused) return refused;
  // rc5 Clearline Control: a Control page requested without any session cookie is a real 307 to sign-in, before the
  // root loading boundary starts streaming (a redirect from inside a streamed page would be a 200 plus a client-side
  // redirect). This is only a fast path: every page and API route still validates the session against the database.
  if (process.env.CLEARLINE_CONTROL_PILOT === "1" && isControlPage(req.nextUrl.pathname) && !hasSessionCookie(req)) {
    return NextResponse.redirect(new URL("/control/sign-in", req.url), 307);
  }
  if (decision.action !== "next") return NextResponse.next(); // unreachable: gateResponse handled it
  const nonce = newNonce();
  const csp = nonceContentSecurityPolicy(nonce);
  const h = new Headers(req.headers);
  if (decision.consoleShell) h.set("x-clearline-mentor-demo-route", "1");
  // Next reads the nonce from the request's CSP header and puts it on its own scripts; the root layout
  // reads x-nonce for its inline theme script.
  h.set("x-nonce", nonce);
  h.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: h } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// QA L1: exclusions are anchored, so lookalike paths (/favicon.icox, /_next/imagex) still pass through the middleware.
// QA L3: /api/clearline/test/v1/<segments> and /api/clearline/test/<segment> are excluded ONLY when every segment is
// [A-Za-z0-9_-]+ (no dots, no percent-encoding, no empty segments). Such a path can only be routed to the v1
// catch-all or the retired legacy route, which run deploymentGate() themselves. Anything else (an encoded or
// dotted path that Next might normalise to another route) still goes through this middleware.
export const TEST_API_EXCLUSION = "api/clearline/test/v1/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$|api/clearline/test/[A-Za-z0-9_-]+$";
export const config = { matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$|api/clearline/test/v1/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$|api/clearline/test/[A-Za-z0-9_-]+$).*)"] };
