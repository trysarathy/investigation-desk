import { EnqueueInput, enqueueJob, listJobs } from "@/server/job-queue";
import { mutate, read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** v1 phase 3: the organisation's recent jobs with their progress events (the Runs page polls this). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await listJobs(ctx, { limit: Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20 })));

/** Queue a job for the worker, acting as the signed-in member (reconcile, revaluation or pickup). */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await enqueueJob(ctx, EnqueueInput.parse(body), key);
  return json(r.status, r.body);
});
