import type { Metadata } from "next";
import { providerPilotMetrics } from "@/server/provider";
import { providerMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { Empty } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Pilot metrics" };

export default async function ProviderPilotPage() {
  const { ctx } = await providerMember();
  const p = await providerPilotMetrics(ctx);
  const t = p.total;
  const exOpen = p.merchants.reduce((a, x) => a + x.exceptionsOpen, 0);
  const openPer100 = t.payments ? Math.round((exOpen * 1000) / t.payments) / 10 : null;
  const one = p.merchants.length === 1 ? p.merchants[0] : null;
  const median = one ? one.medianMinutesToResolve : null;
  const fmtMin = (v: number) => (v >= 120 ? `${Math.round((v / 60) * 10) / 10} h` : `${v} min`);
  return (
    <>
      <h1 className={s.title}>Pilot metrics</h1>
      <p className={s.lede}>How the pilot is going across your merchants, as aggregates computed from their reconciled data. Each merchant&rsquo;s team reviews a sample of automatic matches and may log the minutes they spend; you see the totals, never their records.</p>
      <ul className={m.kpis} aria-label="Totals">
        <li className={m.kpi}><span className={m.kpiValue} data-testid="total-auto">{t.autoMatchedPct === null ? "—" : `${t.autoMatchedPct}%`}</span><span className={m.kpiLabel}>Matched automatically ({t.payments} payments)</span></li>
        <li className={m.kpi}><span className={m.kpiValue} data-testid="total-wrong">{t.reviewed === 0 ? "Not measured yet" : `${t.reviewedWrong} of ${t.reviewed}`}</span><span className={m.kpiLabel}>Wrong matches in the reviewed sample{t.reviewed === 0 ? ": no merchant has reviewed a sampled match yet (0 reviewed), so there is no rate to show" : ` (${t.reviewed} reviewed)`}</span></li>
        <li className={m.kpi}><span className={m.kpiValue} data-testid="total-per100">{t.exceptionsPer100 ?? "—"}</span><span className={m.kpiLabel}>Exceptions opened per 100 payments, including those a later run closed{openPer100 === null ? "" : ` (${openPer100} still open per 100)`}</span></li>
        <li className={m.kpi}><span className={m.kpiValue} data-testid="total-median">{median === null ? (one ? "None resolved yet" : "Per merchant") : fmtMin(median)}</span><span className={m.kpiLabel}>Median time to resolve an exception{one ? "" : " (a median is not added across merchants; see the table)"}</span></li>
        <li className={m.kpi}><span className={m.kpiValue} data-testid="total-tied">{t.batchesTied} of {t.batches}</span><span className={m.kpiLabel}>Batches tied to the cent</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{t.minutesLogged}</span><span className={m.kpiLabel}>Minutes logged by merchant teams</span></li>
      </ul>
      <section className={s.section} aria-labelledby="per-merchant">
        <h2 className={s.h2} id="per-merchant">Per merchant</h2>
        {p.merchants.length === 0 ? <Empty>No merchants yet.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Pilot metrics per merchant table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Merchant</th><th scope="col" className={s.num}>Payments</th><th scope="col" className={s.num}>Matched automatically</th><th scope="col" className={s.num}>Wrong in reviewed sample</th><th scope="col" className={s.num}>Exceptions per 100</th><th scope="col" className={s.num}>Median time to resolve</th><th scope="col" className={s.num}>Batches tied</th><th scope="col" className={s.num}>Minutes logged</th></tr></thead>
              <tbody>{p.merchants.map((x) => (
                <tr key={x.merchantOrgId}>
                  <td>{x.name}</td><td className={s.num}>{x.payments}</td><td className={s.num}>{x.autoMatchedPct === null ? "—" : `${x.autoMatchedPct}%`}</td>
                  <td className={s.num}>{x.reviewed === 0 ? "None reviewed yet" : `${x.reviewedWrong} of ${x.reviewed}`}</td><td className={s.num}>{x.exceptionsPer100 ?? "—"}</td>
                  <td className={s.num}>{x.medianMinutesToResolve === null ? "No exception resolved yet" : fmtMin(x.medianMinutesToResolve)}</td>
                  <td className={s.num}>{x.batchesTied} of {x.batches}</td><td className={s.num}>{x.minutesLogged}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <p className={s.small}>How each number is computed: matched automatically = matched, or matched with an explained difference, without a person. Wrong matches = the sampled automatic matches a merchant reviewer marked wrong, out of those reviewed. Exceptions per 100 = every exception opened, divided by the reconciled payments (an exception a later run closes, for example when the bank credit arrives the next day, still counts). Batches tied: distinct settlement batches named on reconciled payments, and those tied to the cent. Median time to resolve: from an exception opening to its approved resolution or its closing by a later reconciliation.</p>
    </>
  );
}
