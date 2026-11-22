import { proposeWriteoff } from "@/server/merchant";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Finance submits an engine-proposed write-off for a second person's approval (body: {}). */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await proposeWriteoff(ctx, decodeURIComponent((await params).id), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
