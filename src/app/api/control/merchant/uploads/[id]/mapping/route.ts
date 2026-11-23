import { SetMapping, setUploadMapping } from "@/server/uploads";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Confirm the column mapping: { templateId } or { mapping } (Finance or Payment Operations). */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await setUploadMapping(ctx, (await params).id, SetMapping.parse(body), key);
  return json(r.status, { upload: r.body, replayed: r.replayed });
});
