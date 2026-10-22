// GET: the demo bulk file, for step 6 of the demo script.

import { DEMO_BULK_CSV } from "@/lib/demo/files";

export function GET() {
  return new Response(DEMO_BULK_CSV, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="demo-bulk.csv"' },
  });
}
