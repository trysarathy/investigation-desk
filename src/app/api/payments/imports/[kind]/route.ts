// POST /api/payments/imports/instruction|provider|bank|ledger, multipart: "file", "mappingId",
// optional "mappingVersion", and "actor" (who is importing; audit-logged). Validates with that mapping version, merges the records, then
// starts matching in the background (GET /api/payments/match shows its progress). Roles arrive in
// week 5: until then anyone with the app can import.

import { NextResponse } from "next/server";
import { demoModeOn } from "@/lib/demo/reset";
import { requestTooLarge, TOO_LARGE, UPLOAD_MAX_BYTES } from "@/lib/limits";
import { requestMatch } from "@/lib/payments/jobs";
import { depositRows, rematchData, stores, whoFrom } from "@/lib/payments/live";
import { importFile, missingKeyWarnings } from "@/lib/payments/workflow";
import type { ImportKind } from "@/lib/payments/types";

const KINDS: ImportKind[] = ["instruction", "provider", "bank", "ledger"];

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind as ImportKind)) return NextResponse.json({ error: "Unknown record kind." }, { status: 404 });
  if (demoModeOn()) return NextResponse.json({ error: "Imports are off on this demo preview, so it never holds real customer data." }, { status: 403 });
  if (requestTooLarge(req)) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  const form = await req.formData().catch(() => undefined);
  const file = form?.get("file");
  const mappingId = form?.get("mappingId");
  const versionRaw = form?.get("mappingVersion");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file in the \"file\" field." }, { status: 400 });
  if (typeof mappingId !== "string" || !mappingId) return NextResponse.json({ error: "Choose a column mapping." }, { status: 400 });
  const version = typeof versionRaw === "string" && /^\d+$/.test(versionRaw) ? Number(versionRaw) : undefined;
  if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  const res = await importFile(stores(), { kind: kind as ImportKind, fileName: file.name.slice(0, 200), bytes: new Uint8Array(await file.arrayBuffer()), mappingId, mappingVersion: version },
    whoFrom(req, form?.get("actor")), new Date(), rematchData, await depositRows(), { deferMatch: true });
  if (res.error || !res.log) return NextResponse.json({ error: res.error }, { status: 422 });
  if (res.log.outcome !== "imported") return NextResponse.json({ ...res.log, warnings: [] }, { status: res.log.outcome === "rejected" ? 422 : 200 });
  const match = requestMatch(`import of ${res.log.fileName}`);
  return NextResponse.json({ ...res.log, warnings: await missingKeyWarnings(stores().payments, res.log.importId), match });
}
