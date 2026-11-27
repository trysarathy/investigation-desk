import type { Metadata } from "next";
import { exceptionsView } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import { can } from "@/server/authz";
import { pageNow } from "@/server/demo-build";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { Empty, age } from "@/components/merchant/ui";
import { ExceptionsQueue, ReviewQueue } from "@/components/merchant/exceptions-queue";
import { LiveRefresh } from "@/components/ui";

export const metadata: Metadata = { title: "Exceptions" };

export default async function ExceptionsPage() {
  const { ctx, shell } = await merchantMember();
  const v = await exceptionsView(ctx);
  const now = pageNow(shell.dataMode); // demo build: the demo clock for a demo organisation, so ages never drift
  return (
    <>
      <div className={m.titleRow}><h1 className={s.title}>Exceptions</h1><LiveRefresh /></div>
      <p className={s.lede}>Every open exception has an owner, a plain-English reason and a next step. Open one to assign it, add a note, attach evidence or propose a resolution for a second person to approve.</p>
      {can(ctx.role, "merchant_export") ? <p className={s.small}>Download: <a href="/api/control/merchant/exports/results?kind=exceptions" data-testid="export-exceptions-csv">open exceptions (CSV)</a> · <a href="/api/control/merchant/exports/results?kind=matched" data-testid="export-matched-csv">matched payments (CSV)</a></p> : null}
      <section className={s.section} aria-labelledby="open">
        <h2 className={s.h2} id="open">Open exceptions ({v.exceptions.length})</h2>
        {v.exceptions.length === 0 ? <Empty>No open exceptions{shell.entities.length ? "" : " (no entities yet)"}.</Empty> : (
          <ExceptionsQueue rows={v.exceptions.map((e) => ({
            id: e.id, orderId: e.orderId, ownerRole: e.ownerRole, ownerName: e.ownerName, age: age(e.openedAt, now), openedAt: e.openedAt, reason: e.reason, nextStep: e.nextStep,
            evidenceCount: e.evidenceCount, noteCount: e.noteCount, status: e.status, pendingResolutionVersion: e.pendingResolutionVersion,
          }))} />
        )}
      </section>
      <section className={s.section} aria-labelledby="review">
        <h2 className={s.h2} id="review">Suggested for review ({v.needsReview.length})</h2>
        {v.needsReview.length === 0 ? <p>No payment is waiting for a review.</p> : (
          <ReviewQueue rows={v.needsReview.map((r) => ({ orderId: r.orderId, owner: r.attention?.owner ?? "—", reason: r.attention?.reason ?? r.ruleId, nextStep: r.attention?.nextStep ?? "—" }))} />
        )}
      </section>
    </>
  );
}
