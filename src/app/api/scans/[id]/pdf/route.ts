import { getDocument, audit } from "@/lib/platform/store";
import { scanPdf } from "@/lib/scan/pdf";
import type { ScanReport } from "@/lib/scan/types";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = getDocument<ScanReport>("scan", (await params).id);
  if (!r) return Response.json({ error: "Not found" }, { status: 404 });
  audit("scan.exported", r.id);
  return new Response(Buffer.from(await scanPdf(r)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="company-scan.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
