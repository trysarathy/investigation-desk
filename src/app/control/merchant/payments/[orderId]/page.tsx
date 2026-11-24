/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import { Fragment } from "react";
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { orNotFound } from "@/server/control-page";
import { merchantPaymentDetail } from "@/server/merchant";
import { paymentContext, type StoredBank, type StoredExplanation, type StoredLedger, type StoredProviderRecord, type StoredTransfer } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { SubmitWriteoff } from "@/components/merchant/forms";
import { FlashMessage } from "@/components/control/forms";
import { Chip, DecisionChip, STEP_NAMES, bankStatusLabel, differenceLabel, fiat, token } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Payment" };

const WO_STATUS: Record<string, string> = { proposed: "Proposed by the engine", awaiting_approval: "Awaiting a second person's approval", approved: "Approved by a second person", rejected: "Rejected", superseded: "Superseded by a later reconciliation" };
const KIND_LABEL: Record<string, string> = { chain: "Chain", provider: "Provider", settlement: "Settlement", bank: "Bank", reconciliation: "Clearline", exception: "Exception", note: "Note", evidence: "Evidence", approval: "Approval", decision: "Decision" };

export default async function MerchantPaymentPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { ctx } = await merchantMember();
  const { orderId: raw } = await params;
  const orderId = decodeURIComponent(raw);
  const [d, c] = await Promise.all([orNotFound(merchantPaymentDetail(ctx, orderId)), orNotFound(paymentContext(ctx, orderId))]);
  const chain = d.parts.chain as { transfers: StoredTransfer[]; pending: { txHash: string }[] };
  const provider = d.parts.provider as { records: StoredProviderRecord[]; note: string };
  const bank = d.parts.bank as StoredBank;
  const ledger = d.parts.ledger as StoredLedger;
  const ex = d.explanation as StoredExplanation;
  const cur = ledger.invoice.currency;
  const mayPropose = can(ctx.role, "propose_writeoff");
  const fin = (r: (typeof c.chainRows)[number] | undefined) => (r ? (r.finalised ? "final" : "not final") : "—");

  return (
    <>
      <p className={s.small}><a href="/control/merchant/payments">← All payments</a></p>
      <h1 className={s.title}>{orderId}</h1>
      <p className={s.lede}>Invoice {fiat(ledger.invoice.amountMinor, cur)} · entity {c.entityId} · issued {when(c.issuedAt)} · <DecisionChip decision={d.decision} /></p>

      <section className={s.section} aria-labelledby="five">
        <h2 className={s.h2} id="five">Five records, side by side</h2>
        <p className={s.small}>Each record says only what its own source says. They are never merged into one status.</p>
        <div className={m.five}>
          <article className={m.part} aria-labelledby="p-chain" data-testid="part-chain">
            <h3 className={m.partName} id="p-chain">Chain</h3>
            <div className={m.partBody}>
              {chain.transfers.length === 0 ? <p>No transfer found for this order.</p> : chain.transfers.map((x) => {
                const row = c.chainRows.find((r) => r.txHash === x.txHash && r.logIndex === x.logIndex);
                return (
                  <dl className={m.kv} key={`${x.txHash}:${x.logIndex}`}>
                    <dt>Amount</dt><dd>{token(x.amountBaseUnits, x.decimals, x.symbol)}</dd>
                    <dt>Network</dt><dd>{x.network}</dd>
                    <dt>Tx</dt><dd className={s.mono}>{x.txHash}</dd>
                    <dt>Block</dt><dd>{x.block} · {x.confirmations} conf. · {fin(row)}</dd>
                    <dt>To</dt><dd className={s.mono}>{x.to}</dd>
                    <dt>Sender</dt><dd>{x.senderFacts.length ? x.senderFacts.join(", ").replace(/_/g, " ") : "no recorded facts"} (a fact, never a judgement)</dd>
                    <dt>When</dt><dd>{when(x.timestamp)}</dd>
                  </dl>
                );
              })}
              {chain.pending.length ? <p><Chip tone="amber">{chain.pending.length} pending (not final)</Chip></p> : null}
              <p className={s.muted}>Recorded fixture (no live chain connection).</p>
            </div>
          </article>
          <article className={m.part} aria-labelledby="p-provider" data-testid="part-provider">
            <h3 className={m.partName} id="p-provider">Provider</h3>
            <div className={m.partBody}>
              {provider.records.length === 0 ? <p>No provider record.</p> : provider.records.map((r) => (
                <dl className={m.kv} key={r.providerPaymentId}>
                  <dt>Record</dt><dd className={s.mono}>{r.providerPaymentId}</dd>
                  <dt>Claims</dt><dd>{r.statusClaim.replace(/_/g, " ")}{r.displayedStatus ? ` (shown as “${r.displayedStatus}”)` : ""}</dd>
                  <dt>Credited</dt><dd>{fiat(r.creditedMinor, cur)}</dd>
                  <dt>Rate</dt><dd>{r.executedRate}</dd>
                  {r.feeMinor ? <><dt>Fee</dt><dd>{fiat(r.feeMinor, cur)}</dd></> : null}
                  <dt>Batch</dt><dd>{r.batchId ? <a href={`/control/merchant/batches/${encodeURIComponent(r.batchId)}`}>{r.batchId}</a> : "none"}</dd>
                </dl>
              ))}
              <p className={s.muted}>Provider statuses are claims, not proof.</p>
            </div>
          </article>
          <article className={m.part} aria-labelledby="p-bank" data-testid="part-bank">
            <h3 className={m.partName} id="p-bank">Bank</h3>
            <div className={m.partBody}>
              <p><Chip tone={bank.settlementVerified ? "ok" : "warn"}>{bank.settlementVerified ? "Settlement verified" : "Settlement not verified"}</Chip></p>
              <dl className={m.kv}>
                <dt>Status</dt><dd>{bankStatusLabel(bank.status)}</dd>
                <dt>Batch</dt><dd>{bank.batchIds.length ? bank.batchIds.map((b) => <a key={b} className={s.mono} href={`/control/merchant/batches/${encodeURIComponent(b)}`}>{b}</a>) : "none"}</dd>
                <dt>Tied</dt><dd>{bank.batchTied ? "Yes, to the cent" : "No"}</dd>
                {c.bankLines.map((l) => <Fragment key={l.lineId}><dt>Line</dt><dd><span className={s.mono}>{l.lineId}</span> · {fiat(l.amountMinor, l.currency)} · {l.valueDate}{l.source === "csv_import" ? " · imported, not bank-authenticated" : ""}</dd></Fragment>)}
              </dl>
            </div>
          </article>
          <article className={m.part} aria-labelledby="p-ledger" data-testid="part-ledger">
            <h3 className={m.partName} id="p-ledger">Ledger</h3>
            <div className={m.partBody}>
              <dl className={m.kv}>
                <dt>Invoice</dt><dd>{fiat(ledger.invoice.amountMinor, cur)}</dd>
                <dt>Credited</dt><dd>{fiat(ledger.creditedMinor, cur)}</dd>
                <dt>Open</dt><dd>{fiat(ledger.openBalanceMinor, cur)}</dd>
                {ledger.customerOverpaymentMinor !== "0" ? <><dt>Overpaid</dt><dd>{fiat(ledger.customerOverpaymentMinor, cur)} (customer liability)</dd></> : null}
                <dt>Balance</dt><dd>{ledger.balanceLabel}</dd>
              </dl>
            </div>
          </article>
          <article className={m.part} aria-labelledby="p-expl" data-testid="part-explanation">
            <h3 className={m.partName} id="p-expl">Explanation</h3>
            <div className={m.partBody}>
              <p><DecisionChip decision={d.decision} /></p>
              <p data-testid="deciding-step">Decided at step {d.decidingStep} ({STEP_NAMES[d.decidingStep] ?? "?"}) by rule <span className={s.mono}>{d.ruleId}</span>.</p>
              <ol className={s.small}>{ex.history.map((h, i) => <li key={i}>Step {h.step} · {h.outcome}: {h.detail}</li>)}</ol>
              <p className={s.muted}>Engine {d.engineVersion}; input sha256 <span className={s.mono}>{d.inputSha256.slice(0, 16)}…</span></p>
            </div>
          </article>
        </div>
      </section>

      <section className={s.section} aria-labelledby="diffs">
        <h2 className={s.h2} id="diffs">Differences</h2>
        {(d.differences as unknown[]).length === 0 ? <p>No differences: the records agree.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Differences table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Type</th><th scope="col" className={s.num}>Amount</th><th scope="col">Reason</th><th scope="col">Rule</th></tr></thead>
              <tbody>{(d.differences as { id: string; type: string; amountMinor: string; currency: string; reason: string; ruleId: string }[]).map((x) => (
                <tr key={x.id}><td><Chip tone="info">{differenceLabel(x.type)}</Chip></td><td className={s.num}>{fiat(x.amountMinor, x.currency)}</td><td>{x.reason}</td><td className={s.mono}>{x.ruleId}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section} aria-labelledby="attention">
        <h2 className={s.h2} id="attention">Exceptions and write-offs</h2>
        {d.exceptions.length === 0 && (d.writeoffs as unknown[]).length === 0 ? <p>Nothing needs a person for this payment.</p> : null}
        {d.exceptions.map((e) => (
          <div className={s.panel} key={e.id}>
            <p className={s.row}><a href={`/control/merchant/exceptions/${encodeURIComponent(e.id)}`}><strong>{e.id}</strong></a> <Chip tone={e.status === "resolved" ? "ok" : "warn"}>{e.status.replace("_", " ")}</Chip> <span className={s.small}>Owner: {e.ownerRole}</span></p>
            <p>{e.reason}</p><p className={s.small}><strong>Next step:</strong> {e.nextStep}</p>
          </div>
        ))}
        {(d.writeoffs as { id: string; amountMinor: string; currency: string; status: string }[]).map((w) => (
          <div className={s.panel} key={w.id}>
            <p className={s.row}><strong>Write-off {fiat(w.amountMinor, w.currency)}</strong> <Chip tone={w.status === "approved" ? "ok" : w.status === "rejected" ? "warn" : "amber"}>{WO_STATUS[w.status] ?? w.status}</Chip></p>
            <p className={s.small}>The engine proposes it; Finance submits it; a different Approver decides it on the <a href="/control/merchant/approvals">Approvals</a> page.</p>
            {w.status === "proposed" && mayPropose ? <SubmitWriteoff writeoffId={w.id} amount={fiat(w.amountMinor, w.currency)} /> : <FlashMessage flashKey={`writeoff:${w.id}`} />}
          </div>
        ))}
      </section>

      <section className={s.section} aria-labelledby="timeline">
        <h2 className={s.h2} id="timeline">Evidence timeline</h2>
        <ol className={s.timeline}>
          {c.timeline.map((x, i) => (
            <li key={i} className={x.independent ? s.timelineIndependent : undefined}>
              <p className={s.small}><strong>{when(x.at)}</strong> · {KIND_LABEL[x.kind]} · {x.independent ? <Chip tone="ok">Independent evidence</Chip> : <Chip>Not independent</Chip>}</p>
              <p><strong>{x.title}</strong></p>
              <p className={s.small}>{x.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={s.section} aria-labelledby="pack">
        <h2 className={s.h2} id="pack">Evidence pack</h2>
        <p className={s.small}>Chain proof, provider record, bank line, approvals and audit trail for this payment. Each download is recorded in the audit history. {d.label}.</p>
        {can(ctx.role, "merchant_export") ? (
          <ul className={m.downloads}>
            <li><a href={`/api/control/merchant/evidence?order=${encodeURIComponent(orderId)}&format=pdf`} download>Download PDF summary</a></li>
            <li><a href={`/api/control/merchant/evidence?order=${encodeURIComponent(orderId)}&format=csv`} download>Download CSV</a></li>
            <li><a href={`/api/control/merchant/evidence?order=${encodeURIComponent(orderId)}&format=json`} download>Download JSON</a></li>
          </ul>
        ) : <p className={s.small} data-testid="export-not-allowed">Evidence packs are downloaded by Finance, an Approver or an Admin.</p>}
      </section>

      <section className={s.section} aria-labelledby="audit">
        <h2 className={s.h2} id="audit">Audit history</h2>
        {c.audit.length === 0 ? <p>No recorded actions yet.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Audit history table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th></tr></thead>
              <tbody>{c.audit.map((a) => <tr key={a.seq}><td>{when(a.at)}</td><td>{a.actor}</td><td>{a.summary}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
