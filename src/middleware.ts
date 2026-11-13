// Optional password on a shared preview. Set PREVIEW_USER and PREVIEW_PASSWORD on the host and
// every page and API route asks for them (HTTP Basic auth). Unset, nothing changes. This is a
// gate for a demo link, not the week 5 login.

import { NextResponse, type NextRequest } from "next/server";

// Compares every character so the time taken doesn't reveal how much of a guess was right.
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  if (process.env.CLEARLINE_CUSTOMER_PREVIEW === "1") {
    const path = req.nextUrl.pathname;
    if (path === "/") return NextResponse.redirect(new URL("/clearline", req.url));
    const allowed = path === "/clearline" || path.startsWith("/clearline/") ||
      path === "/mentor-demo" || path.startsWith("/api/clearline/test/") ||
      path === "/favicon.ico" || path === "/icon.svg" || path.startsWith("/_next/");
    if (!allowed) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    // QA L1: every allowed request in the customer preview renders with the console layout, so a
    // 404 for an allowed-prefix lookalike (e.g. /_next/imagex) can never show the legacy app shell.
    // The allow-list itself (what is allowed vs 404) is unchanged.
    const h = new Headers(req.headers);
    h.set("x-clearline-mentor-demo-route", "1");
    return NextResponse.next({ request: { headers: h } });
  }
  // Self-contained, synthetic-only mentor demonstration. It neither touches
  // the private funding store nor exposes the real approval API.
  if (req.nextUrl.pathname === "/mentor-demo" || req.nextUrl.pathname === "/clearline" || req.nextUrl.pathname.startsWith("/clearline/")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-clearline-mentor-demo-route", "1");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  if(process.env.CLEARLINE_FUNDING_ONLY === '1') {
    const p=req.nextUrl.pathname;
    if(!['/','/funding','/api/funding','/icon.svg','/favicon.ico'].includes(p)&&!p.startsWith('/_next/')) return new NextResponse('Not found',{status:404});
    return NextResponse.next();
  }
  const user = process.env.PREVIEW_USER;
  const password = process.env.PREVIEW_PASSWORD;
  if (!user || !password) return NextResponse.next();
  // The sender's payment page is customer-facing: it carries its own unguessable link ID.
  if (req.nextUrl.pathname.startsWith("/pay/")) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { /* malformed: ask again */ }
    const i = decoded.indexOf(":");
    if (i >= 0 && same(decoded.slice(0, i), user) && same(decoded.slice(i + 1), password)) return NextResponse.next();
  }
  return new NextResponse("Sign in to view this preview.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Investigation Desk preview", charset="UTF-8"' },
  });
}

// QA L1: exclusions are anchored, so lookalike paths (/favicon.icox, /_next/imagex) still pass through the middleware.
export const config = { matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$).*)"] };
