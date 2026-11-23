import { PullInput, pullLedgerInvoices } from "@/server/ledger";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Read sales invoices (read-only) from a Xero demo company or a QuickBooks sandbox into a ledger-invoices upload,
 * mapped and validated, for a person to confirm. Off unless CLEARLINE_LEDGER_PULL=1. Never writes to the ledger.
 */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await pullLedgerInvoices(ctx, PullInput.parse(body), key);
  return json(r.status, r.body);
});
