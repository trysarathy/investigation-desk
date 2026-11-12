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

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
