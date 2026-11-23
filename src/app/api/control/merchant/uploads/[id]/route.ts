import { getUpload } from "@/server/uploads";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** One upload's status, mapping and counts. */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => json(200, await getUpload(ctx, (await params).id)));
