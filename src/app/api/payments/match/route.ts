// POST: re-run chain lookups for unresolved hashes, then matching.

import { NextResponse } from "next/server";
import { rematch } from "@/lib/payments/live";

export async function POST() {
  const data = await rematch();
  const r = data.match!.result;
  return NextResponse.json({ payments: r.payments.length, reviews: r.reviews.length, at: data.match!.at });
}
