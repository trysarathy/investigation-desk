import { jobDetail } from "@/server/job-queue";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** v1 phase 3: one job, its progress events and (a revaluation's) result. */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => json(200, await jobDetail(ctx, (await params).id)));
