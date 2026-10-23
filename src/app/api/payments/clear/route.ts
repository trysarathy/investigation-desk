// POST {actor}: remove every imported payment record, import log and match result. Saved mappings,
// assigned payment IDs, redirects and review decisions stay: an ID, once assigned, never vanishes.
// Audit-logged with who did it.

import { NextResponse } from "next/server";
import { demoModeOn } from "@/lib/demo/reset";
import { depositRows, stores, whoFrom } from "@/lib/payments/live";
import { clearAll } from "@/lib/payments/workflow";

export async function POST(req: Request) {
  if (demoModeOn()) return NextResponse.json({ error: "Not available on this demo preview." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { actor?: string };
  const res = await clearAll(stores(), whoFrom(req, body.actor), new Date(), await depositRows());
  return NextResponse.json(res.error ? res : { ok: true }, { status: res.error ? 422 : 200 });
}
