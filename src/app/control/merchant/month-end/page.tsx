import type { Metadata } from "next";
import { MERCHANT_ACCOUNTS } from "@/lib/clearline/merchant";
import { dataAsOf, monthEndView } from "@/server/merchant-ui";
import { can } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { EntityMonthForm, pickEntityMonth } from "@/components/merchant/EntityMonth";
import { Empty, PendingSignOff, one } from "@/components/merchant/ui";
import { FiatAmount } from "@/components/merchant/FiatAmount";
import { StaticTable } from "@/components/merchant/StaticTable";
import { Mono, StatusBadge } from "@/components/ui";
import g from "@/components/merchant/screens-g2.module.css";
import { NEEDS_A_RATE } from "@/lib/clearline/merchant/fiat-value";
import { listPeriods } from "@/server/period-close";
import { DecidePeriodLock, RequestPeriodLock } from "@/components/merchant/period-close";

export const metadata: Metadata = { title: "Month-end" };

export default async function MonthEndPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, shell } = await merchantMember();
  const sp = await searchParams;
  const pick = pickEntityMonth(shell.entities, one(sp.entity), one(sp.month));
  if (!pick) return (<><h1 className={s.title}>Month-end</h1><Empty>No entities are set up yet.</Empty></>);
  const { entity, month } = pick;
  const v = await monthEndView(ctx, entity.id, month, dataAsOf(shell.entities));
  const cur = v.currency;
  const ready = v.journals.filter((j) => j.status === "proposed");
  const periods = await listPeriods(ctx, entity.id);
  const lock = periods.periods.find((p) => p.period === month);
  return (
    <>
      <h1 className={s.title}>Month-end</h1>
      <p className={s.lede}>What is still open at the end of {month} for {entity.name}: money the provider has confirmed but not yet settled, exceptions by age, foreign-currency balances and the journal proposals ready to export.</p>
      <EntityMonthForm action="/control/merchant/month-end" entities={shell.entities} entity={entity} month={month} label="Choose entity and month" />

      <section className={s.section} aria-labelledby="signoff">
        <h2 className={s.h2} id="signoff">Month-end sign-off</h2>
        <p className={s.small} data-testid="period-status">{lock?.status === "locked" ? `${month} is locked: nothing in it can change. A later run that would decide one of its payments differently files a correction in the next open month.`
          : lock?.status === "requested" ? `${month} is waiting for an Admin to lock it (the person who asked cannot).` : lock?.status === "rejected" ? `The last sign-off request for ${month} was rejected; it can be asked again.` : `${month} is open.`}</p>
        {(!lock || lock.status === "rejected") && can(ctx.role, "period_close_request") ? <RequestPeriodLock entityId={entity.id} period={month} /> : null}
        {lock?.status === "requested" && !lock.mine && can(ctx.role, "period_close_approve") ? <DecidePeriodLock entityId={entity.id} period={month} /> : null}
        {periods.corrections.length ? (
          <div className={g.wrap} role="region" aria-label="Corrections of locked months" tabIndex={0}>
            <table className={g.dense}>
              <thead><tr><th scope="col">Payment</th><th scope="col">Corrects</th><th scope="col">Filed in</th><th scope="col">Decision kept</th><th scope="col">Would now be</th></tr></thead>
              <tbody>{periods.corrections.map((c) => (
                <tr key={c.id}><td><a href={`/control/merchant/payments/${encodeURIComponent(c.orderId)}`}>{c.orderId}</a></td><td>{c.correctsPeriod}</td><td>{c.correctionPeriod}</td>
                  <td>{c.storedDecision ?? "none"} <span className={s.mono}>{c.storedRuleId ?? ""}</span></td><td>{c.newDecision} <span className={s.mono}>{c.newRuleId}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={s.section} aria-labelledby="recv">
        <h2 className={s.h2} id="recv">Confirmed but not settled (receivable from the provider)</h2>
        {v.receivableFromProvider.length === 0 ? <p>None: every payment the provider confirmed this month is in a batch verified against a bank line.</p> : (
          <div role="region" aria-label="Receivable from the provider table" tabIndex={0} className={g.region}>
            <StaticTable label="Receivable from the provider" filterLabel="Filter batches"
              columns={[
                { id: "batch", header: "Batch", sortable: true, hideable: false, rowHeader: true },
                { id: "amount", header: "Confirmed by the provider", numeric: true, sortable: true },
                { id: "payments", header: "Payments", sortable: true },
                { id: "why", header: "Why it is open", sortable: true },
              ]}
              rows={v.receivableFromProvider.map((g2) => ({
                key: g2.batchId,
                sort: { batch: g2.batchId, amount: String(g2.creditedMinor), payments: g2.orderIds.join(" "), why: g2.reason },
                cells: {
                  batch: g2.batchId.startsWith("(") ? g2.batchId : <a href={`/control/merchant/batches/${encodeURIComponent(g2.batchId)}`} className={g.mono}>{g2.batchId}</a>,
                  amount: <FiatAmount minor={g2.creditedMinor} currency={cur} />,
                  payments: <span className={g.wrapCell}>{g2.orderIds.map((o, i) => <span key={o}>{i ? ", " : ""}<a href={`/control/merchant/payments/${encodeURIComponent(o)}`} className={g.mono}>{o}</a></span>)}</span>,
                  why: <span className={g.wrapCell}>{g2.reason}</span>,
                },
              }))} />
          </div>
        )}
        <p className={s.small} data-testid="open-receivables">Open accounts receivable from customers (all payments of the entity): <FiatAmount minor={v.openReceivablesMinor} currency={cur} />{v.openReceivablesNeedingRate.count
          // v1 (#173): an open balance without a recorded rate is not counted as 0; it is named apart
          ? <>, plus {v.openReceivablesNeedingRate.count === 1 ? "1 token-priced invoice" : `${v.openReceivablesNeedingRate.count} token-priced invoices`} whose open balance {NEEDS_A_RATE} ({v.openReceivablesNeedingRate.orderIds.join(", ")}), not included in that total</> : null}.</p>
      </section>

      <section className={s.section} aria-labelledby="ages">
        <h2 className={s.h2} id="ages">Open exceptions by age ({v.openExceptions})</h2>
        {v.openExceptions ? <p className={s.row}><StatusBadge kind="exception" label={`${v.openExceptions} open`} /></p> : <p className={s.row}><StatusBadge kind="matched" label="No open exceptions" /></p>}
        <ul className={m.kpis}>{v.exceptionAges.map((a) => (
          <li className={m.kpi} key={a.label}><span className={m.kpiValue}>{a.ids.length}</span><span className={m.kpiLabel}>{a.label}</span>{a.ids.length ? <p className={s.small}>{a.ids.map((id, i) => <span key={id}>{i ? ", " : ""}<a href={`/control/merchant/exceptions/${encodeURIComponent(id)}`}>{id}</a></span>)}</p> : null}</li>
        ))}</ul>
        <p className={s.small}>Ages are measured from the latest data of this pilot. Write-offs: {v.writeoffs.pending} not yet decided, {v.writeoffs.approved} approved.</p>
      </section>

      <section className={s.section} aria-labelledby="fx">
        <h2 className={s.h2} id="fx">FX revaluation note</h2>
        <div className={s.panel}>
          <p>{entity.id} keeps its books in {v.fx.functionalCurrency}. {v.fx.foreignCurrencies.length ? `It holds balances in ${v.fx.foreignCurrencies.join(", ")}, which are revalued at the month-end closing rate.` : "Its settlements are in its own currency, so no balance needs revaluation; stablecoin receipts are converted at the provider's executed rate on each payment."}</p>
          <p className={s.small}>Clearline records the rates it saw and proposes no revaluation entry [assumption: the closing-rate source and the revaluation posting rule are for your accountant to set]. Rates on file:</p>
          {v.fx.rates.length ? <ul className={s.small}>{v.fx.rates.map((r) => <li key={`${r.pair}-${r.observedAt}`}><Mono>{r.pair} {r.rate}</Mono> ({r.source}, {r.observedAt.slice(0, 16).replace("T", " ")} UTC)</li>)}</ul> : <p className={s.small}>No rates on file.</p>}
        </div>
      </section>

      <section className={s.section} aria-labelledby="journals">
        <h2 className={s.h2} id="journals">Journal proposals ready to export ({ready.length})</h2>
        <p className={s.row}><PendingSignOff /> <span className={s.small}>Every proposal stays a proposal; nothing is posted. Until an Admin signs the current <a href="/control/merchant/posting-rules">posting rules</a>, every journal is a draft. <a href={`/control/merchant/accounting?entity=${encodeURIComponent(entity.id)}&month=${month}`}>Open the accounting export</a>.</span></p>
        {Object.keys(v.balances).length ? (
          <div className={g.wrap} role="region" aria-label="Net movement by account table" tabIndex={0}>
            <table className={g.dense}>
              <caption>Net movement by account if every proposal were posted (debit positive)</caption>
              <thead><tr><th scope="col">Account</th><th scope="col" className={g.num}>Net</th></tr></thead>
              <tbody>{Object.entries(v.balances).map(([k, x]) => <tr key={k}><td>{MERCHANT_ACCOUNTS[k as keyof typeof MERCHANT_ACCOUNTS] ?? k}</td><td className={g.num}><FiatAmount minor={x} currency={cur} tone /></td></tr>)}</tbody>
            </table>
          </div>
        ) : <p>No journal proposals for this month.</p>}
      </section>

      <section className={s.section} aria-labelledby="exports">
        <h2 className={s.h2} id="exports">Exports</h2>
        {can(ctx.role, "merchant_export") ? (
          <>
            <p className={s.small}>Files only: nothing is posted to any ledger. Journal drafts are for a Xero demo company or a QuickBooks sandbox, for an accountant to review; posting rules are pending sign-off.</p>
            <ul className={`${s.small} ${g.downloadList}`}>
              <li><a style={{ display: "inline-block", padding: "4px 0" }} data-testid="month-end-pack" href={`/api/control/merchant/exports/month-end?entity=${encodeURIComponent(entity.id)}&month=${month}`}>Download the month-end pack (ZIP)</a>: bridges, open exceptions with owner, reason and next step, journal proposals, provenance of every file used, rule-set version.</li>
              <li><a style={{ display: "inline-block", padding: "4px 0" }} data-testid="month-end-pdf" href={`/api/control/merchant/exports/month-end?entity=${encodeURIComponent(entity.id)}&month=${month}&format=pdf`}>Month-end pack (PDF)</a> · <a style={{ display: "inline-block", padding: "4px 0" }} data-testid="month-end-xlsx" href={`/api/control/merchant/exports/month-end?entity=${encodeURIComponent(entity.id)}&month=${month}&format=xlsx`}>(XLSX)</a>: bridges, receivable from the provider by batch, exceptions by age, write-offs with preparer and approver, FX revaluation, journals with their sign-off status, the evidence index with each payment&apos;s bank evidence level, and the checks that the totals agree across sections.</li>
              <li><a style={{ display: "inline-block", padding: "4px 0" }} href={`/api/control/merchant/exports/journal-draft?entity=${encodeURIComponent(entity.id)}&month=${month}&tool=xero`}>Xero manual journal draft (CSV)</a></li>
              <li><a style={{ display: "inline-block", padding: "4px 0" }} href={`/api/control/merchant/exports/journal-draft?entity=${encodeURIComponent(entity.id)}&month=${month}&tool=quickbooks`}>QuickBooks journal draft (CSV)</a></li>
            </ul>
          </>
        ) : <p className={s.small} data-testid="export-not-allowed">Exports are made by Finance, an Approver or an Admin.</p>}
      </section>
    </>
  );
}
