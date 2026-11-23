import { listOrgUsers } from "@/server/org-admin";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The organisation's members, roles and active session counts (Admin only). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, { members: await listOrgUsers(ctx) }));
