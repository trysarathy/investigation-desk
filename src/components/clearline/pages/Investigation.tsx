"use client";
import Link from "../Link";
import { useMemo, useState, type ReactNode } from "react";
import {
  evidenceTimelineFor, exportCaseReport, formatMinor, formatMoney, getIntent, investigate,
  type AmountDifference, type EvidenceTimelineEntry, type Finding, type InvestigationView, type ProcessingOutcome, type Workspace,
} from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { EXECUTION, RECON, SETTLEMENT, ExecChip, ReconChip, SCOPE, SettleChip, RAIL, HoldChip, AdvChip, OutcomeChip, exceptionTitle } from "../labels";
import { SimulateEvent } from "../SimulateEvent";
import { TargetActions } from "../TargetActions";
import { ActionButton, gateOf, useRun, type Gate } from "../Action";
import { describeCode, label, statusSummary } from "../human";
import { Chip, Code, Empty, Field, Notice, PageHead, Panel, Status, fmtTime, ui, type Tone } from "../ui";
import { download } from "../download";

const PROBLEM_OUTCOMES: ProcessingOutcome[] = ["duplicate_ignored", "stored_late_no_regression", "contradictory_exception_raised", "rejected_signature", "rejected_unknown_payment"];
const RETURN_STATUS = { provider_reported: "Return reported by provider", confirmed_by_statement: "Return confirmed by statement" } as const;
const TRUTH_CLASS: Record<Tone, string> = { ok: ui.truthOk, warn: ui.truthWarn, bad: ui.truthBad, info: ui.truthInfo, neutral: ui.truthNeutral };

/** Engine CHANGE 5 (F2): structured under-amount detail; read optionally so older workspaces still render. */
type WithDiff = { amountDifference?: AmountDifference };
type Diff = AmountDifference & { outstanding?: boolean };
type DiffView = { amountDifferences?: Diff[]; resolvedAmountDifferences?: Diff[] };
/** Review v2 M3: only differences the engine marks outstanding count as financially outstanding; the rest are history. */
const diffsOf = (v: InvestigationView): Diff[] => ((v as InvestigationView & DiffView).amountDifferences ?? []).filter((d) => d.outstanding !== false);
const resolvedDiffsOf = (v: InvestigationView): Diff[] => [
  ...((v as InvestigationView & DiffView).amountDifferences ?? []).filter((d) => d.outstanding === false),
  ...((v as InvestigationView & DiffView).resolvedAmountDifferences ?? []),
];

function FindingList({ items, empty }: { items: Finding[]; empty: string }) {
  if (!items.length) return <p className={ui.hint} style={{ margin: 0 }}>{empty}</p>;
  return <ul>{items.map((f, i) => <li key={i}>{f.text} <Code>{f.code}</Code></li>)}</ul>;
}

function AmountDiff({ d }: { d: AmountDifference }) {
  return (
    <table className={ui.money} data-testid="amount-difference">
      <caption className={ui.srOnly}>Amount difference ({d.code})</caption>
      <tbody>
        <tr><th scope="row">Expected</th><td className="mono" data-testid="diff-expected">{formatMinor(d.expectedMinor, d.currency)}</td></tr>
        <tr><th scope="row">Reported</th><td className="mono" data-testid="diff-reported">{formatMinor(d.reportedMinor, d.currency)}</td></tr>
        <tr><th scope="row">Difference</th><td className="mono" data-testid="diff-difference"><strong>{formatMinor(d.differenceMinor, d.currency)}</strong></td></tr>
        <tr><th scope="row">Currency</th><td className="mono">{d.currency}</td></tr>
        <tr><th scope="row">Source</th><td>{label("statementSource", d.source)} <span className={ui.apiValue}>{d.source} · {d.statementLineId}</span></td></tr>
        <tr><th scope="row">Next action</th><td>{d.requiredNextAction}</td></tr>
        <tr><th scope="row">Rule</th><td>{describeCode(d.code)} <Code>{d.code}</Code></td></tr>
      </tbody>
    </table>
  );
}

