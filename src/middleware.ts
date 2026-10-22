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
  const user = process.env.PREVIEW_USER;
  const password = process.env.PREVIEW_PASSWORD;
  if (!user || !password) return NextResponse.next();
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
