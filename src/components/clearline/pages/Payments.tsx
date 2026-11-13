"use client";
import Link from "../Link";
import { useSearchParams } from "next/navigation";
import { formatMoney, listExceptions } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { EXECUTION, ExecChip, RECON, ReconChip, SCOPE, SETTLEMENT, SettleChip, RAIL } from "../labels";
import { Empty, LinkBtn, PageHead, Panel, ui } from "../ui";

export default function Payments() {
  const { ws } = useWorkspace();
  const q = useSearchParams();
  const execution = q?.get("execution") ?? "";
  const settlement = q?.get("settlement") ?? "";
  const reconciliation = q?.get("reconciliation") ?? "";
  const rows = ws.intents.filter((i) =>
    (!execution || i.status.execution === execution) &&
    (!settlement || i.status.settlement === settlement) &&
    (!reconciliation || i.status.reconciliation === reconciliation));
  const filters = [
    execution && `Execution: ${EXECUTION[execution as keyof typeof EXECUTION]?.[0] ?? execution}`,
    settlement && `Settlement evidence: ${SETTLEMENT[settlement as keyof typeof SETTLEMENT]?.[0] ?? settlement}`,
    reconciliation && `Reconciliation: ${RECON[reconciliation as keyof typeof RECON]?.[0] ?? reconciliation}`,
  ].filter(Boolean);
  const instr = (id?: string) => ws.instructions.find((x) => x.id === id);

  return (
    <>
      <PageHead eyebrow="Workspace" title="Payments"
        lede="Every payment shows three separate states: what the provider reports (execution), what evidence of settlement exists, and whether it reconciles."
        actions={<LinkBtn href="/clearline/connect" kind="primary">New payment intent</LinkBtn>} />
      {filters.length > 0 && (
        <p className={ui.actions} role="status">Filtered by {filters.join(", ")}. <Link href="/clearline/payments">Clear filter</Link></p>
      )}
      <Panel title={`${rows.length} payment${rows.length === 1 ? "" : "s"}`} id="payments">
        {rows.length === 0 ? <Empty>No payments match. <Link href="/clearline/connect">Create a payment intent</Link> or <Link href="/clearline/settings">reset to the sample workspace</Link>.</Empty> : (
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Payments">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Payment</th><th>Beneficiary</th><th className={ui.r}>Amount</th><th>Provider / rail</th><th>Execution</th><th>Settlement evidence</th><th>Reconciliation</th><th>Open exceptions</th></tr></thead>
              <tbody>
                {rows.map((i) => {
                  const q = ws.quotes.find((x) => x.id === i.selectedQuoteId);
                  const ex = listExceptions(ws, { intentId: i.id }).filter((e) => e.status !== "resolved").length;
                  const pp = instr(i.instructionId)?.providerPaymentId;
                  return (
                    <tr key={i.id}>
                      <td data-label="Payment"><Link href={`/clearline/payments/${i.id}`} className="mono">{i.id}</Link><span className={ui.sub}>{i.internalReference}</span></td>
                      <td data-label="Beneficiary">{i.beneficiaryName}<span className={ui.sub}>{i.destinationCountry} · {i.destinationCurrency}</span></td>
                      <td data-label="Amount" className={`${ui.r} ${ui.num}`}>{formatMoney({ amountMinor: i.amountMinor, currency: i.sourceCurrency })}</td>
                      <td data-label="Provider / rail">{q ? q.providerName : "Not chosen"}<span className={ui.sub}>{q ? RAIL[q.rail] : "—"}{pp ? ` · ${pp}` : ""}</span></td>
                      <td data-label="Execution"><ExecChip v={i.status.execution} /></td>
                      <td data-label="Settlement evidence"><SettleChip v={i.status.settlement} /><span className={ui.sub}>{SCOPE[i.status.settlementScope]}</span></td>
                      <td data-label="Reconciliation"><ReconChip v={i.status.reconciliation} /></td>
                      <td data-label="Open exceptions" className={ui.num}>{ex > 0 ? <Link href={`/clearline/exceptions?intent=${i.id}`}>{ex}</Link> : "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
