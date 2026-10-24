// GET: the background match's progress. POST: re-run chain lookups for unresolved hashes, then
// matching, in the background; returns at once with the job's state.

import { NextResponse } from "next/server";
import { matchJobState, requestMatch } from "@/lib/payments/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(matchJobState());
}

export async function POST() {
  return NextResponse.json(requestMatch("re-run requested"));
}
