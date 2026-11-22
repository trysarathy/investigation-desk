import type { Metadata } from "next";
import { describeStatus } from "@/lib/clearline";
import { listPayments } from "@/server/control";
import { pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { money, PageTitle, reconciliationLabel, reconciliationTone, settlementLabel, settlementTone, TableRegion, Tag } from "@/components/control/ui";

export const metadata: Metadata = { title: "Reconciliation" };

/** Read-only: each payment's reconciliation state from the stored records. Statement import and matching controls come later. */
export default async function ReconciliationPage() {
  const ctx = await pageContext();
  const payments = await listPayments(ctx);
  const states = ["exception", "partially_matched", "pending", "not_started", "matched"] as const;
  const count = (st: string) => payments.filter((p) => p.reconciliation === st).length;
  return (
    <>
      <PageTitle title="Reconciliation" lede="Read-only. Whether each payment is matched to our bank statement, from the stored records. Statement import and matching controls are coming in a following change." />
      <ul className={`${s.grid4} ${s.plainList} ${s.section}`}>
        {states.map((st) => <li className={s.stat} key={st}><span className={s.statValue}>{count(st)}</span><span className={s.statLabel}>{reconciliationLabel(st)}</span></li>)}
      </ul>
      <TableRegion label="Reconciliation by payment">
        <table className={s.table}>
          <thead><tr><th scope="col">Reference</th><th scope="col">Beneficiary</th><th scope="col" className={s.num}>Amount</th><th scope="col">Reconciliation</th><th scope="col">Settlement</th></tr></thead>
          <tbody>
            {[...payments].sort((a, b) => states.indexOf(a.reconciliation as (typeof states)[number]) - states.indexOf(b.reconciliation as (typeof states)[number])).map((p) => (
              <tr key={p.id}>
                <th scope="row"><a href={`/control/payments/${encodeURIComponent(p.id)}`}>{p.reference}</a></th>
                <td>{p.beneficiary}</td>
                <td className={s.num}>{money(p.amountMinor, p.currency)}</td>
                <td><Tag tone={reconciliationTone(p.reconciliation)}>{describeStatus({ execution: p.execution, settlement: p.settlement, reconciliation: p.reconciliation, settlementScope: "none" }).reconciliation}</Tag></td>
                <td><Tag tone={settlementTone(p.settlement)}>{settlementLabel(p.settlement)}</Tag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
