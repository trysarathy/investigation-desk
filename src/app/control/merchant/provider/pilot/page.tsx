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
  return (
    <>
      <h1 className={s.title}>Pilot metrics</h1>
      <p className={s.lede}>How the pilot is going across your merchants, as aggregates. Each merchant&rsquo;s team reviews a sample of automatic matches and may log the minutes they spend; you see the totals, never their records.</p>
      <ul className={m.kpis} aria-label="Totals">
        <li className={m.kpi}><span className={m.kpiValue} data-testid="total-auto">{t.autoMatchedPct === null ? "—" : `${t.autoMatchedPct}%`}</span><span className={m.kpiLabel}>Matched automatically</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{t.reviewedWrong} of {t.reviewed}</span><span className={m.kpiLabel}>Wrong matches in the reviewed sample</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{t.exceptionsPer100 ?? "—"}</span><span className={m.kpiLabel}>Exceptions per 100 payments</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{t.batchesTied} of {t.batches}</span><span className={m.kpiLabel}>Batches tied to the cent</span></li>
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
                  <td className={s.num}>{x.reviewedWrong} of {x.reviewed}</td><td className={s.num}>{x.exceptionsPer100 ?? "—"}</td>
                  <td className={s.num}>{x.medianMinutesToResolve === null ? "No exception resolved yet" : `${x.medianMinutesToResolve} min`}</td>
                  <td className={s.num}>{x.batchesTied} of {x.batches}</td><td className={s.num}>{x.minutesLogged}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <p className={s.small}>Batches tied: distinct settlement batches named on reconciled payments, and those tied to the cent. Median time to resolve: from an exception opening to its approved resolution or its closing by a later reconciliation.</p>
    </>
  );
}
