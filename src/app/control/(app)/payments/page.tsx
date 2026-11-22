import type { Metadata } from "next";
import { describeStatus } from "@/lib/clearline";
import { listPayments } from "@/server/control";
import { pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { executionLabel, executionTone, money, PageTitle, reconciliationTone, settlementLabel, settlementTone, TableRegion, Tag } from "@/components/control/ui";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const ctx = await pageContext();
  const payments = await listPayments(ctx);
  return (
    <>
      <PageTitle title="Payments" lede="Three separate questions for every payment: what the provider reports (execution), what independent evidence shows (settlement), and whether our statement matches it (reconciliation)." />
      <TableRegion label="Payments">
        <table className={s.table} data-testid="payments-table">
          <caption>{payments.length} payments in {ctx.orgName}</caption>
          <thead>
            <tr><th scope="col">Reference</th><th scope="col">Beneficiary</th><th scope="col" className={s.num}>Amount</th><th scope="col">Execution</th><th scope="col">Settlement</th><th scope="col">Reconciliation</th><th scope="col">Open exceptions</th></tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} data-reference={p.reference}>
                <th scope="row"><a href={`/control/payments/${encodeURIComponent(p.id)}`}>{p.reference}</a></th>
                <td>{p.beneficiary}</td>
                <td className={s.num}>{money(p.amountMinor, p.currency)}</td>
                <td data-column="execution"><Tag tone={executionTone(p.execution)}>{executionLabel(p.execution)}</Tag></td>
                <td data-column="settlement"><Tag tone={settlementTone(p.settlement)}>{settlementLabel(p.settlement)}</Tag></td>
                <td data-column="reconciliation"><Tag tone={reconciliationTone(p.reconciliation)}>{describeStatus({ execution: p.execution, settlement: p.settlement, reconciliation: p.reconciliation, settlementScope: "none" }).reconciliation}</Tag></td>
                <td>{p.openExceptions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
