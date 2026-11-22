import { listPayments } from "@/server/control";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The organisation's payments with their three separate states (execution, settlement, reconciliation). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, { payments: await listPayments(ctx) }));
