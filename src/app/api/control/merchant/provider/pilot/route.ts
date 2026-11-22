import { providerPilotMetrics } from "@/server/provider";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Pilot metrics of the provider's merchants, as aggregates. */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await providerPilotMetrics(ctx)));
