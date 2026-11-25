import { auditorEvidencePack } from "@/server/auditor";
import { PackFormat } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * The Auditor's evidence pack: ?order=<orderId> or ?entity=<entityId>&month=YYYY-MM, &format=pdf|csv|json. Only the
 * granted period (and entities), until the grant expires; anything else is "not found". Every download is audited.
 */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const f = PackFormat.safeParse(q.get("format") ?? "pdf");
  if (!f.success) return json(400, { error: { code: "INVALID_FORMAT", message: "format must be pdf, csv or json." } });
  const order = q.get("order"), entity = q.get("entity"), month = q.get("month");
  if (!order && !(entity && month)) return json(400, { error: { code: "INVALID_SCOPE", message: "Give order, or entity and month." } });
  const r = await auditorEvidencePack(ctx, order ? { kind: "payment", orderId: order } : { kind: "month", entityId: entity!, month: month! }, f.data);
  return new Response(r.body as BodyInit, { status: 200, headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Evidence-SHA256": r.sha256 } });
});
