import { listMerchantApprovals } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Write-off and resolution requests of this merchant, newest first, with their payload, hash and decisions. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await listMerchantApprovals(ctx)));
