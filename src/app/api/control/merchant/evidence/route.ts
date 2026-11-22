import { PackFormat, evidencePack } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * The evidence pack as an attachment: ?order=<orderId> (one payment) or ?entity=<entityId>&month=YYYY-MM, with
 * &format=pdf|csv|json. Chain proof, provider record, bank line, approvals and audit trail. The export is audited.
 */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const f = PackFormat.safeParse(q.get("format") ?? "json");
  if (!f.success) return json(400, { error: { code: "INVALID_FORMAT", message: "format must be pdf, csv or json." } });
  const order = q.get("order");
  const entity = q.get("entity");
  const month = q.get("month");
  if (!order && !(entity && month)) return json(400, { error: { code: "INVALID_SCOPE", message: "Give order, or entity and month." } });
  const r = await evidencePack(ctx, order ? { kind: "payment", orderId: order } : { kind: "month", entityId: entity!, month: month! }, f.data);
  return new Response(r.body as BodyInit, {
    status: 200,
    headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Evidence-SHA256": r.sha256 },
  });
});
