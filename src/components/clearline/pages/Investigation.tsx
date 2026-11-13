"use client";
import Link from "../Link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { exportCaseReport, formatMoney, getIntent, investigate, timelineFor, type Finding } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ExecChip, ReconChip, SCOPE, SettleChip, RAIL, HoldChip, AdvChip, OutcomeChip, human } from "../labels";
import { evidenceTimeline } from "../evidence";
import { SimulateEvent } from "../SimulateEvent";
import { TargetActions } from "../TargetActions";
import { Btn, Chip, Code, Empty, Notice, PageHead, Panel, fmtTime, ui } from "../ui";
import { download } from "../download";

function Findings({ items, empty }: { items: Finding[]; empty: string }) {
  if (!items.length) return <p className={ui.hint} style={{ margin: 0 }}>{empty}</p>;
  return <ul>{items.map((f, i) => <li key={i}>{f.text} <Code>{f.code}</Code></li>)}</ul>;
}

export default function Investigation({ id: requested }: { id: string }) {
  const { ws, hydrated, actorName } = useWorkspace();
  const router = useRouter();
  // Accepts the documented scenario ids (pi_s1_success …) by the engine's intent.scenario label (UI_REQUESTS R1).
  const intent = getIntent(ws, requested) ?? ws.intents.find((i) => i.scenario && `pi_${i.scenario}` === requested);
  const id = intent?.id ?? requested;
  useEffect(() => { if (hydrated && intent && intent.id !== requested) router.replace(`/clearline/payments/${intent.id}`); }, [hydrated, intent, requested, router]);
  const res = useMemo(() => (intent ? investigate(ws, id) : null), [ws, id, intent]);
  const view = res && res.ok ? res.value : null;
  const tl = useMemo(() => (view ? evidenceTimeline(ws, id, actorName, view.unknowns) : []), [ws, id, view, actorName]);

  if (!intent || !view) {
    if (!hydrated) return <p className={ui.empty} role="status">Loading payment…</p>;
    return (
      <>
        <PageHead eyebrow="Payment investigation" title="Payment not found" />
        <Panel><Empty>No payment <Code>{id}</Code> exists in this browser&apos;s workspace{res && !res.ok ? ` (${res.error.message})` : ""}. It may have been created before a reset. <Link href="/clearline/payments">Back to payments</Link></Empty></Panel>
      </>
    );
  }

  const events = timelineFor(ws, id);
  const last = events[events.length - 1];
  const lastIndependent = tl.filter((e) => e.independent && e.at).map((e) => e.at!).sort().pop();
  const kase = view.caseId ? ws.cases.find((c) => c.id === view.caseId) : undefined;
  const amount = formatMoney(view.requested.amount);

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

      <Panel title="Payment" id="header">
        <div className={ui.panelBody}>
          <dl className={ui.dl}>
            <div><dt>Internal ID</dt><dd className="mono">{intent.id}</dd></div>
            <div><dt>Customer reference</dt><dd className="mono">{view.requested.internalReference}</dd></div>
            <div><dt>Amount</dt><dd className="num"><strong>{amount}</strong> → {view.requested.destinationCurrency}</dd></div>
            <div><dt>Origin</dt><dd>{ws.organization.name} · {intent.sourceCurrency}</dd></div>
            <div><dt>Destination</dt><dd>{view.requested.beneficiaryName} · {view.requested.destinationCountry} · {view.requested.destinationCurrency}</dd></div>
            <div><dt>Provider and rail</dt><dd>{view.provider ? <>{view.provider.providerName} · {RAIL[view.provider.rail]}{view.provider.providerPaymentId && <span className={ui.sub + " mono"}>{view.provider.providerPaymentId}</span>}</> : "No route chosen"}</dd></div>
          </dl>
          <h2 className={ui.srOnly}>Status dimensions</h2>
          <dl className={ui.dl} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--cl-line)" }} data-testid="status-dimensions">
            <div><dt>Execution (provider-reported)</dt><dd data-testid="dim-execution"><ExecChip v={view.status.execution} /></dd></div>
            <div><dt>Settlement evidence</dt><dd data-testid="dim-settlement"><SettleChip v={view.status.settlement} /><span className={ui.sub}>Scope: {SCOPE[view.status.settlementScope]}</span></dd></div>
            <div><dt>Reconciliation</dt><dd data-testid="dim-reconciliation"><ReconChip v={view.status.reconciliation} /></dd></div>
            <div><dt>Last event</dt><dd className="num">{last ? <>{last.normalizedType}<span className={ui.sub}>{fmtTime(last.receivedAt)}</span></> : "No provider events yet"}</dd></div>
            <div><dt>Last independent verification</dt><dd className="num">{lastIndependent ? fmtTime(lastIndependent) : "None yet"}</dd></div>
          </dl>
        </div>
      </Panel>

      <div className={ui.grid2} style={{ alignItems: "start" }}>
        <Panel title="Explanation" id="explanation">
          <div className={ui.explain} data-testid="explanation">
            <section><h3>Known</h3>
              <Findings items={[...view.providerReported.findings, ...view.independentEvidence]} empty="Nothing confirmed yet." />
            </section>
            <section><h3>Not yet known</h3><Findings items={view.unknowns} empty="No open questions." /></section>
            <section><h3>Contradictory</h3><Findings items={view.contradictions} empty="No contradictions found." /></section>
            <section><h3>Recommended action</h3><Findings items={view.nextActions} empty="No action needed." /></section>
            <section><h3>Owning team</h3>
              <p style={{ margin: 0 }}>{view.whoActs.ownerName ?? "Unassigned"} — {human(view.whoActs.role)} <Code>{view.whoActs.code}</Code></p>
            </section>
            <section><h3>Financially outstanding</h3>
              {view.outstanding.length === 0 ? <p className={ui.hint} style={{ margin: 0 }}>Nothing outstanding.</p> :
                <ul>{view.outstanding.map((o, i) => <li key={i}>{o.amount && <strong className="num">{formatMoney(o.amount)} </strong>}{o.text} <Code>{o.code}</Code></li>)}</ul>}
            </section>
            <section><h3>Explanation codes</h3><p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 4 }}>{view.explanationCodes.map((c) => <Code key={c}>{c}</Code>)}</p></section>
          </div>
        </Panel>

        <div>
          <Panel title="Simulate provider activity" id="simulate">
            <SimulateEvent intentId={id} idPrefix="inv" />
          </Panel>
          {view.hold && (
            <Panel title="Compliance hold" id="hold" actions={<HoldChip v={view.hold.status} />}>
              <div className={ui.panelBody}>
                <p style={{ marginTop: 0 }}>{view.hold.reason}. Reported by the partner; never released automatically.</p>
                <Link href={`/clearline/control/holds#${view.hold.id}`}>Record a reviewer decision on the holds page</Link>
              </div>
            </Panel>
          )}
          {view.chain && (
            <Panel title="Chain evidence" id="chain" actions={<Chip tone={view.chain.status === "final" ? "ok" : "warn"}>{human(view.chain.status)}</Chip>}>
              <div className={ui.panelBody}>
                <p style={{ marginTop: 0 }}>{view.chain.label}. <span className="num">{view.chain.confirmations} of {view.chain.finalityThreshold}</span> confirmations on {view.chain.network}. An on-chain transfer is not a bank credit.</p>
                <p className={ui.sub + " mono"} style={{ overflowWrap: "anywhere" }}>{view.chain.txHash}</p>
              </div>
            </Panel>
          )}
          {view.funding && (
            <Panel title="Funding advance" id="funding" actions={<AdvChip v={view.funding.state} />}>
              <div className={ui.panelBody}>
                <p style={{ marginTop: 0 }} className="num">Principal {formatMoney(view.funding.principal)} · repaid {formatMoney(view.funding.repaid)} · outstanding <strong>{formatMoney(view.funding.outstanding)}</strong></p>
                <Link href="/clearline/control/funding">Open funding exposure</Link>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <Panel title="Evidence timeline" id="timeline">
        {tl.length === 0 ? <Empty>No evidence recorded yet.</Empty> : (
          <ol className={ui.timeline} data-testid="evidence-timeline">
            {tl.map((e) => (
              <li key={e.key} className={`${ui.tlItem} ${e.problem ? ui.tlProblem : ""}`}>
                <span className={ui.tlTime}>{e.at ? fmtTime(e.at) : "Not yet received"}</span>
                <div>
                  <p className={ui.tlTitle}>
                    <Chip tone={e.kind === "missing" || e.kind === "exception" ? "bad" : e.independent ? "ok" : "neutral"}>{e.kindLabel}</Chip>
                    {e.title}
                    {e.outcome && <OutcomeChip v={e.outcome} />}
                    {e.independent !== undefined && <Chip tone={e.independent ? "ok" : "neutral"}>{e.independent ? "Independent" : "Not independent"}</Chip>}
                  </p>
                  <p className={ui.tlMeta}>Source: {e.source} · Provenance: {e.provenance}</p>
                  {e.details.map((d, i) => <p key={i} className={ui.tlMeta}>{d}</p>)}
                  {e.codes.length > 0 && <p className={ui.tlMeta}>{e.codes.map((c) => <Code key={c}>{c}</Code>)}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {view.exceptions.length > 0 && (
        <Panel title="Exceptions on this payment" id="exceptions">
          <ul className={ui.panelBody} style={{ margin: 0, paddingLeft: 30 }}>
            {view.exceptions.map((e) => <li key={e.id}><Link href={`/clearline/exceptions?view=all&intent=${id}#${e.id}`}>{human(e.category)}</Link> — {e.status.replace("_", " ")} · <Code>{e.explanationCode}</Code></li>)}
          </ul>
        </Panel>
      )}

      <Panel title={kase ? `Case: ${kase.title}` : "Case"} id="case"
        actions={kase ? <>
          <Chip tone={kase.status === "resolved" ? "ok" : "warn"}>{human(kase.status)}</Chip>
          <Btn size="small" onClick={() => exportReport("txt")}>Export case report (.txt)</Btn>
          <Btn size="small" onClick={() => exportReport("json")}>Export (.json)</Btn>
        </> : undefined}>
        {!kase ? (
          <Empty>No investigation case is open for this payment. The engine opens one when a payment needs a person; export is available once a case exists.</Empty>
        ) : (
          <>
            <div className={ui.panelBody}>
              <dl className={ui.dl}>
                <div><dt>Case ID</dt><dd className="mono">{kase.id}</dd></div>
                <div><dt>Owner</dt><dd>{actorName(kase.ownerId)}</dd></div>
                <div><dt>Notes</dt><dd>{kase.notes.length}</dd></div>
                <div><dt>Information requests</dt><dd>{kase.requestedInfo.length} ({kase.requestedInfo.filter((r) => r.status === "open").length} open)</dd></div>
              </dl>
              {kase.notes.length > 0 && <ul>{kase.notes.map((n, i) => <li key={i}>{n.text} <span className={ui.hint}>— {actorName(n.actorId)}, {fmtTime(n.at)}</span></li>)}</ul>}
              {kase.requestedInfo.length > 0 && <ul>{kase.requestedInfo.map((r) => <li key={r.id}>Requested from {r.from}: {r.request} <Chip tone={r.status === "open" ? "warn" : "ok"}>{r.status}</Chip></li>)}</ul>}
              <details>
                <summary>Case history ({kase.history.length})</summary>
                <ol className={ui.timeline}>{kase.history.map((h, i) => <li key={i} className={ui.tlItem}><span className={ui.tlTime}>{fmtTime(h.at)}</span><div><p className={ui.tlTitle}>{human(h.action)}</p><p className={ui.tlMeta}>{h.detail} · {actorName(h.actorId)}</p></div></li>)}</ol>
              </details>
            </div>
            <h3 className={ui.srOnly}>Case actions</h3>
            <TargetActions target={{ kind: "case", id: kase.id }} status={kase.status} idPrefix="case" />
          </>
        )}
      </Panel>
      {events.length === 0 && <Notice info>No provider events yet. Use “Simulate next provider event” after the instruction is submitted.</Notice>}
    </>
  );
}
