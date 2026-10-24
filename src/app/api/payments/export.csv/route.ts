// GET ?actor=…: the reconciled export, one row per payment plus one per retired payment ID.
// Every ID is looked up through the same resolver as /api/payments/resolve. Audit-logged.

import { checkActor } from "@/lib/payments/audit";
import { reconciledCsv } from "@/lib/payments/export";
import { auditLog, inboxStore, paymentsStore, refreshInbox, whoFrom } from "@/lib/payments/live";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const who = whoFrom(req, new URL(req.url).searchParams.get("actor"));
  const err = checkActor(who.actor, "exporting");
  if (err) return new Response(err, { status: 422 });
  await refreshInbox();
  const data = await paymentsStore().load();
  const csv = reconciledCsv(data, await inboxStore().load());
  const at = new Date();
  await auditLog().append([{ at: at.toISOString(), actor: who.actor, actorKind: "person", ...(who.ip ? { ip: who.ip } : {}),
    action: "export.csv", subject: "reconciled export", detail: `${(data.match?.result.payments.length ?? 0)} payments` }]);
  return new Response(csv, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="reconciled-${at.toISOString().slice(0, 10)}.csv"`,
  } });
}
