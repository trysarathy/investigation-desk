"use client";
import { useState } from "react";
import { INVESTIGATIONS, type Investigation } from "@/lib/investigations";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";

/**
 * The console's payment investigation page (rc3/clearline-app, pages/Investigation.tsx), rendered as real HTML
 * from lib/investigations.ts, which is GENERATED from the tested engine's five fictional sample scenarios.
 * Same structure and words as the console: A Summary, B Three separate truths, C Evidence timeline, D Findings.
 * Focusing or hovering a truth highlights its field in the API record. Nothing here is computed by the website.
 */
type Dim = "execution" | "settlement" | "reconciliation";

const TAB_LABEL: Record<Investigation["scenario"], string> = {
  s1_success: "Completed, bank-matched",
  s2_returned: "Returned",
  s3_hold: "Compliance hold",
  s4_chain: "Base Sepolia, finality pending",
  s5_funding: "Funded advance",
};

function apiLines(p: Investigation): { dim?: Dim; text: string }[] {
  const lines: { dim?: Dim; text: string }[] = [
    { text: `"internalReference": "${p.reference}",` },
    { text: `"status": {` },
    { dim: "execution", text: `  "execution": "${p.status.execution}",` },
    { dim: "settlement", text: `  "settlement": "${p.status.settlement}",` },
    { dim: "settlement", text: `  "settlementScope": "${p.status.settlementScope}",` },
    { dim: "reconciliation", text: `  "reconciliation": "${p.status.reconciliation}"` },
    { text: p.returnStatus ? `},` : `}` },
  ];
  if (p.returnStatus) lines.push({ dim: "reconciliation", text: `"returnStatus": "${p.returnStatus}"` });
  return lines;
}

const strip = (s: string) => s.replace(/ \(fictional( supplier)?\)/g, "");

