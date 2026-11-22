import { z } from "zod";
import { PolicyPatch, updateMerchantPolicy } from "@/server/merchant";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ patch: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().min(1) }).strict();

/** The merchant's Admin sets an entity's matching policy (the database refuses anyone else and stale revisions). */
export const POST = (req: Request, { params }: { params: Promise<{ entityId: string }> }) => mutate(req, async (ctx, body, key) => {
  const b = Body.parse(body);
  const r = await updateMerchantPolicy(ctx, (await params).entityId, b.patch as z.input<typeof PolicyPatch>, b.expectedRevision, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
