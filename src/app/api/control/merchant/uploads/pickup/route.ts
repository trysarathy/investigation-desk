import { createPickupSource, listPickupSources } from "@/server/upload-pickup";
import { mutate, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** v1 phase 2.1: the merchant's scheduled pickup sources (SFTP folder, email inbox); Admin, Finance and Payment Ops read. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await listPickupSources(ctx)));

/** Admin: add a pickup source. Body: CreatePickupSource (src/server/upload-pickup.ts). Never a credential, only its variable's name. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await createPickupSource(ctx, body as Parameters<typeof createPickupSource>[1], key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
