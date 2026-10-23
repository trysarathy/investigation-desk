// POST {actor, routes}: save route settings (deadlines, grace, expected legs, fee rules) as the
// next version. Validated, audit-logged, and the inbox is recomputed.

import { NextResponse } from "next/server";
import { depositRows, stores, whoFrom } from "@/lib/payments/live";
import type { RouteSetting } from "@/lib/payments/settings";
import { saveRoutes } from "@/lib/payments/workflow";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => undefined)) as { actor?: string; routes?: RouteSetting[] } | undefined;
  const res = await saveRoutes(stores(), (body?.routes ?? []) as RouteSetting[], whoFrom(req, body?.actor), new Date(), await depositRows());
  return NextResponse.json(res, { status: res.errors.length ? 422 : 200 });
}
