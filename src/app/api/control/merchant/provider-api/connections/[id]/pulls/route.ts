import { listProviderPulls } from "@/server/provider-api";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The connection's pulls, newest first (counts, template version, status; never records). */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => json(200, await listProviderPulls(ctx, (await params).id)));
