import { DefaultsInput, savePolicyDefaults } from "@/server/provider";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Propose matching-policy defaults to a merchant (Provider Admin). Only the merchant's own Admin sets the policy. */
export const POST = (req: Request, { params }: { params: Promise<{ merchantId: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await savePolicyDefaults(ctx, (await params).merchantId, DefaultsInput.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
