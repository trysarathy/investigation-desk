import { disableProviderConnection } from "@/server/provider-api";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Disable a provider API connection (Admin; once). Body: {}. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await disableProviderConnection(ctx, (await params).id, key);
  return json(r.status, { connection: r.body, replayed: r.replayed });
});
