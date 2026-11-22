import { CaseDetails, updateCaseDetails } from "@/server/control";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Priority, next action and due date of an investigation. PUT replaces all three, so repeating it is harmless; the
 * Idempotency-Key header is still required, like every Control mutation.
 */
export const PUT = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body) => {
  await updateCaseDetails(ctx, (await params).id, CaseDetails.parse(body));
  return json(200, { ok: true });
});
