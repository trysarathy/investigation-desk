import { z } from "zod";
import { runReconciliation } from "@/server/merchant";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ entityId: z.string().min(1).max(64) }).strict();

/** Reconcile one entity's ingested rows (Payment Operations or Finance). An identical rerun changes nothing. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await runReconciliation(ctx, Body.parse(body).entityId, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
