import { Assignment, assignException } from "@/server/merchant-ui";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Assign (or unassign) an exception to an active Payment Operations or Finance member of this merchant. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await assignException(ctx, (await params).id, Assignment.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
