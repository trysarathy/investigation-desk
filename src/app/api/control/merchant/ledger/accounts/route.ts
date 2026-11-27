import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { AccountMapInput, setLedgerAccountMap } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

/** v1 phase 2.3: map Clearline's accounts to the connected ledger's account codes (Finance). */
export const POST = (req: Request) => mutate(req, async (ctx, body) => json(200, await setLedgerAccountMap(ctx, AccountMapInput.parse(body))));
