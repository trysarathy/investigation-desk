import { RequestLock, listPeriods, requestPeriodLock } from "@/server/period-close";
import { mutate, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** v1 phase 3: an entity's month-end sign-offs (requested, locked, rejected) and the corrections filed for locked months. */
export const GET = (req: Request, { params }: { params: Promise<{ entityId: string }> }) => read(req, async (ctx) => json(200, await listPeriods(ctx, (await params).entityId)));

/** Ask for a month to be locked (Finance or an Admin); another Admin decides. */
export const POST = (req: Request, { params }: { params: Promise<{ entityId: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await requestPeriodLock(ctx, (await params).entityId, RequestLock.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
