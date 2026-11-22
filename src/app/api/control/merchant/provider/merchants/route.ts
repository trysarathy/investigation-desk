import { providerMerchants } from "@/server/provider";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The provider's merchants with health aggregates (no merchant rows). Provider Admin and Provider Ops. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await providerMerchants(ctx)));
