import { createProviderConnection, listProviderConnections } from "@/server/provider-api";
import { mutate, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The merchant's provider API connections (secret references and whether the server holds them; never a secret). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await listProviderConnections(ctx)));

/** Connect the merchant's own provider's API (Admin; off unless CLEARLINE_PROVIDER_API=1). */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await createProviderConnection(ctx, body as never, key);
  return json(r.status, { connection: r.body, replayed: r.replayed });
});
