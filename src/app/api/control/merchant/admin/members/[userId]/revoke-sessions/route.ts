import { revokeUserSessions } from "@/server/org-admin";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Sign a member of this organisation out everywhere (Admin only; not yourself). */
export const POST = (req: Request, { params }: { params: Promise<{ userId: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await revokeUserSessions(ctx, (await params).userId, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
