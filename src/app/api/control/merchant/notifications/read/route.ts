import { MarkRead, markNotificationsRead } from "@/server/notifications";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Mark notifications read for the signed-in member: { ids: [...] }. */
export const POST = (req: Request) => mutate(req, async (ctx, body) => json(200, await markNotificationsRead(ctx, MarkRead.parse(body))));
