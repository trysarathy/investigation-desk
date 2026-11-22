import type { Metadata } from "next";
import { can } from "@/server/authz";
import { pilotMetrics } from "@/server/merchant";
import { pilotSample } from "@/server/provider";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { MinutesForm, ReviewButtons } from "@/components/merchant/forms";
import { Chip, DecisionChip, Empty } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Pilot metrics" };

export default async function MerchantPilotPage() {
  const { ctx, shell } = await merchantMember();
  const [p, sample] = await Promise.all([pilotMetrics(ctx), pilotSample(ctx)]);
  const mayReview = can(ctx.role, "review_match");
  const latest = shell.entities.flatMap((e) => e.days).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1 className={s.title}>Pilot metrics</h1>
      <p className={s.lede}>How well reconciliation is working for {ctx.orgName}. Your provider sees these numbers as totals only, never your records.</p>
      <ul className={m.kpis} aria-label="Pilot metrics">
        <li className={m.kpi}><span className={m.kpiValue} data-testid="metric-auto">{p.autoMatchedPct === null ? "—" : `${p.autoMatchedPct}%`}</span><span className={m.kpiLabel}>Matched automatically ({p.payments} payments)</span></li>
        <li className={m.kpi}><span className={m.kpiValue} data-testid="metric-wrong">{p.wrongInSample} of {p.reviewedSample}</span><span className={m.kpiLabel}>Wrong matches in the reviewed sample</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{p.exceptionsPer100 ?? "—"}</span><span className={m.kpiLabel}>Exceptions per 100 payments</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{p.medianMinutesToResolve === null ? "—" : `${Math.round(p.medianMinutesToResolve)} min`}</span><span className={m.kpiLabel}>Median time to resolve an exception</span></li>
        <li className={m.kpi}><span className={m.kpiValue}>{p.batchesTiedToTheCent} of {p.batches}</span><span className={m.kpiLabel}>Batches tied to the cent</span></li>
        <li className={m.kpi}><span className={m.kpiValue} data-testid="metric-minutes">{p.minutesLogged}</span><span className={m.kpiLabel}>Minutes logged</span></li>
      </ul>

      <section className={s.section} aria-labelledby="sample">
        <h2 className={s.h2} id="sample">Reviewed sample</h2>
        <p className={s.small}>Up to 20 automatic matches, evenly spaced through the order numbers. Open each payment, check its five records, then mark the match correct or wrong. {mayReview ? "" : "Payment Operations, Finance and Approvers review; your role reads."}</p>
        {sample.sample.length === 0 ? <Empty>No automatic matches yet. Run reconciliation first.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Reviewed sample table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Payment</th><th scope="col">Explanation</th><th scope="col">Reviews</th>{mayReview ? <th scope="col">Your review</th> : null}</tr></thead>
              <tbody>{sample.sample.map((x) => {
                const mine = x.reviews.find((r) => r.mine);
                return (
                  <tr key={x.orderId}>
                    <td><a href={`/control/merchant/payments/${encodeURIComponent(x.orderId)}`}>{x.orderId}</a></td>
                    <td><DecisionChip decision={x.decision} /></td>
                    <td>{x.reviews.length ? x.reviews.map((r, i) => <span key={i}>{i ? " · " : ""}<Chip tone={r.verdict === "correct" ? "ok" : "warn"}>{r.verdict}</Chip> {r.name}</span>) : <span className={s.muted}>Not reviewed</span>}</td>
                    {mayReview ? <td><ReviewButtons orderId={x.orderId} current={(mine?.verdict as "correct" | "wrong" | undefined) ?? null} /></td> : null}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section} aria-labelledby="minutes">
        <h2 className={s.h2} id="minutes">Minutes spent today (optional)</h2>
        <p className={s.small}>Log how long reconciliation took you, so the pilot can measure the time saved. Optional; only totals are shown to anyone.</p>
        <div className={s.panel}><MinutesForm today={latest} /></div>
      </section>
    </>
  );
}
