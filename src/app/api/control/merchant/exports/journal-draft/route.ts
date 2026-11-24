import { DraftToolInput, journalDraftFile } from "@/server/exports";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * ?entity=<entityId>&month=YYYY-MM&tool=xero|quickbooks: a DRAFT manual-journal file for a sandbox / demo company
 * (Finance, an Approver or an Admin). Nothing is posted; posting rules stay pending sign-off. The export is audited.
 */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const tool = DraftToolInput.safeParse(q.get("tool") ?? "xero");
  const entity = q.get("entity"), month = q.get("month");
  if (!tool.success || !entity || !month) return json(400, { error: { code: "INVALID_SCOPE", message: "Give entity, month (YYYY-MM) and tool (xero or quickbooks)." } });
  const r = await journalDraftFile(ctx, entity, month, tool.data);
  return new Response(r.body, { status: 200, headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-SHA256": r.sha256 } });
});
