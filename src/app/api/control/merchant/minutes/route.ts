import { z } from "zod";
import { logMinutes } from "@/server/merchant";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minutes: z.number().int().min(0).max(1440), note: z.string().trim().max(500).optional() }).strict();

/** The optional "minutes spent today" log (pilot time-saved measurement). */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => json(201, await logMinutes(ctx, Body.parse(body), key)));
