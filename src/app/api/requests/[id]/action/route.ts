// POST /api/requests/<id>/action: a decision, owner, note, or a live transaction hash to attach.
// JSON: { actor, action: { kind: "decide", decision: { kind, note, observationKey? } } | { kind: "owner", owner }
//         | { kind: "note", text } | { kind: "attach_hash", hash } }

import { NextResponse } from "next/server";
import { actOnRequest, type RequestAction } from "@/lib/requests/service";

const KINDS = new Set(["decide", "owner", "note", "attach_hash"]);
const DECISIONS = new Set(["request_balance", "accept_short", "accept_over", "dismiss_transfer", "assign_transfer", "acknowledge"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => undefined) as { actor?: unknown; action?: Record<string, unknown> } | undefined;
  const actor = typeof body?.actor === "string" ? body.actor.trim().slice(0, 60) : "";
  if (!actor) return NextResponse.json({ error: "Set \"Acting as\" first: every change records who made it." }, { status: 422 });
  const a = body?.action;
  if (!a || typeof a.kind !== "string" || !KINDS.has(a.kind)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (a.kind === "decide") {
    const d = a.decision as Record<string, unknown> | undefined;
    if (!d || typeof d.kind !== "string" || !DECISIONS.has(d.kind)) return NextResponse.json({ error: "Unknown decision." }, { status: 400 });
    if (typeof d.note !== "string") return NextResponse.json({ error: "A note is required (it may be empty only when acknowledging)." }, { status: 400 });
  }
  const res = await actOnRequest(id, a as unknown as RequestAction, actor);
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "No such request." ? 404 : 422 });
  return NextResponse.json({ ok: true, message: res.message });
}
