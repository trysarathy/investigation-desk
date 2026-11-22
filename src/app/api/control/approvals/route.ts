import { listApprovals, requestResolution, ResolutionProposal } from "@/server/control";
import { mutate, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Every approval request of the organisation, newest first. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, { approvals: await listApprovals(ctx) }));

/** Payment operations proposes a resolution (note + evidence references) for a second person to approve. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await requestResolution(ctx, ResolutionProposal.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
