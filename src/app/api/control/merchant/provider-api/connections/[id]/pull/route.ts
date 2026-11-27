import { pullProviderConnection } from "@/server/provider-api";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Pull the connection's records (read-only) into a new upload, mapped with the connection's template version and
 * validated, for a person to confirm (Finance or Payment Operations). Body: {}.
 */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, _body, key) => {
  const r = await pullProviderConnection(ctx, (await params).id, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
