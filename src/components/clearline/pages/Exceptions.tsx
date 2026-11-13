"use client";
import Link from "../Link";
import { useSearchParams } from "next/navigation";
import { formatMinor, formatMoney, listExceptions, type AmountDifference, type ExceptionCategory } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ExcChip, SevChip, human, exceptionTitle } from "../labels";
import { TargetActions } from "../TargetActions";
import { Code, Empty, PageHead, Panel, fmtDate, fmtTime, ui } from "../ui";

export default function Exceptions() {
  const { ws, actorName } = useWorkspace();
  const q = useSearchParams();
  const view = q?.get("view") ?? "open";
  const intent = q?.get("intent") ?? "";
  const category = (q?.get("category") ?? "") as ExceptionCategory | "";
  const all = listExceptions(ws, { ...(intent ? { intentId: intent } : {}), ...(category ? { category } : {}) });
  const rows = view === "all" ? all : view === "resolved" ? all.filter((e) => e.status === "resolved") : all.filter((e) => e.status !== "resolved");
  const qs = (v: string) => `/clearline/exceptions?view=${v}${intent ? `&intent=${intent}` : ""}${category ? `&category=${category}` : ""}`;

  return (
    <>
      <PageHead eyebrow="Investigations" title="Exceptions queue"
        lede="Raised by the engine's rules. Each shows its category, severity, owner, due date, financial impact, the action required and its full history." />
      <nav aria-label="Exception filters" className={ui.actions} style={{ marginBottom: 12 }}>
        {["open", "resolved", "all"].map((v) => (
          <Link key={v} href={qs(v)} aria-current={view === v ? "true" : undefined} className={`${ui.btn} ${ui.small} ${view === v ? ui.primary : ""}`}>
            {v === "open" ? "Open and reopened" : v === "resolved" ? "Resolved" : "All"}
          </Link>
        ))}
        {(intent || category) && <span>Filtered by {intent && <>payment <Code>{intent}</Code></>} {category && <>category <Code>{category}</Code></>} — <Link href="/clearline/exceptions">clear</Link></span>}
      </nav>
      {rows.length > 0 && (
        <Panel title={`Queue — ${rows.length} exception${rows.length === 1 ? "" : "s"}`} id="queue">
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Exceptions queue (scrollable table)">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Category</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th><th className={ui.r}>Impact</th><th>Required action</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Category"><a href={`#${e.id}`}>{exceptionTitle(e)}</a><span className={ui.sub}><Code>{e.explanationCode}</Code></span></td>
                    <td data-label="Severity"><SevChip v={e.severity} /></td>
                    <td data-label="Status"><ExcChip v={e.status} /></td>
                    <td data-label="Owner">{actorName(e.ownerId)}</td>
                    <td data-label="Due" className={ui.num}>{fmtDate(e.dueDate)}</td>
                    <td data-label="Impact" className={`${ui.r} ${ui.num}`}>{e.impact ? formatMoney(e.impact) : "—"}</td>
                    <td data-label="Required action">{e.requiredAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {rows.length === 0 ? <Panel><Empty>No exceptions in this view.</Empty></Panel> : rows.map((e) => (
        <Panel key={e.id} id={e.id} headingLevel={2}
          title={<>{exceptionTitle(e)} <span className={ui.sub} style={{ display: "inline" }}>· <span className="mono">{e.id}</span></span></>}
          actions={<><SevChip v={e.severity} /><ExcChip v={e.status} /></>}>
          <div className={ui.panelBody}>
            <dl className={ui.dl}>
              <div><dt>Explanation</dt><dd>{e.explanation} <Code>{e.explanationCode}</Code></dd></div>
              <div><dt>Required action</dt><dd>{e.requiredAction}</dd></div>
              <div><dt>Owner</dt><dd>{actorName(e.ownerId)}</dd></div>
              <div><dt>Due</dt><dd className="num">{fmtDate(e.dueDate)}</dd></div>
              <div><dt>Financial impact</dt><dd className="num">{e.impact ? formatMoney(e.impact) : "None recorded"}</dd></div>
              {(() => { const d = (e as typeof e & { amountDifference?: AmountDifference }).amountDifference; return d ? (
                <div data-testid="exception-amount-difference"><dt>Amount difference</dt><dd className="num">Expected {formatMinor(d.expectedMinor, d.currency)} · reported {formatMinor(d.reportedMinor, d.currency)} · difference <strong>{formatMinor(d.differenceMinor, d.currency)}</strong> ({d.source}) — {d.requiredNextAction}</dd></div>
              ) : null; })()}
              <div><dt>Linked to</dt><dd>
                {e.intentId && <Link href={`/clearline/payments/${e.intentId}`} className="mono">{e.intentId}</Link>}
                {e.advanceId && <> <Link href="/clearline/treasury/funding">{e.advanceId}</Link></>}
                {e.statementLineId && <> <Link href={`/clearline/reconciliation#${e.statementLineId}`}>{e.statementLineId}</Link></>}
                {!e.intentId && !e.advanceId && !e.statementLineId && "—"}
              </dd></div>
              {e.candidates.length > 0 && <div><dt>Candidates (not auto-picked)</dt><dd>{e.candidates.join(", ")}</dd></div>}
              {e.resolution && <div><dt>Resolution</dt><dd>{e.resolution.note} — {actorName(e.resolution.actorId)}, {fmtTime(e.resolution.at)}</dd></div>}
            </dl>
            <details style={{ marginTop: 10 }}>
              <summary>History ({e.history.length})</summary>
              <ol className={ui.timeline}>
                {e.history.map((h, i) => (
                  <li key={i} className={ui.tlItem}><span className={ui.tlTime}>{fmtTime(h.at)}</span><div><p className={ui.tlTitle}>{human(h.action)}</p><p className={ui.tlMeta}>{h.detail} · {actorName(h.actorId)}</p></div></li>
                ))}
              </ol>
            </details>
            <details style={{ marginTop: 6 }}>
              <summary>Work this exception</summary>
              <TargetActions target={{ kind: "exception", id: e.id }} status={e.status} idPrefix={e.id} />
            </details>
          </div>
        </Panel>
      ))}
    </>
  );
}
