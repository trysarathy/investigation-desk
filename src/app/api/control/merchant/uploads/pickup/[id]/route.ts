import { z } from "zod";
import { setPickupSourceEnabled } from "@/server/upload-pickup";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Admin: switch a pickup source on or off. Body: { enabled }. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await setPickupSourceEnabled(ctx, (await params).id, z.object({ enabled: z.boolean() }).strict().parse(body).enabled, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
