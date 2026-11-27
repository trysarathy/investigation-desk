import { read } from "@/server/control-http";
import { json } from "@/server/http";
import { listLedgerConnections, listLedgerDrafts } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

/** v1 phase 2.3: this organisation's ledger connections (status, organisation, expiry; never a token) and drafts written. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, { connections: await listLedgerConnections(ctx), drafts: await listLedgerDrafts(ctx) }));
