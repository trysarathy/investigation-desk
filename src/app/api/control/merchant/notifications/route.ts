import { listNotifications } from "@/server/notifications";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The signed-in member's notifications (their role's, in this organisation) and the unread count. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await listNotifications(ctx)));
