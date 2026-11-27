import { postingRulesStatus } from "@/server/posting-rules";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The posting-rules catalogue (every pattern with its generated worked examples), its version and the signatures. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await postingRulesStatus(ctx)));
