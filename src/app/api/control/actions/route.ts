import { runAction } from "@/server/control";
import { ControlActionBody, toWorkspaceAction } from "@/server/control-actions";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Engine actions (owner, notes, evidence, information requests, reopen, accounting). The actor is the session user. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await runAction(ctx, toWorkspaceAction(ctx, ControlActionBody.parse(body)), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
