import { setRunSchedule } from "@/server/runs";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Set an entity's daily reconciliation (Payment Operations or Finance, for themselves; the database checks both). */
export const POST = (req: Request, { params }: { params: Promise<{ entityId: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await setRunSchedule(ctx, (await params).entityId, body as { localTime?: string; enabled?: boolean }, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
