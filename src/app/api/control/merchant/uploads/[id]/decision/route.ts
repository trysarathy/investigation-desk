import { UploadDecision, decideUpload } from "@/server/uploads";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Confirm or decline a validated upload, binding the file and report hashes reviewed. A bank statement needs an
 * Approver who did not upload it.
 */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await decideUpload(ctx, (await params).id, UploadDecision.parse(body), key);
  return json(r.status, { upload: r.body, replayed: r.replayed });
});
