import { accessReviewExport, ReviewFormat } from "@/server/access-review";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** ?format=csv|pdf: the access review as a file for an auditor. Every export is audited (format, hash, row count). */
export const GET = (req: Request) => read(req, async (ctx) => {
  const f = ReviewFormat.safeParse(new URL(req.url).searchParams.get("format"));
  if (!f.success) return json(400, { error: { code: "INVALID_FORMAT", message: "Use format=csv or format=pdf." } });
  const r = await accessReviewExport(ctx, f.data);
  return new Response(r.body as BodyInit, { status: 200, headers: { "Content-Type": r.contentType, "Content-Disposition": `attachment; filename="${r.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Export-SHA256": r.sha256 } });
});
