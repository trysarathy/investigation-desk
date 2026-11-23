import { validateUpload } from "@/server/uploads";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Validate every row (accepted, warning, rejected with reason codes, or duplicate). Body: {}. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await validateUpload(ctx, (await params).id, key);
  return json(r.status, { upload: r.body, replayed: r.replayed });
});
