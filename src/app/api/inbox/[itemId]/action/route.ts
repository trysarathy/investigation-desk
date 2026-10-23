// POST {actor, action}: change an inbox item's status, owner, follow-up date, or add a note.
// Recorded on the item's history and in the audit log.

import { NextResponse } from "next/server";
import type { InboxAction } from "@/lib/payments/inbox";
import { stores, whoFrom } from "@/lib/payments/live";
import { act } from "@/lib/payments/workflow";

export async function POST(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const body = (await req.json().catch(() => undefined)) as { actor?: string; action?: InboxAction } | undefined;
  if (!body?.action || typeof body.action !== "object") return NextResponse.json({ error: "Send an action." }, { status: 400 });
  const res = await act(stores(), itemId, body.action, whoFrom(req, body.actor), new Date());
  return NextResponse.json(res, { status: res.error ? 422 : 200 });
}
