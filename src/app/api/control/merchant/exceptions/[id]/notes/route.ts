import { ExceptionNote, addExceptionNote } from "@/server/merchant-ui";
import { mutate } from "@/server/control-http";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** A note, or evidence attached by a person (a description and reference; never independent evidence; no file stored). */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => mutate(req, async (ctx, body, key) => {
  const r = await addExceptionNote(ctx, (await params).id, ExceptionNote.parse(body), key);
  return json(r.status, { ...r.body, replayed: r.replayed });
});
