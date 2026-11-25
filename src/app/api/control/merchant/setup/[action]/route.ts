import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { isSetupAction, SETUP_ACTIONS } from "@/server/onboarding/wizard";
import { AccessDenied } from "@/server/tenant";

export const dynamic = "force-dynamic";

/** The setup wizard's writes (merchant Admin only; through the provisioning role; each one audited by the database). */
export const POST = (req: Request, { params }: { params: Promise<{ action: string }> }) => mutate(req, async (ctx, body) => {
  const { action } = await params;
  if (!isSetupAction(action)) throw new AccessDenied(404, "Not found.");
  return json(200, await (SETUP_ACTIONS[action] as (c: typeof ctx, b: unknown) => Promise<unknown>)(ctx, body));
});
