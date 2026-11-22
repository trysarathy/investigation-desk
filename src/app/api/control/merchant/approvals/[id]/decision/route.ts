import { Decision } from "@/server/control";
import { decideMerchantApproval } from "@/server/merchant-ui";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** A different approver approves or rejects the exact version (payloadSha256) of a write-off or resolution they reviewed. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await decideMerchantApproval(ctx, (await params).id, Decision.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
