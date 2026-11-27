import { DecideLock, decidePeriodLock } from "@/server/period-close";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** v1 phase 3: lock (or reject) a requested month. An Admin who did not ask; the database checks both. */
export const POST = (req: Request, { params }: { params: Promise<{ entityId: string; period: string }> }) => mutate(req, async (ctx, body, key) => {
  const p = await params;
  const r = await decidePeriodLock(ctx, p.entityId, p.period, DecideLock.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
