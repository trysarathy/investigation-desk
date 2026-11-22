import { merchantPaymentDetail } from "@/server/merchant";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** One payment: the five parts, the deciding step and rule, differences, exceptions, write-offs and approvals. */
export const GET = (req: Request, { params }: { params: Promise<{ orderId: string }> }) =>
  read(req, async (ctx) => json(200, JSON.parse(JSON.stringify(await merchantPaymentDetail(ctx, (await params).orderId), (_k, v) => (typeof v === "bigint" ? v.toString() : v)))));
