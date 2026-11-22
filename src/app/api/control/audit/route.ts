import { auditHistory } from "@/server/control";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The organisation's append-only audit history, newest first (?limit=1..1000, default 200). */
export const GET = (req: Request) => read(req, async (ctx) => {
  const n = Number(new URL(req.url).searchParams.get("limit") ?? "200");
  const limit = Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 200;
  return json(200, { events: await auditHistory(ctx, limit) });
});
