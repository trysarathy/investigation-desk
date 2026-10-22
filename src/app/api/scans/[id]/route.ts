import { getDocument } from "@/lib/platform/store";
import type { ScanReport } from "@/lib/scan/types";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = getDocument<ScanReport>("scan", (await params).id);
  return Response.json(r ?? { error: "Not found" }, {
    status: r ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
