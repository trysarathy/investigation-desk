import { deleteUpload } from "@/server/uploads";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Delete an upload that is not confirmed (its file and validation rows). Body: {}. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await deleteUpload(ctx, (await params).id, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
