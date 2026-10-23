// POST: remove every imported payment record, import log and match result. Saved mappings,
// assigned payment IDs and their redirects stay: an ID, once assigned, never vanishes.

import { NextResponse } from "next/server";
import { demoModeOn } from "@/lib/demo/reset";
import { paymentsStore } from "@/lib/payments/live";
import { clearRecords } from "@/lib/payments/store";

export async function POST() {
  if (demoModeOn()) return NextResponse.json({ error: "Not available on this demo preview." }, { status: 403 });
  const store = paymentsStore();
  await store.save(clearRecords(await store.load()));
  return NextResponse.json({ ok: true });
}
