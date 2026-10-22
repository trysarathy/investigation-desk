import { verifySession, requiredRole, permitted } from "./lib/auth/session";
// Optional password on a shared preview. Set PREVIEW_USER and PREVIEW_PASSWORD on the host and
// every page and API route asks for them (HTTP Basic auth). Unset, nothing changes. This is a
// gate for a demo link, not the week 5 login.

import { NextResponse, type NextRequest } from "next/server";

// Compares every character so the time taken doesn't reveal how much of a guess was right.
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/integrations/")) return NextResponse.next(); // Each installation verifies its own signature/token.
  if (path === "/login" || path.startsWith("/api/auth/"))
    return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.delete("x-desk-actor");
  headers.delete("x-desk-role");
  if (process.env.DESK_USERS) {
    const session = await verifySession(
      req.cookies.get("desk.session")?.value,
      process.env.SESSION_SECRET ?? "",
    );
    if (!session)
      return path.startsWith("/api/")
        ? NextResponse.json({ error: "Sign in required" }, { status: 401 })
        : NextResponse.redirect(new URL("/login", req.url));
    if (!permitted(session.role, requiredRole(path, req.method)))
      return new NextResponse("Your role cannot access this action.", {
        status: 403,
      });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.headers.get("origin") ||
        new URL(req.headers.get("origin")!).host !== req.headers.get("host"))
    )
      return new NextResponse("Origin rejected", { status: 403 });
    headers.set("x-desk-actor", session.actor);
    headers.set("x-desk-role", session.role);
    return NextResponse.next({ request: { headers } });
  }
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "1")
    return new NextResponse(
      "Configure workspace authentication before serving customer data.",
      { status: 503 },
    );
  headers.set("x-desk-actor", "local-preview");
  headers.set("x-desk-role", "admin");
  const user = process.env.PREVIEW_USER;
  const password = process.env.PREVIEW_PASSWORD;
  if (!user || !password) return NextResponse.next({ request: { headers } });
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      /* malformed: ask again */
    }
    const i = decoded.indexOf(":");
    if (
      i >= 0 &&
      same(decoded.slice(0, i), user) &&
      same(decoded.slice(i + 1), password)
    )
      return NextResponse.next({ request: { headers } });
  }
  return new NextResponse("Sign in to view this preview.", {
    status: 401,
    headers: {
      "WWW-Authenticate":
        'Basic realm="Investigation Desk preview", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
