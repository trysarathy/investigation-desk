import type { Metadata } from "next";
import { MERCHANT_ACCOUNTS } from "@/lib/clearline/merchant";
import { dataAsOf, monthEndView } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { EntityMonthForm, pickEntityMonth } from "@/components/merchant/EntityMonth";
import { Empty, PendingSignOff, fiat, one } from "@/components/merchant/ui";

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
  return (
    <>
      <h1 className={s.title}>Month-end</h1>
      <p className={s.lede}>What is still open at the end of {month} for {entity.name}: money the provider has confirmed but not yet settled, exceptions by age, foreign-currency balances and the journal proposals ready to export.</p>
      <EntityMonthForm action="/control/merchant/month-end" entities={shell.entities} entity={entity} month={month} label="Choose entity and month" />

      <section className={s.section} aria-labelledby="recv">
        <h2 className={s.h2} id="recv">Confirmed but not settled (receivable from the provider)</h2>
        {v.receivableFromProvider.length === 0 ? <p>None: every payment the provider confirmed this month is in a batch verified against a bank line.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Receivable from the provider table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Batch</th><th scope="col" className={s.num}>Confirmed by the provider</th><th scope="col">Payments</th><th scope="col">Why it is open</th></tr></thead>
              <tbody>{v.receivableFromProvider.map((g) => (
                <tr key={g.batchId}>
                  <td>{g.batchId.startsWith("(") ? g.batchId : <a href={`/control/merchant/batches/${encodeURIComponent(g.batchId)}`}>{g.batchId}</a>}</td>
                  <td className={s.num}>{fiat(g.creditedMinor, cur)}</td>
                  <td>{g.orderIds.map((o, i) => <span key={o}>{i ? ", " : ""}<a href={`/control/merchant/payments/${encodeURIComponent(o)}`}>{o}</a></span>)}</td>
                  <td>{g.reason}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className={s.small}>Open accounts receivable from customers (all payments of the entity): {fiat(v.openReceivablesMinor, cur)}.</p>
      </section>

      <section className={s.section} aria-labelledby="ages">
        <h2 className={s.h2} id="ages">Open exceptions by age ({v.openExceptions})</h2>
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
          {v.fx.rates.length ? <ul className={s.small}>{v.fx.rates.map((r) => <li key={`${r.pair}-${r.observedAt}`}>{r.pair} {r.rate} ({r.source}, {r.observedAt.slice(0, 16).replace("T", " ")} UTC)</li>)}</ul> : <p className={s.small}>No rates on file.</p>}
        </div>
      </section>

      <section className={s.section} aria-labelledby="journals">
        <h2 className={s.h2} id="journals">Journal proposals ready to export ({ready.length})</h2>
        <p className={s.row}><PendingSignOff /> <span className={s.small}>Every proposal stays a proposal; nothing is posted. <a href={`/control/merchant/accounting?entity=${encodeURIComponent(entity.id)}&month=${month}`}>Open the accounting export</a>.</span></p>
        {Object.keys(v.balances).length ? (
          <div className={s.tableWrap} role="region" aria-label="Net movement by account table" tabIndex={0}>
            <table className={s.table}>
              <caption>Net movement by account if every proposal were posted (debit positive)</caption>
              <thead><tr><th scope="col">Account</th><th scope="col" className={s.num}>Net</th></tr></thead>
              <tbody>{Object.entries(v.balances).map(([k, x]) => <tr key={k}><td>{MERCHANT_ACCOUNTS[k as keyof typeof MERCHANT_ACCOUNTS] ?? k}</td><td className={s.num}>{fiat(x, cur)}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p>No journal proposals for this month.</p>}
      </section>
    </>
  );
}