export default function InvestigationView({ initial = "s2_returned", compact = false }: { initial?: Investigation["scenario"]; compact?: boolean }) {
  const [key, setKey] = useState<Investigation["scenario"]>(initial);
  const [hl, setHl] = useState<Dim | null>(null);
  const p = INVESTIGATIONS.find(x => x.scenario === key) ?? INVESTIGATIONS[0];
  const truth = (d: Dim) => ({
    onMouseEnter: () => setHl(d), onMouseLeave: () => setHl(null), onFocus: () => setHl(d), onBlur: () => setHl(null),
    className: "iv-truth" + (hl === d ? " is-hl" : ""), tabIndex: 0,
  });
  const matches = p.timeline.filter(e => e.kind === "Matching decision").length;
  const open = p.exceptions.filter(e => e.status !== "Resolved").length;
  return (
    <section className={"iv" + (compact ? " iv-compact" : "")} aria-label="Payment investigation in the Clearline console, fictional sandbox data">
      <div className="iv-bar">
        <span className="iv-crumb">Console <span aria-hidden="true">›</span> Investigations <span aria-hidden="true">›</span> <b>{p.reference}</b></span>
        <span className="iv-mode">Test mode · fictional data</span>
      </div>
      <div className="iv-picker" role="group" aria-label="Choose one of five fictional payments">
        {INVESTIGATIONS.map(x => (
          <button type="button" key={x.scenario} aria-pressed={x.scenario === key} onClick={() => setKey(x.scenario)}>
            <span className="mono">{x.reference}</span>
            <span>{TAB_LABEL[x.scenario]}</span>
          </button>
        ))}
      </div>
      <div aria-live="polite">
        {/* A. Summary */}
        <div className="iv-head">
          <div>
            <p className="label"><span className="iv-letter" aria-hidden="true">A</span>Payment investigation</p>
            <p className="iv-name">{p.reference} · {strip(p.beneficiary)}</p>
            <p className="iv-summary"><span className="sr-only">Current operational status: </span>{p.summary}</p>
          </div>
          <div className="iv-amount-wrap">
            <p className="label">Amount sent</p>
            <p className="iv-amount">{p.amount}</p>
          </div>
          <dl className="iv-meta-grid">
            <div><dt>Provider and route</dt><dd>{p.provider}</dd></div>
            <div><dt>Approval</dt><dd>{strip(p.approval)}</dd></div>
            <div><dt>Recipient receives (quoted)</dt><dd className="num">{p.recipientQuoted ?? "—"}</dd></div>
            <div><dt>Last independent verification</dt><dd className="num">{p.lastIndependent ?? "None yet"}</dd></div>
          </dl>
        </div>

        {/* B. Three separate truths */}
        <p className="iv-section"><span className="iv-letter" aria-hidden="true">B</span>Three separate truths — never one badge</p>
        <dl className="iv-truths">
          <div {...truth("execution")}>
            <dt><span className="label">Execution</span><span className="iv-q">What the provider reported</span></dt>
            <dd><ExecStatus state={p.status.execution} /><p className="iv-why">A provider report is a claim. It never proves settlement on its own.</p></dd>
          </div>
          <div {...truth("settlement")}>
            <dt><span className="label">Settlement evidence</span><span className="iv-q">What independent evidence establishes</span></dt>
            <dd><SettlementStatus state={p.status.settlement} />
              <p className="iv-why">Scope: {p.scopeText} <code className="st-api">{p.status.settlementScope}</code></p>
              {p.chain && <p className="iv-why">{p.chain}</p>}</dd>
          </div>
          <div {...truth("reconciliation")}>
            <dt><span className="label">Reconciliation</span><span className="iv-q">Whether the records match</span></dt>
            <dd><ReconStatus state={p.status.reconciliation} />
              {p.returnStatusText && <p className="iv-why">{p.returnStatusText}. <code className="st-api">returnStatus {p.returnStatus}</code></p>}
              {p.returnPosition && <p className="iv-why">{p.returnPosition.text} <code className="st-api">{p.returnPosition.code}</code></p>}
              <p className="iv-why">{matches ? `${matches} record${matches === 1 ? "" : "s"} matched by trusted reference.` : "No record matched to this payment yet."}{open ? ` ${open} open exception${open === 1 ? "" : "s"}.` : ""}</p></dd>
          </div>
        </dl>

        <div className="iv-body">
          {/* C. Evidence timeline */}
          <div className="iv-col iv-col-tl">
            <p className="iv-section iv-section-inline"><span className="iv-letter" aria-hidden="true">C</span>Evidence timeline</p>
            <ol className="iv-tl">
              {p.timeline.map((e, i) => (
                <li key={i} className={e.independent ? "is-independent" : e.tone === "danger" || e.tone === "warning" ? "is-problem" : undefined}>
                  <span className="iv-tl-time mono">{e.time}</span>
                  <div>
                    <p className="iv-tl-kind">{e.kind} <span className="iv-tl-src">· {e.independent ? "Independent" : "Not independent"}</span></p>
                    <p className="iv-tl-event">{strip(e.event)}</p>
                    {e.ref && <p className="iv-tl-ref mono">{e.ref}</p>}
                    <p className="iv-tl-meta"><span className={"tag tone-" + e.tone}>{e.outcome}</span> <span className="iv-tl-source">{e.source}</span></p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {/* D. Findings */}
          <div className="iv-col">
            <p className="iv-section iv-section-inline"><span className="iv-letter" aria-hidden="true">D</span>Findings</p>
            <dl className="iv-facts">
              <div className="iv-next"><dt>Who owns the next step</dt><dd><b>{strip(p.owner.name)}</b> — {p.owner.role} <code className="st-api">{p.owner.code}</code>
                <ul>{p.nextActions.map(a => <li key={a}>{a}</li>)}</ul></dd></div>
              <div><dt>Still unknown</dt><dd><ul>{p.unknown.map(u => <li key={u}>{u}</li>)}</ul></dd></div>
              <div><dt>Financially outstanding</dt><dd>{p.outstanding.length === 0 ? "Nothing outstanding." :
                <ul>{p.outstanding.map(o => <li key={o.code + o.text}>{o.amount && <b className="num">{o.amount} </b>}{o.text}</li>)}</ul>}</dd></div>
              {!compact && p.exceptions.length > 0 && <div><dt>Exceptions on this payment</dt><dd><ul>{p.exceptions.map(x => <li key={x.code}>{x.title} — {x.status} · owner {strip(x.owner)} · due <span className="num">{x.dueDate ?? "—"}</span></li>)}</ul></dd></div>}
            </dl>
            <div className="iv-api">
              <p className="label">API record · <span style={{ textTransform: "none" }}>GET /investigations/{"{intentId}"}</span></p>
              <pre tabIndex={0} aria-label="Exact API values for this payment">{apiLines(p).map((l, i) => <span key={i} className={l.dim && l.dim === hl ? "is-hl" : undefined}>{l.text}</span>)}</pre>
            </div>
          </div>
        </div>
      </div>
      <p className="iv-foot">Rendered from the tested engine&rsquo;s five fictional sample payments, with the console&rsquo;s own labels. Every organisation, provider, person and amount is fictional. No real payment was made.</p>
    </section>
  );
}
