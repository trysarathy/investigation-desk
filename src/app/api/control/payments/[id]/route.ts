import { paymentDetail } from "@/server/control";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** One payment's investigation view, exceptions, case, approvals and evidence timeline (404 outside this organisation). */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  read(req, async (ctx) => json(200, await paymentDetail(ctx, (await params).id)));
