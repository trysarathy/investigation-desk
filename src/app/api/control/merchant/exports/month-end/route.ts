import { monthEndPack } from "@/server/exports";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** ?entity=<entityId>&month=YYYY-MM: the month-end pack as one ZIP (Finance, an Approver or an Admin). The export is audited. */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const entity = q.get("entity"), month = q.get("month");
  if (!entity || !month) return json(400, { error: { code: "INVALID_SCOPE", message: "Give entity and month (YYYY-MM)." } });
  const r = await monthEndPack(ctx, entity, month);
  return new Response(r.body as BodyInit, { status: 200, headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-SHA256": r.sha256 } });
});
