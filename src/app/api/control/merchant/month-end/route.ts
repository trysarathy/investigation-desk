import { monthEndView } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Month-end (?entity=&month=YYYY-MM): receivable from the provider by batch, exceptions by age, FX note, journals. */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  return json(200, await monthEndView(ctx, q.get("entity") ?? "", q.get("month") ?? "", null));
});
