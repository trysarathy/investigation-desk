import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { ReadInput, readLedgerIntoUpload } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

/**
 * v1 phase 2.3: read the connected ledger's sales invoices into an orders/invoices upload (mapped, validated) that a
 * person confirms before anything reaches matching; payments are counted only. Reads only.
 */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await readLedgerIntoUpload(ctx, ReadInput.parse(body), key);
  return json(r.status, r.body);
});
