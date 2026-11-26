import type { Metadata } from "next";
import { listBatches } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import { Chip, Empty, EvidenceChip, fiat } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Batches" };

export default async function BatchesPage() {
  const { ctx } = await merchantMember();
  const bs = await listBatches(ctx);
  return (
    <>
      <h1 className={s.title}>Settlement batches</h1>
      <p className={s.lede}>Each batch bridges the merchant&rsquo;s day to one bank credit. A batch is tied only when gross − fees − refunds = net = the bank line, to the cent. It is settled only when it ties and its bank evidence is at least an imported statement a second person confirmed (nothing is bank-authenticated yet). Cut-off: provider day = UTC.</p>
      {bs.length === 0 ? <Empty>No settlement batch has been ingested yet.</Empty> : (
        <div className={s.tableWrap} role="region" aria-label="Settlement batches table" tabIndex={0}>
          <table className={s.table}>
            <thead><tr><th scope="col">Batch</th><th scope="col">Entity</th><th scope="col">Provider day</th><th scope="col" className={s.num}>Gross</th><th scope="col" className={s.num}>Fees</th><th scope="col" className={s.num}>Refunds</th><th scope="col" className={s.num}>Net</th><th scope="col">Bank</th></tr></thead>
            <tbody>{bs.map((b) => (
              <tr key={b.batchId}>
                <td><a href={`/control/merchant/batches/${encodeURIComponent(b.batchId)}`}>{b.batchId}</a></td><td className={s.mono}>{b.entityId}</td><td>{b.providerDay}</td>
                <td className={s.num}>{fiat(b.grossMinor, b.currency)}</td><td className={s.num}>{fiat(b.feesMinor, b.currency)}</td><td className={s.num}>{fiat(b.refundsMinor, b.currency)}</td><td className={s.num}>{fiat(b.netMinor, b.currency)}</td>
                <td>{b.tied ? <Chip tone="ok">Tied to the cent</Chip> : <Chip tone="warn">Not tied</Chip>} {b.settled ? <Chip tone="ok">Settled</Chip> : <Chip tone="plain">Not settled</Chip>} <EvidenceChip level={b.bankEvidence} label={b.bankEvidenceLabel} />{b.bankLineId ? <><br /><span className={s.small}>{b.bankLineId}</span></> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
