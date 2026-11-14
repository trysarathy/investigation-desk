"use client";
import Link from "../Link";
import { FUNDING_PROJECTION_LABEL, formatMinor, formatMoney, fundingProjection, type CurrencyCode } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { AdvChip, ExcStatusChip, ExecChip, HoldChip, SettleChip, human, exceptionTitle } from "../labels";
import { Chip, Code, Dl, Empty, Notice, PageHead, Panel, fmtDate, fmtTime, ui } from "../ui";
import { FundingDeskPanel } from "../FundingDesk";
import { attributionOf } from "../evidence";
import { label } from "../human";


export default function Funding() {
  const { ws, actorName } = useWorkspace();
  const p = fundingProjection(ws);
  const totals = Object.entries(p.outstandingByCurrency) as [CurrencyCode, number][];
  return (
    <>
      <PageHead eyebrow="Treasury & Funding" title="Funding exposure"
        lede="Advances a provider made to pay suppliers before its customer reimburses it, linked to the supplier payout and to repayments matched by reference." />
      <Notice info>{FUNDING_PROJECTION_LABEL} For the full advance-and-repayment workflow, use the specialist Funding Desk at <Link href="/mentor-demo">/mentor-demo</Link> (below).</Notice>
      <Panel title="Outstanding by currency" id="totals">
        <div className={ui.panelBody}>
          <Dl items={totals.length ? totals.map(([c, m]) => [c, <strong key={c} className="num">{formatMinor(m, c)}</strong>]) : [["Outstanding", "None"]]} />
        </div>
      </Panel>
      {p.rows.length === 0 ? <Panel><Empty>No advances in this workspace.</Empty></Panel> : p.rows.map((r) => {
        const linkedEx = ws.exceptions.filter((e) => r.exceptionIds.includes(e.id));
        return (
          <Panel key={r.advanceId} id={r.advanceId} title={<>Advance <span className="mono">{r.advanceId}</span> · {r.customerName}</>} actions={<AdvChip v={r.state} basis={r.supplierPaidBasis} />}>
            <div className={ui.panelBody}>
              <div className={ui.grid3} data-testid="funding-figures">
                <div><p className={ui.eyebrow}>Advanced (principal)</p><p className="num" style={{ fontSize: 20, fontWeight: 650, margin: 0 }} data-testid="funding-principal">{formatMoney(r.principal)}</p></div>
                <div><p className={ui.eyebrow}>Repaid by reference</p><p className="num" style={{ fontSize: 20, fontWeight: 650, margin: 0 }} data-testid="funding-repaid">{formatMoney(r.repaid)}</p></div>
                <div><p className={ui.eyebrow}>Outstanding</p><p className="num" style={{ fontSize: 20, fontWeight: 650, margin: 0, color: "var(--cl-warning)" }} data-testid="funding-outstanding">{formatMoney(r.outstanding)}</p>
                  <p className={ui.hint} style={{ margin: 0 }}>Due {r.obligation ? fmtDate(r.obligation.dueDate + "T00:00:00+08:00") : "—"}{r.overdue ? " — overdue" : ""}</p></div>
              </div>
              <div style={{ marginTop: 14 }}>
                <Dl items={[
                  ["Supplier / invoice", <>{r.supplierName} · {r.invoiceRef}</>],
                  ["Supplier payout", <><Link href={`/clearline/payments/${r.intentId}`} className="mono">{r.intentId}</Link><br /><ExecChip v={r.supplierPayout.execution} /> <SettleChip v={r.supplierPayout.settlement} execution={r.supplierPayout.execution} />
                    {(r.supplierPayout.onHold || r.supplierPayout.hold) && (
                      <span style={{ display: "block", marginTop: 4 }} data-testid="supplier-payout-hold">
                        <Chip tone="warn" title={`API value: supplierPayout.onHold ${String(r.supplierPayout.onHold)}${r.supplierPayout.hold ? `, hold ${r.supplierPayout.hold.status}` : ""}`}>Partner holds the payout — supplier not paid</Chip>{" "}
                        {r.supplierPayout.hold && <><HoldChip v={r.supplierPayout.hold.status} /> <Link href={`/clearline/holds#${r.supplierPayout.hold.id}`}>Open the hold</Link></>}
                      </span>
                    )}</>],
                  ["Supplier paid — basis", <span key="b" data-testid="supplier-paid-basis">{label("supplierPaidBasis", r.supplierPaidBasis)} <span className={ui.apiValue}>{r.supplierPaidBasis}</span></span>],
                  ["Treasury approval", r.treasuryApproval ? <>{human(r.treasuryApproval.outcome)} — maker {actorName(r.treasuryApproval.makerId)}, checker {actorName(r.treasuryApproval.checkerId)} · {fmtTime(r.treasuryApproval.at)}</> : "Not decided"],
                  ["Repayment reference", r.obligation ? <Code>{r.obligation.reference}</Code> : "—"],
                  ["Funding Desk stage", r.fundingDeskStage],
                ]} />
              </div>
            </div>
            <div className={ui.panelHead} style={{ borderTop: "1px solid var(--cl-line)" }}><h3>Repayments allocated (evidence)</h3></div>
            {r.allocations.length === 0 ? <Empty>No repayments allocated yet.</Empty> : (
              <div className={ui.tableWrap} role="group" tabIndex={0} aria-label={`Repayments allocated to ${r.advanceId} table`}>
                <table className={`${ui.table} ${ui.stack}`}>
                  <thead><tr><th>Allocated</th><th>Statement line</th><th className={ui.r}>Amount</th><th>Matched by</th><th>Evidence</th></tr></thead>
                  <tbody>{r.allocations.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Allocated" className={ui.num}>{fmtTime(a.at)}</td>
                      <td data-label="Statement line"><Link href={`/clearline/reconciliation#${a.statementLineId}`} className="mono">{a.statementLineId}</Link></td>
                      <td data-label="Amount" className={`${ui.r} ${ui.num}`}>{formatMinor(a.amountMinor, a.currency)}</td>
                      <td data-label="Matched by">{human(a.matchedBy)}</td>
                      <td data-label="Evidence"><span className="mono">{a.evidenceId}</span>{(() => { const at = attributionOf(ws, a.evidenceId) ?? attributionOf(ws, a.statementLineId); return at ? <span className={ui.sub} data-testid="allocation-source">Source: {at.source}</span> : null; })()}</td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            )}
            {linkedEx.length > 0 && (
              <>
                <div className={ui.panelHead} style={{ borderTop: "1px solid var(--cl-line)" }}><h3>Exceptions (not allocated to this advance)</h3></div>
                <ul className={ui.panelBody} style={{ margin: 0, paddingLeft: 30 }} data-testid="funding-exceptions">
                  {linkedEx.map((e) => (
                    <li key={e.id}><Link href={`/clearline/exceptions?view=all#${e.id}`}>{exceptionTitle(e)}</Link> — {e.explanation} {e.impact && <strong className="num">{formatMoney(e.impact)}</strong>} <ExcStatusChip e={e} /> <Code>{e.explanationCode}</Code></li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        );
      })}
      <FundingDeskPanel />
    </>
  );
}
