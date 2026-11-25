/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { dailyReports } from "@/server/merchant";
import { DEMO_LAST_DAY, DEMO_TODAY } from "@/lib/clearline/demo/clock";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { RunReconciliation } from "@/components/merchant/forms";
import { Empty, one, q } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Daily report" };

type Report = NonNullable<ReturnType<Awaited<ReturnType<typeof dailyReports>>["get"]>>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const offset = (min: number) => `UTC${min >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;

function total(rs: Report[]) {
  const sum = (k: "payments" | "settlementsTied" | "settlements" | "exceptions" | "writeoffsAwaitingApproval") => rs.reduce((a, r) => a + r[k], 0);
  const t = { payments: sum("payments"), tied: sum("settlementsTied"), settlements: sum("settlements"), exceptions: sum("exceptions"), writeoffs: sum("writeoffsAwaitingApproval") };
  return { ...t, summary: `${plural(t.payments, "payment")} · ${plural(t.tied, "settlement")} tied · ${plural(t.exceptions, "exception")} · ${plural(t.writeoffs, "write-off")} awaiting approval` };
}

export default async function DailyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, shell } = await merchantMember();
  const sp = await searchParams;
  const ents = shell.entities;
  const sel = ents.find((e) => e.id === one(sp.entity)) ?? null;
  const scope = sel ? [sel] : ents;
  const days = [...new Set(scope.flatMap((e) => e.days))].sort();
  // a demo organisation opens on the last full demo day (the day before the demo's "today"); otherwise the latest day
  const fallback = shell.dataMode === "demo" && days.includes(DEMO_LAST_DAY) ? DEMO_LAST_DAY : days.at(-1) ?? null;
  const date = days.includes(one(sp.date) ?? "") ? one(sp.date)! : fallback;
  const mayReconcile = can(ctx.role, "merchant_reconcile");
  const reports = new Map(await Promise.all(scope.map(async (e) => [e.id, await dailyReports(ctx, e.id, e.days)] as const)));
  const perEntity = date ? scope.filter((e) => e.days.includes(date)).map((e) => ({ e, r: reports.get(e.id)!.get(date)! })) : [];
  const perDate = days.map((d) => ({ d, t: total(scope.filter((e) => e.days.includes(d)).map((e) => reports.get(e.id)!.get(d)!)) }));
  const t = total(perEntity.map((x) => x.r));
  // a demo organisation's data runs into the demo's "today" (transfers late on the last day, UTC, fall on the next
  // merchant day): that day is shown, and named for what it is, a partial day
  const partial = (d: string) => shell.dataMode === "demo" && d === DEMO_TODAY;
  const dayLabel = (d: string) => (partial(d) ? `${d} (today, partial)` : d);

  return (
    <>
      <h1 className={s.title}>Daily report</h1>
      <p className={s.lede}>What happened to {sel ? sel.name : "every entity"} on one day, and what still needs a person.</p>

      {ents.length === 0 ? <Empty>No entities are set up for {ctx.orgName} yet. Your provider&rsquo;s onboarding adds them; nothing to report.</Empty> : (
        <>
          <form className={`${m.filters}`} method="get" action="/control/merchant" aria-label="Choose entity and date">
            <div className={s.field}>
              <label className={s.label} htmlFor="entity">Entity</label>
              <select className={s.select} id="entity" name="entity" defaultValue={sel?.id ?? ""}>
                <option value="">All entities</option>
                {ents.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.id}, {e.currency})</option>)}
              </select>
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor="date">Date (merchant day)</label>
              <select className={s.select} id="date" name="date" defaultValue={date ?? ""}>
                {days.length === 0 ? <option value="">No data yet</option> : days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
              </select>
            </div>
            <div><button type="submit" className={s.button}>Show report</button></div>
          </form>

          {!date ? (
            <Empty>Nothing has been reconciled yet. {mayReconcile ? "Run reconciliation below to match the ingested provider, chain and bank records." : "Ask Payment Operations or Finance to run reconciliation."}</Empty>
          ) : (
            <section className={s.section} aria-labelledby="summary-h">
              <h2 className={s.h2} id="summary-h">Summary for {dayLabel(date)}{sel ? ` · ${sel.id}` : ""}</h2>
              <div className={s.panel}>
                {partial(date) ? <p className={s.small} data-testid="partial-day">This is the demo&rsquo;s today, and only part of it is in: the payments here were made late on {DEMO_LAST_DAY} (UTC), which is already {DEMO_TODAY} on the merchant&rsquo;s clock. The day&rsquo;s files are on the Uploads page.</p> : null}
                <p className={m.summary} data-testid="daily-summary">{t.summary}</p>
                <p className={m.cutoff} data-testid="cutoff-note">Cut-off: provider day = UTC. {scope.map((e) => `${e.id} merchant day = ${e.timezone} (${offset(e.utcOffsetMinutes)})`).join("; ")}.</p>
                <ul className={m.kpis}>
                  <li className={m.kpi}><a href={`/control/merchant/payments${q({ entity: sel?.id })}`} className={m.kpiValue}>{t.payments}</a><span className={m.kpiLabel}>Payments on this day</span></li>
                  <li className={m.kpi}><span className={m.kpiValue}>{t.tied} of {t.settlements}</span><span className={m.kpiLabel}>Settlements tied to the cent</span></li>
                  <li className={m.kpi}><a href="/control/merchant/exceptions" className={m.kpiValue}>{t.exceptions}</a><span className={m.kpiLabel}>Open exceptions</span></li>
                  <li className={m.kpi}><a href="/control/merchant/approvals" className={m.kpiValue}>{t.writeoffs}</a><span className={m.kpiLabel}>Write-offs awaiting approval</span></li>
                </ul>
              </div>
            </section>
          )}

          {perEntity.length > 0 ? (
            <section className={s.section} aria-labelledby="per-entity">
              <h2 className={s.h2} id="per-entity">Per entity, {dayLabel(date!)}</h2>
              <div className={s.tableWrap} role="region" aria-label="Per entity table" tabIndex={0}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Entity</th><th scope="col" className={s.num}>Payments</th><th scope="col" className={s.num}>Settlements tied</th><th scope="col" className={s.num}>Exceptions</th><th scope="col" className={s.num}>Write-offs awaiting approval</th><th scope="col">Merchant day</th></tr></thead>
                  <tbody>
                    {perEntity.map(({ e, r }) => (
                      <tr key={e.id}>
                        <td><a href={`/control/merchant${q({ entity: e.id, date })}`}>{e.name}</a> <span className={s.mono}>{e.id}</span></td>
                        <td className={s.num}>{r.payments}</td><td className={s.num}>{r.settlementsTied} of {r.settlements}<br /><span className={s.small}>{r.settlementsSettled} settled</span></td><td className={s.num}>{r.exceptions}</td><td className={s.num}>{r.writeoffsAwaitingApproval}</td>
                        <td>{e.timezone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {perDate.length > 0 ? (
            <section className={s.section} aria-labelledby="per-date">
              <h2 className={s.h2} id="per-date">Per date{sel ? `, ${sel.id}` : ""}</h2>
              <div className={s.tableWrap} role="region" aria-label="Per date table" tabIndex={0}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Date</th><th scope="col">Summary</th></tr></thead>
                  <tbody>{perDate.map(({ d, t: x }) => <tr key={d}><td><a href={`/control/merchant${q({ entity: sel?.id, date: d })}`} aria-current={d === date ? "true" : undefined}>{dayLabel(d)}</a></td><td>{x.summary}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className={s.section} aria-labelledby="recon">
            <h2 className={s.h2} id="recon">Reconciliation runs</h2>
            {mayReconcile ? (
              <>
                <p className={s.small}>Reconciliation reads the ingested provider export, settlement reports, recorded chain transfers and bank lines, and stores the result. An identical rerun changes nothing.</p>
                <div className={m.inline}>{ents.map((e) => <div key={e.id}><RunReconciliation entityId={e.id} entityName={e.name} /></div>)}</div>
              </>
            ) : <p className={s.small}>Payment Operations or Finance run reconciliation. Your role ({ctx.role}) reads the stored result.</p>}
          </section>
        </>
      )}
    </>
  );
}
