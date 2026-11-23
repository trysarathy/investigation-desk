import { z } from "zod";
import { setRetentionDays } from "@/server/uploads";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Admin: retention of uploads in days (1–3650; default 90). Body: { days }. */
export const POST = (req: Request) => mutate(req, async (ctx, body, key) => {
  const r = await setRetentionDays(ctx, z.object({ days: z.number().int() }).strict().parse(body).days, key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
