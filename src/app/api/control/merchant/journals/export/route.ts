import { journalExport } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Accounting Bridge export as a FILE only (?entity=&month=YYYY-MM&format=csv|json): no Xero or QuickBooks connection,
 * sandbox/demo company only, posting rules pending sign-off. The export is audited; nothing is posted.
 */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const format = q.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") return json(400, { error: { code: "INVALID_FORMAT", message: "format must be csv or json." } });
  const entity = q.get("entity") ?? "";
  const month = q.get("month") ?? "";
  if (!entity || !/^\d{4}-\d{2}$/.test(month)) return json(400, { error: { code: "INVALID_SCOPE", message: "Give entity and month (YYYY-MM)." } });
  const r = await journalExport(ctx, entity, month, format);
  return new Response(r.body, {
    status: 200,
    headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-SHA256": r.sha256 },
  });
});
