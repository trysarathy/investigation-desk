// GET: every version of every column mapping. POST (JSON mapping without version): save it as
// the next version of its mapping ID. Earlier versions never change.

import { NextResponse } from "next/server";
import { demoModeOn } from "@/lib/demo/reset";
import { paymentsStore } from "@/lib/payments/live";
import type { ColumnMapping } from "@/lib/payments/mapping";
import { allMappings, saveMappingVersion } from "@/lib/payments/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(allMappings(await paymentsStore().load()));
}

export async function POST(req: Request) {
  if (demoModeOn()) return NextResponse.json({ errors: ["Mappings can't be changed on this demo preview."] }, { status: 403 });
  const body = (await req.json().catch(() => undefined)) as Omit<ColumnMapping, "version" | "createdAt"> | undefined;
  if (!body || typeof body !== "object" || typeof body.mappingId !== "string" || typeof body.columns !== "object") {
    return NextResponse.json({ errors: ["Send a mapping as JSON."] }, { status: 400 });
  }
  const { version: _v, createdAt: _c, ...mapping } = body as ColumnMapping;
  const res = await saveMappingVersion(paymentsStore(), mapping, new Date());
  return NextResponse.json(res, { status: res.errors.length ? 422 : 200 });
}
