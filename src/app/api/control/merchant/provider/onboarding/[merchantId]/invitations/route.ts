import { InvitationInput, createInvitation } from "@/server/provider";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Record an invitation (Provider Admin). No email is sent; the response carries the admin CLI command that accepts it. */
export const POST = (req: Request, { params }: { params: Promise<{ merchantId: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await createInvitation(ctx, (await params).merchantId, InvitationInput.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
