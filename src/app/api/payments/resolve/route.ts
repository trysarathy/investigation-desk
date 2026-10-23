// GET /api/payments/resolve?ref=PAY-… or REV-…: the payment that carries this ID now, and every
// redirect followed to get there. Exports and links use this so a retired ID never dead-ends.

import { NextResponse } from "next/server";
import { paymentsStore } from "@/lib/payments/live";
import { describeRedirect, resolvePaymentRef } from "@/lib/payments/match";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  const result = (await paymentsStore().load()).match?.result;
  if (!ref || !result) return NextResponse.json({ error: "Nothing to resolve." }, { status: 404 });
  const r = resolvePaymentRef(result, ref);
  if (!r.payment && !r.via.length) return NextResponse.json({ error: `${ref} is not a known payment or review ID.` }, { status: 404 });
  return NextResponse.json({
    ref, paymentId: r.payment?.paymentId ?? null, reviewId: r.review?.reviewId ?? null,
    via: r.via.map((v) => ({ ...v, text: describeRedirect(v) })),
  });
}
