import { accessReview } from "@/server/access-review";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** v1 phase 1.4: who has access to what in this organisation (a merchant Admin or a Provider Admin, unscoped). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await accessReview(ctx)));
