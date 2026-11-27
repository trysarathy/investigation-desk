import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { ChooseTenantInput, chooseLedgerTenant } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

/** v1 phase 2.3: choose the Xero organisation of a connection that authorised several (Admin). */
export const POST = (req: Request) => mutate(req, async (ctx, body) => json(200, await chooseLedgerTenant(ctx, ChooseTenantInput.parse(body))));
