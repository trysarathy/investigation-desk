import { uploadPreview } from "@/server/uploads";
import { read } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** The first 20 rows of the stored file and the suggested mapping (template or header suggestions; never confirmed). */
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) => read(req, async (ctx) => json(200, await uploadPreview(ctx, (await params).id)));
