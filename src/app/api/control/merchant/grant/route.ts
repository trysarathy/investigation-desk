import { GrantInput, setProviderGrant } from "@/server/provider";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The merchant's Admin grants its provider full read access ({scope:"full"}) or takes it back ({scope:"aggregates"}). */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await setProviderGrant(ctx, GrantInput.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
