import { z } from "zod";
import { FILE_TYPES } from "@/lib/clearline/mapping";
import { createUpload, listUploads } from "@/server/uploads";
import { mutateUpload, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const Fields = z.object({ entityId: z.string().min(1).max(64), fileType: z.enum(FILE_TYPES) });

/** The merchant's uploads (status and counts; no file contents). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await listUploads(ctx)));

/**
 * Upload one file (multipart/form-data: `file`, `entityId`, `fileType`; Finance or Payment Operations). Returns the
 * stored upload, its preview (first 20 rows) and the suggested mapping, to be confirmed by the person.
 */
export const POST = (req: Request) => mutateUpload(req, async (ctx, form, key) => {
  const f = Fields.parse({ entityId: form.fields.entityId, fileType: form.fields.fileType });
  const r = await createUpload(ctx, { ...f, fileName: form.fileName, bytes: form.bytes }, key);
  return json(r.status, { label: r.label, upload: r.upload, preview: r.preview, suggestion: r.suggestion, replayed: r.replayed });
});
