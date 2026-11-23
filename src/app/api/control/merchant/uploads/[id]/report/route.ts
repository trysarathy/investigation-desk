import { ReportQuery, validationReport } from "@/server/uploads";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The validation report summary and one page of rows (?page, ?pageSize, ?status); reason codes only. */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const query = ReportQuery.parse({
    ...(q.get("page") ? { page: Number(q.get("page")) } : {}), ...(q.get("pageSize") ? { pageSize: Number(q.get("pageSize")) } : {}), ...(q.get("status") ? { status: q.get("status") } : {}),
  });
  return json(200, await validationReport(ctx, (await params).id, query));
});
