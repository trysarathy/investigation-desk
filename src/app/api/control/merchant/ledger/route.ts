import { listLedgerInvoices } from "@/server/ledger";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** ?entity=<entityId>: the entity's ledger invoices (normalised from confirmed ledger uploads). */
export const GET = (req: Request) => read(req, async (ctx) => {
  const entity = new URL(req.url).searchParams.get("entity");
  if (!entity) return json(400, { error: { code: "INVALID_SCOPE", message: "Give entity." } });
  return json(200, await listLedgerInvoices(ctx, entity));
});
