// POST /api/accounting/<requestId>: approve the posting plan a person saw, and post it.
// JSON: { actor, key }  (key = the plan's idempotency key, so a plan that changed must be approved again)

import { NextResponse } from "next/server";
import { approvePosting } from "@/lib/accounting/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => undefined) as { actor?: unknown; key?: unknown } | undefined;
  const actor = typeof body?.actor === "string" ? body.actor.trim().slice(0, 60) : "";
  if (!actor) return NextResponse.json({ error: "Set \"Acting as\" first: every posting records who approved it." }, { status: 422 });
  if (typeof body?.key !== "string") return NextResponse.json({ error: "Missing the plan you approved." }, { status: 400 });
  const res = await approvePosting(id, actor, body.key);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ok: true, message: res.message });
}
