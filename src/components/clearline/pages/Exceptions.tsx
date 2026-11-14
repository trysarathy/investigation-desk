"use client";
import Link from "../Link";
import { formatMinor, formatMoney, listExceptions, type AmountDifference, type ExceptionCategory, type ReconciliationException, type Workspace } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ExcStatusChip, SEVERITY, SevChip, awaitingSecondApproval, exceptionTitle } from "../labels";
import { TargetActions } from "../TargetActions";
import { OwnerControl } from "../OwnerControl";
import { engineLabel, label } from "../human";
import { FilterBar, SearchFilter, SelectFilter, matchesText, useQuery, useSearchText } from "../filters";
import { Code, Empty, PageHead, Panel, fmtDate, fmtTime, ui } from "../ui";

/** The currency an exception is about: its financial impact, its amount difference, or its payment. */
export function exceptionCurrency(ws: Workspace, e: ReconciliationException): string | undefined {
  const d = (e as ReconciliationException & { amountDifference?: AmountDifference }).amountDifference;
  return e.impact?.currency ?? d?.currency ?? ws.intents.find((i) => i.id === e.intentId)?.sourceCurrency;
}

export default function Exceptions() {
  const { ws, actorName, actors } = useWorkspace();
  const { get, hrefWith } = useQuery();
  const view = get("view") || "open";
  const intent = get("intent");
  const category = get("category") as ExceptionCategory | "";
  const severity = get("severity");
  const currency = get("currency");
  const owner = get("owner");
  const [text, setText, commitText, clearText] = useSearchText();
  const scoped = listExceptions(ws, { ...(intent ? { intentId: intent } : {}), ...(category ? { category } : {}) });
  const all = scoped.filter((e) =>
    (!severity || e.severity === severity) &&
    (!currency || exceptionCurrency(ws, e) === currency) &&
    (!owner || (owner === "unassigned" ? !e.ownerId : e.ownerId === owner)) &&
    matchesText(text, e.id, exceptionTitle(e), e.explanationCode, e.explanation, e.requiredAction, e.intentId, e.advanceId, e.statementLineId, actorName(e.ownerId)));
  const rows = view === "all" ? all
    : view === "resolved" ? all.filter((e) => e.status === "resolved" && !awaitingSecondApproval(e))
    : view === "awaiting" ? all.filter((e) => awaitingSecondApproval(e))
    : all.filter((e) => e.status !== "resolved"); // pending second approvals have their own view (count shown on its link)
  const qs = (v: string) => hrefWith({ view: v });
  const currencies = [...new Set(listExceptions(ws).map((e) => exceptionCurrency(ws, e)).filter(Boolean) as string[])].sort();
  const active = [
    severity && `severity “${engineLabel("severity", severity) ?? severity}”`,
    currency && `currency ${currency}`,
    owner && `owner ${owner === "unassigned" ? "Unassigned" : actorName(owner)}`,
    text.trim() && `text “${text.trim()}”`,
  ].filter(Boolean);

  return (
    <>
      <PageHead eyebrow="Investigations" title="Exceptions queue"
        lede="Raised by the engine's rules. Each shows its category, severity, owner, due date, financial impact, the action required and its full history." />
      <nav aria-label="Exception filters" className={ui.actions} style={{ marginBottom: 12 }}>
        {["open", "awaiting", "resolved", "all"].map((v) => (
          <Link key={v} href={qs(v)} aria-current={view === v ? "true" : undefined} className={`${ui.btn} ${ui.small} ${view === v ? ui.toggleOn : ""}`}>
            {v === "open" ? "Open and reopened" : v === "awaiting" ? `Awaiting approval (${listExceptions(ws).filter((e) => awaitingSecondApproval(e)).length})` : v === "resolved" ? "Resolved" : "All"}
          </Link>
        ))}
        {(intent || category) && <span>Filtered by {intent && <>payment <Code>{intent}</Code></>} {category && <>category <Code>{category}</Code></>} — <Link href={hrefWith({ intent: null, category: null })}>clear</Link></span>}
      </nav>
      <FilterBar label="Filter exceptions" onClear={clearText} clear={active.length ? ["severity", "currency", "owner", "q"] : undefined}
        summary={<>Showing {rows.length} exception{rows.length === 1 ? "" : "s"} in “{view === "open" ? "Open and reopened" : view === "awaiting" ? "Awaiting approval" : view === "resolved" ? "Resolved" : "All"}”{active.length ? <> · filtered by {active.join(", ")}</> : null}.</>}>
        <SearchFilter label="Search" placeholder="ID, code, payment, owner…" value={text} onChange={setText} onCommit={commitText} />
        <SelectFilter param="severity" label="Severity" options={(Object.keys(SEVERITY) as (keyof typeof SEVERITY)[]).map((v) => ({ value: v, label: engineLabel("severity", v) ?? SEVERITY[v][0] }))} />
        <SelectFilter param="currency" label="Currency" options={currencies.map((c) => ({ value: c, label: c }))} />
        <SelectFilter param="owner" label="Owner" options={[{ value: "unassigned", label: "Unassigned" }, ...actors.map((a) => ({ value: a.id, label: a.name }))]} />
      </FilterBar>
      {rows.length > 0 && (
        <Panel title={`Queue — ${rows.length} exception${rows.length === 1 ? "" : "s"}`} id="queue">
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Exceptions queue table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Category</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th><th className={ui.r}>Impact</th><th>Required action</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Category"><a href={`#${e.id}`}>{exceptionTitle(e)}</a><span className={ui.sub}><Code>{e.explanationCode}</Code></span></td>
                    <td data-label="Severity"><SevChip v={e.severity} /></td>
                    <td data-label="Status"><ExcStatusChip e={e} /></td>
                    <td data-label="Owner"><OwnerControl target={{ kind: "exception", id: e.id }} ownerId={e.ownerId} /></td>
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
      {rows.length === 0 ? <Panel><Empty>{active.length === 0 ? "No exceptions in this view." : "No exceptions match these filters. Clear the filters to see the others."}</Empty></Panel> : rows.map((e) => (
        <Panel key={e.id} id={e.id} headingLevel={2}
          title={<>{exceptionTitle(e)} <span className={ui.sub} style={{ display: "inline" }}>· <span className="mono">{e.id}</span></span></>}
          actions={<><SevChip v={e.severity} /><ExcStatusChip e={e} /></>}>
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
                  <li key={i} className={ui.tlItem}><span className={ui.tlTime}>{fmtTime(h.at)}</span><div><p className={ui.tlTitle}>{label("auditAction", h.action)}</p><p className={ui.tlMeta}>{h.detail} · {actorName(h.actorId)}</p></div></li>
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