/** Processing outcome of one timeline entry, read from the engine record it refers to. */
function outcomeOf(e: EvidenceTimelineEntry, ws: Workspace): ReactNode {
  if (e.kind === "provider_event") {
    const p = ws.providerEvents.find((x) => x.id === e.refs[0]);
    return p ? <OutcomeChip v={p.processingOutcome} held={Boolean(p.detail?.suppressedOnHold)} /> : "Recorded";
  }
  if (e.kind === "statement_line") {
    const l = ws.statementLines.find((x) => x.id === e.refs[0]);
    if (!l) return "Recorded";
    const reportOnly = l.explanationCodes.includes("RC_PROVIDER_REPORT_ONLY") && l.status === "unallocated";
    return <Chip tone={reportOnly ? "neutral" : l.status === "allocated" ? "ok" : l.status === "exception" ? "bad" : "warn"} title={`API value: ${l.status}`}>{reportOnly ? "Recorded, not allocated" : label("statementLineStatus", l.status)}</Chip>;
  }
  if (e.kind === "allocation") return <Chip tone="ok">Allocated by trusted reference</Chip>;
  if (e.kind === "exception") {
    const x = ws.exceptions.find((y) => y.id === e.refs[0]);
    return x ? <Chip tone={x.status === "resolved" ? "neutral" : "bad"} title={`API value: ${x.status}`}>{`Exception ${label("exceptionStatus", x.status).toLowerCase()}`}</Chip> : "Exception";
  }
  if (e.kind === "missing_evidence") return <Chip tone="warn">Not yet received</Chip>;
  if (e.kind === "chain_observation") {
    const o = ws.chainObservations.find((x) => x.id === e.refs[0]);
    return o ? <Chip tone={o.status === "final" ? "ok" : "warn"} title={`API value: ${o.status}`}>{label("chainObservationStatus", o.status)}</Chip> : "Recorded";
  }
  return "Recorded";
}

/** Supporting reference for one timeline entry: the identifier a person would quote to the source. */
function referenceOf(e: EvidenceTimelineEntry, ws: Workspace): string[] {
  if (e.kind === "provider_event") {
    const p = ws.providerEvents.find((x) => x.id === e.refs[0]);
    return p ? [p.providerEventId, p.normalizedType] : e.refs;
  }
  if (e.kind === "statement_line") {
    const l = ws.statementLines.find((x) => x.id === e.refs[0]);
    return l ? [l.lineId, l.reference || "no reference"] : e.refs;
  }
  return e.refs;
}

/** Why the entry matters, in the engine's words for its codes plus what kind of evidence it is. */
function whyOf(e: EvidenceTimelineEntry): string {
  const base = e.kind === "provider_event" ? "Provider claim: it does not prove settlement on its own."
    : e.independent ? "Independent evidence: it can establish settlement."
    : e.kind === "missing_evidence" ? "Evidence the payment still needs."
    : e.kind === "allocation" ? "Matching decision: ties a record to this payment."
    : e.kind === "exception" ? "Needs a person before the payment can be closed."
    : "Context for the investigation.";
  const words = e.codes.map(describeCode).filter((w) => w && !/^Unrecognised code/.test(w));
  return [base, ...words].join(" ");
}

function Truth({ testId, title, question, tone, value, children }: { testId: string; title: string; question: string; tone: Tone; value: ReactNode; children?: ReactNode }) {
  return (
    <section className={`${ui.truth} ${TRUTH_CLASS[tone]}`} aria-labelledby={`${testId}-h`} data-testid={testId}>
      <h3 id={`${testId}-h`}>{title}</h3>
      <p className={ui.q}>{question}</p>
      <div className={ui.truthValue}>{value}</div>
      {children}
    </section>
  );
}

