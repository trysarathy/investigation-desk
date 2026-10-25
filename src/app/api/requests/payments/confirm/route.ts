// POST /api/requests/payments/confirm: a person confirms which request an unidentified payment pays.
// JSON: { actor, key, requestId, note }.

import { NextResponse } from "next/server";
import { confirmUnmatched } from "@/lib/requests/service";

export async function POST(req: Request) {
  const b = await req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const actor = typeof b?.actor === "string" ? b.actor.trim().slice(0, 60) : "";
  if (!actor) return NextResponse.json({ error: "Set \"Acting as\" first: every change records who made it." }, { status: 422 });
  if (typeof b?.key !== "string" || typeof b?.requestId !== "string" || typeof b?.note !== "string") return NextResponse.json({ error: "Send key, requestId and note as text." }, { status: 400 });
  const res = await confirmUnmatched(b.key, b.requestId, b.note, actor);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
