"use client";
import Link from "../Link";
import { fundingProjection, formatMinor, listExceptions, type CurrencyCode } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ExcChip, SevChip, exceptionTitle } from "../labels";
import { Code, Empty, LinkBtn, Metric, Notice, PageHead, Panel, fmtTime, ui } from "../ui";

export default function Overview() {
  const { ws, actorName } = useWorkspace();
  const open = listExceptions(ws).filter((e) => e.status !== "resolved");
  const providerOnly = ws.intents.filter((i) => i.status.execution === "provider_reported_completed" && i.status.settlement !== "verified");
  const reconExc = ws.intents.filter((i) => i.status.reconciliation === "exception");
  const holds = ws.holds.filter((h) => h.status !== "released" && h.status !== "rejected");
  const cases = ws.cases.filter((c) => c.status !== "resolved");
  // m8: every line the engine has not fully allocated (unallocated, partially allocated or in exception).
  const lines = ws.statementLines.filter((l) => l.status !== "allocated");
  const funding = fundingProjection(ws);
  const outstanding = (Object.entries(funding.outstandingByCurrency) as [CurrencyCode, number][])
    .filter(([, v]) => v > 0).map(([c, v]) => formatMinor(v, c));

  return (
    <>
      <PageHead eyebrow="Operations" title="Overview"
        lede={<>Simulated clock: <span className="num">{fmtTime(ws.asOf)}</span>. Each figure links to the payments or cases behind it.</>}
        actions={<><LinkBtn href="/clearline/routes/new" kind="primary">New payment intent</LinkBtn><LinkBtn href="/clearline/trial">Guided trial</LinkBtn></>} />

      <Notice info>
        <strong>First time here?</strong> The <Link href="/clearline/trial">guided trial</Link> walks through five payments in about 15 minutes.
        {" "}<strong>{ws.organization.name}</strong> is fictional. A provider saying “completed” is a claim: every payment shows what the provider
        reported, what independent evidence establishes and whether the records match — three separate truths.
      </Notice>

      <div className={ui.metrics} aria-label="Workspace summary">
        <Metric href="/clearline/payments" label="Payments in workspace" value={ws.intents.length} note="View payments" />
        <Metric href="/clearline/payments?execution=provider_reported_completed" label="Provider-reported complete, settlement not verified" value={providerOnly.length} note="View these payments" />
        <Metric href="/clearline/payments?reconciliation=exception" label="Payments with a reconciliation exception" value={reconExc.length} note="View these payments" />
        <Metric href="/clearline/exceptions" label="Open exceptions" value={open.length} note="Open exceptions queue" />
        <Metric href="/clearline/investigations" label="Open investigations" value={cases.length} note="View cases" />
        <Metric href="/clearline/holds" label="Compliance holds awaiting a human" value={holds.length} note="View holds" />
        <Metric href="/clearline/reconciliation?status=open" label="Statement lines not fully allocated" value={lines.length} note="View statement lines" />
        <Metric href="/clearline/treasury/funding" label="Funding outstanding" value={outstanding.length ? outstanding.join(" · ") : "None"} note="View advances" />
      </div>

      <Panel title="Needs attention" id="attention" actions={<Link href="/clearline/exceptions">All exceptions</Link>}>
        {open.length === 0 ? <Empty>No open exceptions. New ones appear here when the engine raises them.</Empty> : (
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Needs attention (scrollable table)">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Exception</th><th>Severity</th><th>Status</th><th>Owner</th><th>Required action</th><th>Payment</th></tr></thead>
              <tbody>
                {open.slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td data-label="Exception"><Link href={`/clearline/exceptions#${e.id}`}>{exceptionTitle(e)}</Link><span className={ui.sub}><Code>{e.explanationCode}</Code></span></td>
                    <td data-label="Severity"><SevChip v={e.severity} /></td>
                    <td data-label="Status"><ExcChip v={e.status} /></td>
                    <td data-label="Owner">{actorName(e.ownerId)}</td>
                    <td data-label="Required action">{e.requiredAction}</td>
                    <td data-label="Payment">{e.intentId ? <Link href={`/clearline/payments/${e.intentId}`} className="mono">{e.intentId}</Link> : e.advanceId ? <Link href="/clearline/treasury/funding">{e.advanceId}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent activity" id="activity" actions={<Link href="/clearline/reports">Audit log</Link>}>
        {ws.audit.length === 0 ? <Empty>No activity yet.</Empty> : (
          <ol className={ui.timeline}>
            {[...ws.audit].slice(-6).reverse().map((a) => (
              <li key={a.id} className={ui.tlItem}>
                <span className={ui.tlTime}>{fmtTime(a.at)}</span>
                <div><p className={ui.tlTitle}>{a.summary}</p><p className={ui.tlMeta}>{actorName(a.actorId)} · <Code>{a.action}</Code> · {a.entityType} {a.entityId}</p></div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  );
}
