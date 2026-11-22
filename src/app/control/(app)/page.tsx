import type { Metadata } from "next";
import { overview, workQueue } from "@/server/control";
import { pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { categoryLabel, exceptionStatusLabel, caseStatusLabel, PageTitle, priorityLabel, severityLabel, TableRegion, Tag } from "@/components/control/ui";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await pageContext();
  const [o, q] = await Promise.all([overview(ctx), workQueue(ctx)]);
  const openExceptions = q.exceptions.filter((e) => e.status !== "resolved");
  const openCases = q.cases.filter((c) => c.status !== "resolved");
  const stats = [
    { label: "Payments", value: o.payments },
    { label: "Open exceptions", value: o.openExceptions },
    { label: "Open investigations", value: o.openInvestigations },
    { label: "Waiting for approval", value: o.pendingApprovals },
    { label: "Settlement verified by independent evidence", value: o.settlementVerified },
    { label: "Returned payouts", value: o.returned },
  ];
  return (
    <>
      <PageTitle title="Overview" lede={`${o.org.name}: what needs a person today.`} />
      <section className={s.section} aria-labelledby="counts">
        <h2 className={s.h2} id="counts">Counts</h2>
        <ul className={`${s.grid4} ${s.plainList}`}>
          {stats.map((x) => (
            <li className={s.stat} key={x.label}><span className={s.statValue}>{x.value}</span><span className={s.statLabel}>{x.label}</span></li>
          ))}
        </ul>
      </section>
      <section className={s.section} aria-labelledby="queue-exceptions">
        <h2 className={s.h2} id="queue-exceptions">Work queue: open exceptions</h2>
        {openExceptions.length === 0 ? <p>No open exceptions.</p> : (
          <TableRegion label="Open exceptions">
            <table className={s.table}>
              <thead><tr><th scope="col">Payment</th><th scope="col">Exception</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Due</th></tr></thead>
              <tbody>
                {openExceptions.map((e) => (
                  <tr key={e.id}>
                    <td>{e.intentId ? <a href={`/control/payments/${encodeURIComponent(e.intentId)}`}>{e.reference ?? e.intentId}</a> : "—"}</td>
                    <td>{categoryLabel(e.category)}</td>
                    <td>{e.severity === "high" || e.severity === "critical" ? <Tag tone="warn">{severityLabel(e.severity)}</Tag> : severityLabel(e.severity)}</td>
                    <td>{exceptionStatusLabel(e.status)}</td>
                    <td>{e.ownerName ?? <span className={s.muted}>Unassigned</span>}</td>
                    <td>{e.dueDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </section>
      <section className={s.section} aria-labelledby="queue-cases">
        <h2 className={s.h2} id="queue-cases">Work queue: open investigations</h2>
        {openCases.length === 0 ? <p>No open investigations.</p> : (
          <TableRegion label="Open investigations">
            <table className={s.table}>
              <thead><tr><th scope="col">Investigation</th><th scope="col">Status</th><th scope="col">Owner</th><th scope="col">Priority</th><th scope="col">Next action</th><th scope="col">Due</th></tr></thead>
              <tbody>
                {openCases.map((c) => (
                  <tr key={c.id}>
                    <td>{c.intentId ? <a href={`/control/payments/${encodeURIComponent(c.intentId)}`}>{c.title}</a> : c.title}</td>
                    <td>{caseStatusLabel(c.status)}</td>
                    <td>{c.ownerName ?? <span className={s.muted}>Unassigned</span>}</td>
                    <td>{c.priority === "high" || c.priority === "urgent" ? <Tag tone="warn">{priorityLabel(c.priority)}</Tag> : priorityLabel(c.priority)}</td>
                    <td>{c.nextAction ?? <span className={s.muted}>None set</span>}</td>
                    <td>{c.dueDate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </section>
    </>
  );
}
