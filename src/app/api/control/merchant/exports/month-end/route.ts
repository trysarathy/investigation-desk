import { monthEndPack } from "@/server/exports";
import { MonthEndFormat, monthEndPackFile } from "@/server/month-end-pack";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * ?entity=<entityId>&month=YYYY-MM[&format=zip|pdf|xlsx]: the month-end pack as one ZIP (default), or v1 phase 4's
 * PDF / XLSX pack (bridges, receivable by batch, exceptions by age, write-offs, FX revaluation, journals, evidence
 * index, cross-section checks). Finance, an Approver or an Admin. The export is audited.
 */
export const GET = (req: Request) => read(req, async (ctx) => {
  const q = new URL(req.url).searchParams;
  const entity = q.get("entity"), month = q.get("month"), format = q.get("format") ?? "zip";
  if (!entity || !month) return json(400, { error: { code: "INVALID_SCOPE", message: "Give entity and month (YYYY-MM)." } });
  if (format !== "zip" && !MonthEndFormat.safeParse(format).success) return json(400, { error: { code: "INVALID_FORMAT", message: "format must be zip, pdf or xlsx." } });
  const r = format === "zip" ? await monthEndPack(ctx, entity, month) : await monthEndPackFile(ctx, entity, month, format as "pdf" | "xlsx");
  return new Response(r.body as BodyInit, { status: 200, headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-SHA256": r.sha256 } });
});
