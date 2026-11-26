import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { isMemberAction, MEMBER_ACTIONS } from "@/server/onboarding/members";
import { AccessDenied } from "@/server/tenant";

export const dynamic = "force-dynamic";

/**
 * The members page's writes (an unscoped merchant Admin only; through the provisioning role; each audited by the
 * database): invite (the answer may carry the one-time link, shown once and never replayed), revoke-invitation, deactivate.
 */
export const POST = (req: Request, { params }: { params: Promise<{ action: string }> }) => mutate(req, async (ctx, body) => {
  const { action } = await params;
  if (!isMemberAction(action)) throw new AccessDenied(404, "Not found.");
  return json(200, await (MEMBER_ACTIONS[action] as (c: typeof ctx, b: unknown) => Promise<unknown>)(ctx, body));
});
