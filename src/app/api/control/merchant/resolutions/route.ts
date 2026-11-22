import { ResolutionRequest, requestMerchantResolution } from "@/server/merchant-ui";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Propose a resolution of an exception (note + attached evidence) for a DIFFERENT approver to approve by hash. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await requestMerchantResolution(ctx, ResolutionRequest.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
