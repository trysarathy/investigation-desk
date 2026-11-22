import { exceptionDetail } from "@/server/merchant-ui";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => json(200, await exceptionDetail(ctx, (await params).id)));
