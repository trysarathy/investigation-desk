import { providerMerchantPayments } from "@/server/provider";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** A merchant's payment rows, ONLY under its explicit full grant to this provider (403 otherwise). */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => json(200, await providerMerchantPayments(ctx, (await params).id)));
