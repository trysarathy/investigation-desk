import { MappingInput, saveColumnMapping } from "@/server/provider";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Save the column-mapping config for a merchant's exports (Provider Admin). Configuration only: nothing connects live. */
export const POST = (req: Request, { params }: { params: Promise<{ merchantId: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await saveColumnMapping(ctx, (await params).merchantId, MappingInput.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
