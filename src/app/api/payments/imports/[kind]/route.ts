// POST /api/payments/imports/instruction|provider|bank, multipart: "file", "mappingId",
// optional "mappingVersion". Validates with that mapping version, merges the records, then
// re-runs matching. Roles arrive in week 5: until then anyone with the app can import.

import { NextResponse } from "next/server";
import { demoModeOn } from "@/lib/demo/reset";
import { paymentsStore, rematch } from "@/lib/payments/live";
import { applyImport } from "@/lib/payments/store";
import type { ImportKind } from "@/lib/payments/types";

const KINDS: ImportKind[] = ["instruction", "provider", "bank"];
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind as ImportKind)) return NextResponse.json({ error: "Unknown record kind." }, { status: 404 });
  if (demoModeOn()) return NextResponse.json({ error: "Imports are off on this demo preview, so it never holds real customer data." }, { status: 403 });
  const form = await req.formData().catch(() => undefined);
  const file = form?.get("file");
  const mappingId = form?.get("mappingId");
  const versionRaw = form?.get("mappingVersion");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file in the \"file\" field." }, { status: 400 });
  if (typeof mappingId !== "string" || !mappingId) return NextResponse.json({ error: "Choose a column mapping." }, { status: 400 });
  const version = typeof versionRaw === "string" && /^\d+$/.test(versionRaw) ? Number(versionRaw) : undefined;
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 20 MB." }, { status: 413 });
  const log = await applyImport(paymentsStore(), kind as ImportKind, file.name.slice(0, 200), new Uint8Array(await file.arrayBuffer()), mappingId, version, new Date());
  if (log.outcome === "imported") await rematch();
  return NextResponse.json(log, { status: log.outcome === "rejected" ? 422 : 200 });
}
