import { exceptionsView } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Open exceptions (owner, age, plain-English reason, next step, evidence) and payments suggested for review. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await exceptionsView(ctx)));
