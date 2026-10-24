// POST /api/uploads/A or /api/uploads/B with a multipart "file". Validates, then applies the
// upload to the workspace. Roles arrive in week 5: until then anyone with the app can upload.

import { NextResponse } from "next/server";
import { validateFileA, validateFileB } from "@/lib/csv/files";
import { demoModeOn } from "@/lib/demo/reset";
import { requestTooLarge, TOO_LARGE, UPLOAD_MAX_BYTES } from "@/lib/limits";
import { workspaceStore } from "@/lib/workspace/live";
import { applyUpload } from "@/lib/workspace/store";

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "A" && kind !== "B") return NextResponse.json({ error: "Unknown file kind." }, { status: 404 });
  if (demoModeOn()) {
    return NextResponse.json({ error: "Uploads are off on this demo preview, so it never holds real customer data. Use the demo workspace." }, { status: 403 });
  }
  if (requestTooLarge(req)) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  const form = await req.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV file in the \"file\" field." }, { status: 400 });
  if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.slice(0, 200);
  const record = kind === "A"
    ? await applyUpload(workspaceStore(), "A", name, validateFileA(bytes), new Date())
    : await applyUpload(workspaceStore(), "B", name, validateFileB(bytes), new Date());
  return NextResponse.json(record, { status: record.outcome === "rejected" ? 422 : 200 });
}
