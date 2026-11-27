import { read } from "@/server/control-http";
import { json } from "@/server/http";
import { paletteSearch } from "@/server/palette-search";

export const dynamic = "force-dynamic";

/** v1 design-fluid command palette: payment references, exception ids and batch ids in the member's own organisation (RLS, entity scope). */
export const GET = (req: Request) => read(req, async (ctx) => json(200, await paletteSearch(ctx, new URL(req.url).searchParams.get("q") ?? "")));
