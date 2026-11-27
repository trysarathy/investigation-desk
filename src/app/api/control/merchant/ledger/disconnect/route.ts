import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { ConnectionInput, disconnectLedger } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

/** v1 phase 2.3: disconnect a ledger: tokens deleted, revoked at the ledger when it answers (Admin). */
export const POST = (req: Request) => mutate(req, async (ctx, body) => json(200, await disconnectLedger(ctx, ConnectionInput.parse(body))));
