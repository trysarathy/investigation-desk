import { decideApproval, Decision } from "@/server/control";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** An approver approves or rejects the exact version (payloadSha256) they reviewed. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await decideApproval(ctx, (await params).id, Decision.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
