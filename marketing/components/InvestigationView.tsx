"use client";
import { useState } from "react";
import { SAMPLE_PAYMENTS, type SamplePayment } from "@/lib/sample";
import { ExecStatus, ReconStatus, SettlementStatus, type ExecState, type ReconState, type SettlementState } from "@/components/Status";

/**
 * Investigation view rendered as real HTML from the engine's seeded, FICTIONAL scenarios s1–s5
 * (lib/sample.ts). Three separate truths — execution, settlement evidence, reconciliation — each with a
 * human label and the exact API value. Hovering or focusing a truth highlights its field in the API record.
 */
type Dim = "execution" | "settlement" | "reconciliation";

const execWhy: Partial<Record<ExecState, string>> = {
  provider_reported_completed: "The provider's webhook says the payout completed. That is a claim, not settlement evidence.",
  returned: "The provider reported that the payout came back.",
  on_hold: "The partner is holding the payout and has asked for documents.",
  in_transit: "The provider says the payout is on its way.",
};
const settlementWhy: Record<SettlementState, string> = {
  none: "No bank-statement or chain evidence that the payout settled.",
  observed: "Some evidence exists, but it does not settle the question yet.",
  pending_finality: "A transfer was observed on the testnet, below the finality threshold. Observation is not finality.",
  verified: "An independent source agrees on reference, amount, currency and date window.",
  contradicted: "Independent sources disagree with what was reported.",
};
const reconWhy: Record<ReconState, string> = {
  not_started: "Nothing has been submitted to reconcile yet.",
  pending: "No statement line has been allocated to this payment yet.",
  matched: "A statement line was allocated by trusted reference, not by amount alone.",
  partially_matched: "The reference agrees but the amount covers only part; the remainder stays outstanding.",
  exception: "This needs a person. It stays an exception until someone resolves it.",
};

function apiLines(p: SamplePayment): { dim?: Dim; text: string }[] {
  const lines: { dim?: Dim; text: string }[] = [
    { text: `"internalReference": "${p.reference}",` },
    { text: `"status": {` },
    { dim: "execution", text: `  "execution": "${p.execution}",` },
    { dim: "settlement", text: `  "settlement": "${p.settlement}",` },
    { dim: "settlement", text: `  "settlementScope": "${p.settlementScope}",` },
    { dim: "reconciliation", text: `  "reconciliation": "${p.reconciliation}"` },
    { text: p.returnStatus ? `},` : `}` },
  ];
  if (p.returnStatus) lines.push({ dim: "reconciliation", text: `"returnStatus": "${p.returnStatus}"` });
  return lines;
}

export default function InvestigationView({ initial = "s1_success" }: { initial?: SamplePayment["scenario"] }) {
  const [key, setKey] = useState<SamplePayment["scenario"]>(initial);
  const [hl, setHl] = useState<Dim | null>(null);
  const p = SAMPLE_PAYMENTS.find(x => x.scenario === key) ?? SAMPLE_PAYMENTS[0];
  const hover = (d: Dim) => ({
    onMouseEnter: () => setHl(d), onMouseLeave: () => setHl(null), onFocus: () => setHl(d), onBlur: () => setHl(null),
    className: "iv-truth" + (hl === d ? " is-hl" : ""), tabIndex: 0,
  });
  return (
    <section className="iv" aria-label="Payment investigation, fictional sandbox data">
      <div className="iv-bar">
        <span className="iv-crumb">Control <span aria-hidden="true">/</span> Investigations <span aria-hidden="true">/</span> <b>{p.reference}</b></span>
        <span className="iv-mode">Test mode · fictional data</span>
      </div>
      <div className="iv-picker" role="group" aria-label="Choose one of five fictional payments">
        {SAMPLE_PAYMENTS.map(x => (
          <button type="button" key={x.scenario} aria-pressed={x.scenario === key} onClick={() => setKey(x.scenario)}>
            <span className="mono">{x.reference}</span>
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      <div aria-live="polite">
        <div className="iv-head">
          <div>
            <p className="label">Beneficiary</p>
            <p className="iv-name">{p.beneficiary}</p>
            <p className="iv-meta">{p.provider} · {p.corridor}</p>
          </div>
          <div className="iv-amount-wrap">
            <p className="label">Amount</p>
            <p className="iv-amount">{p.amount}</p>
          </div>
        </div>
        <dl className="iv-truths">
          <div {...hover("execution")}>
            <dt><span className="label">1 · Execution</span><span className="iv-q">What the provider says</span></dt>
            <dd><ExecStatus state={p.execution} /><p className="iv-why">{execWhy[p.execution] ?? "The payment's state in the engine's state machine."}</p></dd>
          </div>
          <div {...hover("settlement")}>
            <dt><span className="label">2 · Settlement evidence</span><span className="iv-q">What an independent source proves</span></dt>
            <dd><SettlementStatus state={p.settlement} scope={p.settlementScope} /><p className="iv-why">{settlementWhy[p.settlement]}</p></dd>
          </div>
          <div {...hover("reconciliation")}>
            <dt><span className="label">3 · Reconciliation</span><span className="iv-q">Whether it ties to the record</span></dt>
            <dd><ReconStatus state={p.reconciliation} />{p.returnStatus && <> <code className="st-api">returnStatus: {p.returnStatus}</code></>}<p className="iv-why">{reconWhy[p.reconciliation]}</p></dd>
          </div>
        </dl>
        <div className="iv-body">
          <div className="iv-col">
            <p className="label">Timeline · every event with its source and what the engine did</p>
            <ol className="timeline">
              {p.events.map((e, i) => (
                <li key={i}>
                  <span className="timeline-time mono">{e.time}</span>
                  <div><b className="mono">{e.label}</b><span className="caption">{e.source} · {e.outcome}</span></div>
                </li>
              ))}
            </ol>
          </div>
          <div className="iv-col">
            <dl className="iv-facts">
              <div className="iv-next"><dt>Next action</dt><dd>{p.nextAction}</dd></div>
              <div><dt>Who acts</dt><dd>{p.whoActs}</dd></div>
              <div><dt>Still unknown</dt><dd>{p.unknown}</dd></div>
            </dl>
            <div className="iv-api">
              <p className="label">API record · <span style={{ textTransform: "none" }}>GET /investigations/{"{intentId}"}</span></p>
              <pre tabIndex={0} aria-label="Exact API values for this payment">{apiLines(p).map((l, i) => <span key={i} className={l.dim && l.dim === hl ? "is-hl" : undefined}>{l.text}</span>)}</pre>
            </div>
          </div>
        </div>
      </div>
      <p className="iv-foot">The sandbox engine&rsquo;s five seeded scenarios, rendered from its own read models. Every organisation, provider, person and amount is fictional. No real payment was made.</p>
    </section>
  );
}
