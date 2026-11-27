import { mutate } from "@/server/control-http";
import { json } from "@/server/http";
import { DraftInput, draftJournalToLedger } from "@/server/ledger-connect";

export const dynamic = "force-dynamic";

/**
 * v1 phase 2.3: write one journal proposal to the connected ledger as a DRAFT (Finance). Refused while the posting
 * rules are unsigned. Idempotent per journal and ledger organisation.
 */
export const POST = (req: Request) => mutate(req, async (ctx, body) => {
  const r = await draftJournalToLedger(ctx, DraftInput.parse(body));
  return json(r.status, r.body);
});
