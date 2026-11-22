import { investigationReport } from "@/server/control";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The evidence-backed investigation report as an attachment (?format=json|csv). The export itself is audited. */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  read(req, async (ctx) => {
    const format = new URL(req.url).searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "csv") return json(400, { error: { code: "INVALID_FORMAT", message: "format must be json or csv." } });
    const id = (await params).id;
    const r = await investigationReport(ctx, id, format);
    const safeId = id.replace(/[^A-Za-z0-9_-]/g, "") || "payment";
    return new Response(r.body, {
      status: 200,
      headers: {
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clearline-report-${ctx.orgSlug}-${safeId}.${format}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Report-SHA256": r.sha256,
      },
    });
  });
