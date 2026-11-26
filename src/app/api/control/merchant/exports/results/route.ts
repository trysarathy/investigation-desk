import { ResultsKind, resultsCsv } from "@/server/exports";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** ?kind=exceptions|matched: the open exceptions, or the matched payments, as CSV (Finance, an Approver or an Admin). Audited. */
export const GET = (req: Request) => read(req, async (ctx) => {
  const kind = ResultsKind.safeParse(new URL(req.url).searchParams.get("kind"));
  if (!kind.success) return json(400, { error: { code: "INVALID_KIND", message: "Give kind=exceptions or kind=matched." } });
  const r = await resultsCsv(ctx, kind.data);
  return new Response(r.body, { status: 200, headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-SHA256": r.sha256 } });
});
