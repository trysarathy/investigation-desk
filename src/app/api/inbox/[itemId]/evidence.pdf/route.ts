// GET ?actor=…: the evidence pack for one inbox item, as a PDF. IDs resolved through the same
// resolver as /api/payments/resolve. Audit-logged.

import { checkActor } from "@/lib/payments/audit";
import { evidencePack } from "@/lib/payments/export";
import { auditLog, inboxStore, paymentsStore, whoFrom } from "@/lib/payments/live";
import { renderPack } from "@/lib/payments/pdf";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const who = whoFrom(req, new URL(req.url).searchParams.get("actor"));
  const err = checkActor(who.actor, "exporting");
  if (err) return new Response(err, { status: 422 });
  const at = new Date();
  const pack = evidencePack(itemId, await paymentsStore().load(), await inboxStore().load(), await auditLog().list(), at);
  if (!pack) return new Response(`No inbox item ${itemId}.`, { status: 404 });
  await auditLog().append([{ at: at.toISOString(), actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: "export.evidence_pack", subject: itemId, detail: "Evidence pack downloaded (PDF)" }]);
  const pdf = await renderPack(pack);
  return new Response(Buffer.from(pdf), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `attachment; filename="evidence-${itemId}.pdf"`,
  } });
}
