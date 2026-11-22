import { dailyReport } from "@/server/merchant";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The daily report of one entity (?entity=&date=YYYY-MM-DD): the summary line and the cut-off note. */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  return json(200, await dailyReport(ctx, q.get("entity") ?? "", q.get("date") ?? ""));
});
