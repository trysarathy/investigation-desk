import { normaliseUpload } from "@/server/normalise";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Write a confirmed upload's accepted rows into the reconciliation tables (idempotent). Body: {}. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await normaliseUpload(ctx, (await params).id, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
