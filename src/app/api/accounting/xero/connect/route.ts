// GET /api/accounting/xero/connect: start the Xero OAuth connection (standard web app flow).

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, xeroConfigured } from "@/lib/accounting/providers/xero-auth";
import { isDemoMode } from "@/lib/mode";

export async function GET(req: Request) {
  if (isDemoMode()) return NextResponse.json({ error: "Demo mode uses the demo books. Restart with DEMO_MODE=off to connect Xero." }, { status: 409 });
  if (!xeroConfigured()) return NextResponse.json({ error: "Set XERO_CLIENT_ID and XERO_CLIENT_SECRET on the server first (see docs/ACCOUNTING_SYNC.md)." }, { status: 409 });
  const origin = new URL(req.url).origin;
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(`${origin}/api/accounting/xero/callback`, state));
  res.cookies.set("xero_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https"), maxAge: 600, path: "/" });
  return res;
}