export default function Investigation({ id }: { id: string }) {
  const { ws, hydrated, actorName, preview, actorId } = useWorkspace();
  const { msg, run } = useRun();
  const [cancelReason, setCancelReason] = useState("");
  const intent = getIntent(ws, id);
  const res = useMemo(() => (intent ? investigate(ws, id) : null), [ws, id, intent]);
  const view = res && res.ok ? res.value : null;
  const tl = useMemo(() => (view ? evidenceTimelineFor(ws, id) : []), [ws, id, view]);

  if (!intent || !view) {
    if (!hydrated) return <p className={ui.empty} role="status">Loading payment…</p>;
    return (
      <>
        <PageHead eyebrow="Payment investigation" title="Payment not found" />
        <Panel><Empty>No payment <Code>{id}</Code> exists in this browser&apos;s workspace{res && !res.ok ? ` (${res.error.message})` : ""}. It may have been created before a reset. <Link href="/clearline/payments">Back to payments</Link></Empty></Panel>
      </>
    );
  }

  const st = view.status;
  const kase = view.caseId ? ws.cases.find((c) => c.id === view.caseId) : undefined;
  const quote = ws.quotes.find((q) => q.id === intent.selectedQuoteId);
  const diffs = diffsOf(view);
  const resolvedDiffs = resolvedDiffsOf(view);
  const lastProvider = tl.filter((e) => e.kind === "provider_event").at(-1);
  const matches = tl.filter((e) => e.kind === "allocation");
  const netZero = st.reconciliation === "matched" && intent.returnStatus === "confirmed_by_statement";
  const openExceptions = view.exceptions.filter((e) => e.status !== "resolved");

  // E. Payment-level actions, each gated by an engine dry run.
  const cancelAction = { type: "cancel_intent", intentId: id, reason: "Dry run" } as const;
  const gCancel = gateOf(preview(cancelAction), ws, false);
  const gCancelInput: Gate = gCancel.ok && !cancelReason.trim() ? { ok: false, reason: "Give a reason for cancelling first." } : gCancel;
  const gExport: Gate = kase ? { ok: true } : { ok: false, reason: "No investigation case is open for this payment. The engine opens one when a payment needs a person." };
  const exportReport = (fmt: "txt" | "json") => {
    if (!kase) return;
    const r = exportCaseReport(ws, kase.id);
    if (!r.ok) return;
    if (fmt === "txt") download(`${kase.id}.txt`, r.value.text, "text/plain");
    else download(`${kase.id}.json`, JSON.stringify(r.value.json, null, 2), "application/json");
  };

  return (
    <>
      <PageHead eyebrow="Payment investigation" title={`${view.requested.internalReference} · ${view.requested.beneficiaryName}`}
        lede={view.disclaimer}
        actions={<Link href="/clearline/payments" className={`${ui.btn} ${ui.small}`}>All payments</Link>} />

      {/* A. Summary */}
      <Panel title={<><span className={ui.sectionLetter} aria-hidden="true">A</span>Summary</>} id="summary">
        <div className={ui.panelBody} data-testid="section-a">
          <p className={`${ui.headline} ${ui.neutral}`} data-testid="operational-status">
            <span className={ui.srOnly}>Current operational status: </span>{statusSummary(st)}
          </p>
          <dl className={ui.summaryGrid}>
            <div><dt>Payment ID</dt><dd className="mono" data-testid="payment-id">{intent.id}</dd></div>
            <div><dt>Customer reference</dt><dd className="mono">{view.requested.internalReference}</dd></div>
            <div><dt>Origin → destination</dt><dd>{ws.organization.name} ({intent.sourceCurrency}) → {view.requested.beneficiaryName}, {view.requested.destinationCountry} ({view.requested.destinationCurrency})</dd></div>
            <div><dt>Amount sent</dt><dd className="num"><strong>{formatMoney(view.requested.amount)}</strong></dd></div>
            <div><dt>Recipient receives (quoted)</dt><dd className="num">{quote?.eligible ? <>{formatMinor(quote.estimatedRecipientMinor, quote.destinationCurrency)}<span className={ui.sub}>Indicative rate {quote.indicativeRate}</span></> : `${view.requested.destinationCurrency} — no route chosen`}</dd></div>
            <div><dt>Provider and route</dt><dd>{view.provider ? <>{view.provider.providerName} · {RAIL[view.provider.rail]}<span className={ui.sub + " mono"}>{view.provider.routeId}{view.provider.providerPaymentId ? ` · ${view.provider.providerPaymentId}` : ""}</span></> : "No route chosen yet"}</dd></div>
            <div><dt>Approval</dt><dd>{view.approval ? <>Maker {actorName(view.approval.makerId)} · checker {view.approval.checkerId ? actorName(view.approval.checkerId) : "not yet"}<span className={ui.apiValue}>{view.approval.status}</span></> : "Not prepared"}</dd></div>
            <div><dt>Last update</dt><dd className="num" data-testid="last-event">{view.lastEventAt ? <>{label("eventType", view.lastEventType ?? "")} <span className={ui.apiValue}>{view.lastEventType}</span><span className={ui.sub}>{fmtTime(view.lastEventAt)}</span></> : <>No provider events yet<span className={ui.sub}>Clock {fmtTime(ws.asOf)}</span></>}</dd></div>
            <div><dt>Last independent verification</dt><dd className="num" data-testid="last-verification">{view.lastIndependentVerificationAt ? fmtTime(view.lastIndependentVerificationAt) : "None yet"}</dd></div>
          </dl>
        </div>
      </Panel>

      {/* B. Three separate truths */}
      <section aria-labelledby="truths-h" id="truths" data-testid="section-b">
        <h2 id="truths-h" className={ui.eyebrow}><span className={ui.sectionLetter} aria-hidden="true">B</span>Three separate truths — never one badge</h2>
        <div className={ui.truths} data-testid="status-dimensions">
          <Truth testId="dim-execution" title="Execution" question="What the provider reported" tone={EXECUTION[st.execution][1]}
            value={<ExecChip v={st.execution} showValue />}>
            <p>{lastProvider ? <>Latest: {lastProvider.title} <span className={ui.sub}>{fmtTime(lastProvider.at)} · {lastProvider.source}</span></> : "The provider has not reported anything yet."}</p>
            <p className={ui.hint}>A provider report is a claim. It never proves settlement on its own.</p>
          </Truth>
          <Truth testId="dim-settlement" title="Settlement evidence" question="What independent evidence establishes" tone={SETTLEMENT[st.settlement][1]}
            value={<SettleChip v={st.settlement} showValue />}>
            <p>Scope: {SCOPE[st.settlementScope]} <span className={ui.apiValue}>{st.settlementScope}</span></p>
            <p className={ui.hint}>{view.lastIndependentVerificationAt ? `Last independent evidence ${fmtTime(view.lastIndependentVerificationAt)}.` : "No bank statement line or final on-chain transfer yet."}{view.chain ? ` ${view.chain.confirmations} of ${view.chain.finalityThreshold} confirmations on ${view.chain.network}; an on-chain transfer is not a bank credit.` : ""}</p>
          </Truth>
          <Truth testId="dim-reconciliation" title="Reconciliation" question="Whether the records match" tone={netZero ? "warn" : RECON[st.reconciliation][1]}
            value={<ReconChip v={st.reconciliation} returnStatus={intent.returnStatus} showValue />}>
            {intent.returnStatus && <p data-testid="return-status">{RETURN_STATUS[intent.returnStatus]}. The supplier is still unpaid. <span className={ui.apiValue}>returnStatus {intent.returnStatus}</span></p>}
            <p className={ui.hint}>{matches.length ? `${matches.length} record${matches.length === 1 ? "" : "s"} matched by trusted reference.` : "No record matched to this payment yet."}{openExceptions.length ? ` ${openExceptions.length} open exception${openExceptions.length === 1 ? "" : "s"}.` : ""}</p>
          </Truth>
        </div>
      </section>

      {/* C. Evidence timeline */}
      <Panel title={<><span className={ui.sectionLetter} aria-hidden="true">C</span>Evidence timeline</>} id="timeline">
        {tl.length === 0 ? <Empty>No evidence recorded yet.</Empty> : (
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Evidence timeline" data-testid="section-c">
            <table className={`${ui.table} ${ui.stack}`} data-testid="evidence-timeline">
              <caption className={ui.srOnly}>Every record about this payment, oldest first. Fictional sandbox data.</caption>
              <thead><tr><th scope="col">Time (SGT)</th><th scope="col">Source</th><th scope="col">Event</th><th scope="col">Processing outcome</th><th scope="col">Supporting reference</th><th scope="col">Why it matters</th></tr></thead>
              <tbody>
                {tl.map((e) => {
                  const pev = e.kind === "provider_event" ? ws.providerEvents.find((x) => x.id === e.refs[0]) : undefined;
                  const problem = e.kind === "missing_evidence" || e.kind === "exception" || (pev !== undefined && PROBLEM_OUTCOMES.includes(pev.processingOutcome));
                  const diff = (e as EvidenceTimelineEntry & WithDiff).amountDifference;
                  return (
                    <tr key={e.id} className={problem ? ui.tlProblem : e.independent ? ui.tlIndependent : undefined}>
                      <td data-label="Time" className={ui.num}>{e.kind === "missing_evidence" ? "Not yet received" : fmtTime(e.at)}</td>
                      <td data-label="Source">{e.source}<span className={ui.sub}>{e.independent ? "Independent" : "Not independent"} · <span className="mono">{e.provenance}</span></span></td>
                      <td data-label="Event"><strong>{label("timelineKind", e.kind)}</strong><span className={ui.sub} style={{ color: "var(--cl-text)" }}>{e.title}</span></td>
                      <td data-label="Outcome">{outcomeOf(e, ws)}</td>
                      <td data-label="Reference">{referenceOf(e, ws).map((r) => <span key={r} className="mono" style={{ display: "block", overflowWrap: "anywhere" }}>{r}</span>)}{e.codes.map((c) => <Code key={c}>{c}</Code>)}</td>
                      <td data-label="Why it matters">{whyOf(e)}{diff && <AmountDiff d={diff} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* D. Findings */}
      <Panel title={<><span className={ui.sectionLetter} aria-hidden="true">D</span>Findings</>} id="findings">
        <div className={ui.findings} data-testid="explanation">
          <section data-testid="finding-known"><h3>What we know</h3>
            <FindingList items={[...view.providerReported.findings, ...view.independentEvidence]} empty="Nothing confirmed yet." />
          </section>
          <section data-testid="finding-unknown"><h3>Still unknown</h3><FindingList items={view.unknowns} empty="No open questions." /></section>
          <section data-testid="finding-contradicts"><h3>What contradicts</h3><FindingList items={view.contradictions} empty="No contradictions found." /></section>
          <section data-testid="finding-outstanding"><h3>Financially outstanding</h3>
            {view.outstanding.length === 0 && diffs.length === 0 ? <p className={ui.hint} style={{ margin: 0 }}>Nothing outstanding.</p> :
              <ul>{view.outstanding.map((o, i) => <li key={i}>{o.amount && <strong className="num">{formatMoney(o.amount)} </strong>}{o.text} <Code>{o.code}</Code></li>)}</ul>}
            {diffs.map((d) => <AmountDiff key={d.statementLineId + d.code} d={d} />)}
            {resolvedDiffs.length > 0 && (
              <details style={{ marginTop: 8 }} data-testid="resolved-differences">
                <summary>Earlier differences, no longer outstanding ({resolvedDiffs.length})</summary>
                {resolvedDiffs.map((d) => <AmountDiff key={"r" + d.statementLineId + d.code} d={d} />)}
              </details>
            )}
          </section>
          <section className={ui.wide} data-testid="finding-owner"><h3>Who owns the next step</h3>
            <p style={{ margin: "0 0 4px" }}><strong>{view.whoActs.ownerName ?? "Unassigned"}</strong> — {label("role", view.whoActs.role)} <Code>{view.whoActs.code}</Code></p>
            <FindingList items={view.nextActions} empty="No action needed." />
          </section>
          {view.exceptions.length > 0 && (
            <section className={ui.wide} id="exceptions"><h3>Exceptions on this payment</h3>
              <ul>{view.exceptions.map((e) => <li key={e.id}><Link href={`/clearline/exceptions?view=all&intent=${id}#${e.id}`}>{exceptionTitle(e)}</Link> — {label("exceptionStatus", e.status)} · owner {actorName(e.ownerId)} · due <span className="mono">{e.dueDate ?? "—"}</span> <Code>{e.explanationCode}</Code></li>)}</ul>
            </section>
          )}
          {(view.hold || view.chain || view.funding) && (
            <section className={ui.wide}><h3>Linked records</h3>
              <ul>
                {view.hold && <li>Compliance hold: {view.hold.reason}. <HoldChip v={view.hold.status} /> Reported by the partner; never released automatically. <Link href={`/clearline/holds#${view.hold.id}`}>Open compliance holds</Link></li>}
                {view.chain && <li id="chain">Chain evidence: {view.chain.label}. <span className="num">{view.chain.confirmations} of {view.chain.finalityThreshold}</span> confirmations on {view.chain.network} — not a bank credit. <span className="mono" style={{ overflowWrap: "anywhere" }}>{view.chain.txHash}</span></li>}
                {view.funding && <li>Funding advance <AdvChip v={view.funding.state} /> <span className="num">principal {formatMoney(view.funding.principal)} · repaid {formatMoney(view.funding.repaid)} · outstanding <strong>{formatMoney(view.funding.outstanding)}</strong></span>. <Link href="/clearline/treasury/funding">Open funding exposure</Link></li>}
              </ul>
            </section>
          )}
          <section className={ui.wide}><h3>Explanation codes</h3><p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 4 }}>{view.explanationCodes.map((c) => <span key={c} title={describeCode(c)}><Code>{c}</Code></span>)}</p></section>
        </div>
      </Panel>

      {/* E. Actions */}
      <Panel title={<><span className={ui.sectionLetter} aria-hidden="true">E</span>Actions</>} id="actions">
        <div data-testid="section-e">
          <p className={ui.panelBody + " " + ui.hint} style={{ margin: 0 }}>Every action is checked by the engine before you click. When it is not allowed, the reason is shown under the button. Acting as: <strong>{actorName(actorId)}</strong> (change it at the top of the page).</p>
          <div id="simulate">
            <h3 className={ui.panelBody + " " + ui.eyebrow} style={{ margin: 0, paddingBottom: 0 }}>Provider activity (sandbox)</h3>
            <SimulateEvent intentId={id} idPrefix="inv" />
          </div>
          <div id="payment-actions" className={ui.panelBody} style={{ borderTop: "1px solid var(--cl-line)" }}>
            <h3 className={ui.eyebrow}>Payment</h3>
            <Status msg={msg} />
            <form className={ui.actions} style={{ alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); run("Cancel payment", { type: "cancel_intent", intentId: id, reason: cancelReason }, { onOk: () => setCancelReason("") }); }}>
              <Field label="Reason for cancelling"><input id="inv-cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></Field>
              <div><ActionButton type="submit" size="small" gate={gCancelInput}>Cancel payment</ActionButton></div>
            </form>
            <div className={ui.actions} style={{ marginTop: 12, alignItems: "flex-start" }}>
              <div><ActionButton size="small" gate={gExport} onClick={() => exportReport("txt")}>Export case report (.txt)</ActionButton></div>
              <div><ActionButton size="small" gate={gExport} onClick={() => exportReport("json")}>Export case report (.json)</ActionButton></div>
            </div>
          </div>
          <div id="case" style={{ borderTop: "1px solid var(--cl-line)" }}>
            <h3 className={ui.panelBody + " " + ui.eyebrow} style={{ margin: 0, paddingBottom: 0 }}>{kase ? <>Case · {kase.title}</> : "Case"}</h3>
            {!kase ? (
              <Empty>No investigation case is open for this payment. The engine opens one when a payment needs a person.</Empty>
            ) : (
              <>
                <div className={ui.panelBody}>
                  <dl className={ui.dl}>
                    <div><dt>Case ID</dt><dd className="mono">{kase.id}</dd></div>
                    <div><dt>Status</dt><dd>{label("caseStatus", kase.status)} <span className={ui.apiValue}>{kase.status}</span></dd></div>
                    <div><dt>Owner</dt><dd>{actorName(kase.ownerId)}</dd></div>
                    <div><dt>Information requests</dt><dd>{kase.requestedInfo.length} ({kase.requestedInfo.filter((r) => r.status === "open").length} open)</dd></div>
                  </dl>
                  {kase.notes.length > 0 && <ul>{kase.notes.map((n, i) => <li key={i}>{n.text} <span className={ui.hint}>— {actorName(n.actorId)}, {fmtTime(n.at)}</span></li>)}</ul>}
                  {kase.requestedInfo.length > 0 && <ul>{kase.requestedInfo.map((r) => <li key={r.id}>Requested from {r.from}: {r.request} <Chip tone={r.status === "open" ? "warn" : "neutral"}>{r.status}</Chip></li>)}</ul>}
                  <details>
                    <summary>Case history ({kase.history.length})</summary>
                    <ol className={ui.timeline}>{kase.history.map((h, i) => <li key={i} className={ui.tlItem}><span className={ui.tlTime}>{fmtTime(h.at)}</span><div><p className={ui.tlTitle}>{label("auditAction", h.action)}</p><p className={ui.tlMeta}>{h.detail} · {actorName(h.actorId)}</p></div></li>)}</ol>
                  </details>
                </div>
                <TargetActions target={{ kind: "case", id: kase.id }} status={kase.status} idPrefix="case" />
              </>
            )}
          </div>
        </div>
      </Panel>
      {!tl.some((e) => e.kind === "provider_event") && <Notice info>No provider events yet. Use “Simulate next provider event” after the instruction is submitted.</Notice>}
    </>
  );
}
