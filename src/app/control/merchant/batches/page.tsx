import type { Metadata } from "next";
import { listBatches } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import { Empty } from "@/components/merchant/ui";
import { BatchesTable } from "@/components/merchant/report-tables";

export const metadata: Metadata = { title: "Batches" };

export default async function BatchesPage() {
  const { ctx } = await merchantMember();
  const bs = await listBatches(ctx);
  return (
    <>
      <h1 className={s.title}>Settlement batches</h1>
      <p className={s.lede}>Each batch bridges the merchant&rsquo;s day to one bank credit. A batch is tied only when gross − fees − refunds = net = the bank line, to the cent. It is settled only when it ties and its bank evidence is at least an imported statement a second person confirmed (nothing is bank-authenticated yet). Cut-off: provider day = UTC.</p>
      {bs.length === 0 ? <Empty>No settlement batch has been ingested yet.</Empty> : (
        <BatchesTable rows={bs.map((b) => ({
          batchId: b.batchId, entityId: b.entityId, providerDay: b.providerDay, currency: b.currency, grossMinor: b.grossMinor, feesMinor: b.feesMinor, refundsMinor: b.refundsMinor, netMinor: b.netMinor,
          tied: b.tied, settled: b.settled, bankEvidence: b.bankEvidence, bankEvidenceLabel: b.bankEvidenceLabel, bankLineId: b.bankLineId,
        }))} />
      )}
    </>
  );
}
