import { z } from "zod";
import { recordMatchReview } from "@/server/merchant";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ verdict: z.enum(["correct", "wrong"]), note: z.string().trim().max(1000).optional() }).strict();

/** A reviewer marks a sampled automatic match correct or wrong (pilot metric). */
export const POST = (req: Request, { params }: { params: Promise<{ orderId: string }> }) => mutate(req, async (ctx, body, key) =>
  json(200, await recordMatchReview(ctx, decodeURIComponent((await params).orderId), Body.parse(body), key)));
