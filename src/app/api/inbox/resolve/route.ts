// POST {actor, reviewId, recordId, action: "confirm" | "reject", why}: resolve a matching review
// in the app. Kept as a decision (who, when, why), audit-logged, and applied on every later run.

import { NextResponse } from "next/server";
import { depositRows, rematchData, stores, whoFrom } from "@/lib/payments/live";
import { resolveReview } from "@/lib/payments/workflow";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as { actor?: string; reviewId?: string; recordId?: string; action?: "confirm" | "reject"; why?: string } | undefined;
  if (!body?.reviewId || !body.recordId || !body.action) return NextResponse.json({ error: "Send reviewId, recordId and action." }, { status: 400 });
  const res = await resolveReview(stores(), { reviewId: body.reviewId, recordId: body.recordId, action: body.action, why: body.why ?? "" },
    whoFrom(req, body.actor), new Date(), rematchData, await depositRows());
  return NextResponse.json(res, { status: res.error ? 422 : 200 });
}
