import { Acknowledge, acknowledgeRuleChange } from "@/server/notifications";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** An Approver (not the member who started the run) acknowledges a rule-change notice. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await acknowledgeRuleChange(ctx, (await params).id, Acknowledge.parse(body ?? {}), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
