import type { Metadata } from "next";
import { can } from "@/server/authz";
import { merchantMember } from "@/server/merchant-page";
import { DEFAULT_LOCAL_TIME, listRuns } from "@/server/runs";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { RunReconciliation, ScheduleForm } from "@/components/merchant/forms";
import { Chip, Empty, whenIn } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Runs" };

const TRIGGER: Record<string, string> = { manual: "Manual", schedule: "Daily schedule", rule_change: "Rule change" };
const DECISION: Record<string, string> = { matched: "Matched", matched_with_difference: "Matched with difference", suggested_for_review: "Suggested for review", exception: "Exception" };
const offset = (min: number) => `UTC${min >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;

function Status({ status, code }: { status: string; code: string | null }) {
  if (status === "no_change") return <Chip testId="run-status">No change</Chip>;
  if (status === "failed") return <Chip tone="warn" testId="run-status">Failed · {code}</Chip>;
  return <Chip tone="ok" testId="run-status">Changed</Chip>;
}

/** Every reconciliation run of the organisation: when, why, under which rules, and what it decided. */
export default async function RunsPage() {
  const { ctx, shell } = await merchantMember();
  const v = await listRuns(ctx);
  const mayRun = can(ctx.role, "merchant_reconcile");
  const ents = shell.entities;
  return (
    <>
      <h1 className={s.title}>Runs</h1>
      <p className={s.lede}>Each reconciliation run: when it ran, why, under which rules, and what it decided. A run on the same data under the same rules writes nothing and says &ldquo;No change&rdquo;. Payments a person closed are never changed by a run.</p>

      <section className={s.section} aria-labelledby="schedule-h">
        <h2 className={s.h2} id="schedule-h">Daily schedule</h2>
        <p className={s.small}>Rules in force: <span className={s.mono} data-testid="rule-set-version">{v.ruleSetVersion}</span>. When the rules or an entity&rsquo;s matching policy change, its next pass re-runs the payments nobody has closed.</p>
        {ents.length === 0 ? <Empty>No entities yet.</Empty> : (
          <div className={m.cols2}>{ents.map((e) => {
            const sc = v.schedules.find((x) => x.entityId === e.id);
            return (
              <article className={s.panel} key={e.id} aria-labelledby={`sch-${e.id}`}>
                <h3 className={s.h3} id={`sch-${e.id}`}>{e.name} <span className={s.mono}>{e.id}</span></h3>
                <p className={s.small} data-testid={`schedule-${e.id}`}>{sc?.enabled ? `Every day at ${sc.localTime} merchant time (${offset(e.utcOffsetMinutes)}), run for ${sc.runAsName ?? "a member"}.` : "No daily run. Runs happen when someone reconciles."}</p>
                {mayRun ? (
                  <>
                    <ScheduleForm entityId={e.id} localTime={sc?.localTime ?? DEFAULT_LOCAL_TIME} enabled={sc?.enabled ?? false} />
                    <RunReconciliation entityId={e.id} entityName={e.name} />
                  </>
                ) : null}
              </article>
            );
          })}</div>
        )}
        {mayRun ? <p className={s.small}>A daily run acts for the person who set it and stops if their access is removed. It needs the job worker running (<span className={s.mono}>npm run jobs:worker</span>).</p> : <p className={s.small}>Payment Operations or Finance set the daily run.</p>}
      </section>

      <section className={s.section} aria-labelledby="runs-h">
        <h2 className={s.h2} id="runs-h">Recent runs</h2>
        {v.runs.length === 0 ? <Empty>No runs yet.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Runs table" tabIndex={0}>
            <table className={s.table} data-testid="runs-table">
              <thead><tr>
                <th scope="col">Started</th><th scope="col">Entity</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col">Rules and policy</th>
                <th scope="col" className={s.num}>Matched</th><th scope="col" className={s.num}>With difference</th><th scope="col" className={s.num}>Review</th>
                <th scope="col" className={s.num}>Exceptions</th><th scope="col" className={s.num}>Unpaid</th><th scope="col" className={s.num}>Closed, kept</th><th scope="col" className={s.num}>Rule-change notices</th>
              </tr></thead>
              <tbody>{v.runs.map((r) => (
                <tr key={r.id} data-testid="run-row">
                  <td>{whenIn(r.startedAt, shell.entities.find((e) => e.id === r.entityId))}</td><td className={s.mono}>{r.entityId}</td><td>{TRIGGER[r.trigger] ?? r.trigger}</td><td><Status status={r.status} code={r.errorCode} /></td>
                  <td><span className={s.mono}>{r.ruleSetVersion}</span> · policy r{r.policyRevision}</td>
                  <td className={s.num}>{r.counts.matched}</td><td className={s.num}>{r.counts.withDifference}</td><td className={s.num}>{r.counts.review}</td>
                  <td className={s.num}>{r.counts.exceptions}</td><td className={s.num}>{r.counts.unpaid}</td><td className={s.num}>{r.counts.kept}</td><td className={s.num}>{r.counts.notices}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section} aria-labelledby="notices-h">
        <h2 className={s.h2} id="notices-h">Rule change would differ</h2>
        <p className={s.small}>A payment a person closed keeps its decision. When newer rules or policy would decide it differently, it is listed here for a person to look at; nothing was changed.</p>
        {v.notices.length === 0 ? <Empty>No closed payment would be decided differently.</Empty> : (
          <div className={s.tableWrap} role="region" aria-label="Rule-change notices" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Payment</th><th scope="col">Decision kept</th><th scope="col">Would now be</th><th scope="col">Rules and policy</th><th scope="col">Noticed</th></tr></thead>
              <tbody>{v.notices.map((x) => (
                <tr key={x.id}>
                  <td><a href={`/control/merchant/payments/${encodeURIComponent(x.orderId)}`}>{x.orderId}</a></td>
                  <td>{DECISION[x.storedDecision] ?? x.storedDecision} <span className={s.mono}>{x.storedRuleId}</span></td>
                  <td>{DECISION[x.newDecision] ?? x.newDecision} <span className={s.mono}>{x.newRuleId}</span></td>
                  <td><span className={s.mono}>{x.ruleSetVersion}</span> · policy r{x.policyRevision}</td><td>{when(x.at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
