import type { Metadata } from "next";
import { exceptionsView } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import { can } from "@/server/authz";
import { pageNow } from "@/server/demo-build";
import s from "@/components/control/control.module.css";
import { Chip, Empty, age } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Exceptions" };

export default async function ExceptionsPage() {
  const { ctx, shell } = await merchantMember();
  const v = await exceptionsView(ctx);
  const now = pageNow(shell.dataMode); // demo build: the demo clock for a demo organisation, so ages never drift
  return (
    <>
      <h1 className={s.title}>Exceptions</h1>
      <p className={s.lede}>Every open exception has an owner, a plain-English reason and a next step. Open one to assign it, add a note, attach evidence or propose a resolution for a second person to approve.</p>
      {can(ctx.role, "merchant_export") ? <p className={s.small}>Download: <a href="/api/control/merchant/exports/results?kind=exceptions" data-testid="export-exceptions-csv">open exceptions (CSV)</a> · <a href="/api/control/merchant/exports/results?kind=matched" data-testid="export-matched-csv">matched payments (CSV)</a></p> : null}
      <section className={s.section} aria-labelledby="open">
        <h2 className={s.h2} id="open">Open exceptions ({v.exceptions.length})</h2>
        {v.exceptions.length === 0 ? <Empty>No open exceptions{shell.entities.length ? "" : " (no entities yet)"}.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Open exceptions table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Exception</th><th scope="col">Owner</th><th scope="col">Age</th><th scope="col">Reason</th><th scope="col">Next step</th><th scope="col">Evidence</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {v.exceptions.map((e) => (
                  <tr key={e.id}>
                    <td><a href={`/control/merchant/exceptions/${encodeURIComponent(e.id)}`}>{e.id}</a>{e.orderId ? <><br /><span className={s.small}>Payment <a href={`/control/merchant/payments/${encodeURIComponent(e.orderId)}`}>{e.orderId}</a></span></> : null}</td>
                    <td>{e.ownerRole}<br /><span className={s.small}>{e.ownerName ?? "Unassigned"}</span></td>
                    <td title={e.openedAt}>{age(e.openedAt, now)}</td>
                    <td>{e.reason}</td>
                    <td>{e.nextStep}</td>
                    <td>{e.evidenceCount ? `${e.evidenceCount} attached` : <span className={s.muted}>None</span>}{e.noteCount ? <><br /><span className={s.small}>{e.noteCount} note{e.noteCount === 1 ? "" : "s"}</span></> : null}</td>
                    <td>{e.pendingResolutionVersion ? <Chip tone="amber">Resolution v{e.pendingResolutionVersion} awaiting approval</Chip> : <Chip tone="warn">{e.status === "in_review" ? "In review" : "Open"}</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className={s.section} aria-labelledby="review">
        <h2 className={s.h2} id="review">Suggested for review ({v.needsReview.length})</h2>
        {v.needsReview.length === 0 ? <p>No payment is waiting for a review.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Suggested for review table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Payment</th><th scope="col">Owner</th><th scope="col">Reason</th><th scope="col">Next step</th></tr></thead>
              <tbody>{v.needsReview.map((r) => (
                <tr key={r.orderId}><td><a href={`/control/merchant/payments/${encodeURIComponent(r.orderId)}`}>{r.orderId}</a></td><td>{r.attention?.owner ?? "—"}</td><td>{r.attention?.reason ?? r.ruleId}</td><td>{r.attention?.nextStep ?? "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
