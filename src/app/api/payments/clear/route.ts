// POST: remove every imported payment record, import log and match result. Saved mappings stay.

import { NextResponse } from "next/server";
import { demoModeOn } from "@/lib/demo/reset";
import { paymentsStore } from "@/lib/payments/live";
import { emptyPayments } from "@/lib/payments/store";

export async function POST() {
  if (demoModeOn()) return NextResponse.json({ error: "Not available on this demo preview." }, { status: 403 });
  const store = paymentsStore();
  const { mappings } = await store.load();
  await store.save({ ...emptyPayments(), mappings });
  return NextResponse.json({ ok: true });
}
