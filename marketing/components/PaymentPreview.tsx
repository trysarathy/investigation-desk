"use client";
import { useState } from "react";
import { SAMPLE_PAYMENTS } from "@/lib/sample";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";

/** Interactive, fictional-data payment record. Mirrors the engine's seeded scenarios s1–s5. */
export default function PaymentPreview() {
  const [key, setKey] = useState(SAMPLE_PAYMENTS[0].scenario);
  const p = SAMPLE_PAYMENTS.find(x => x.scenario === key) ?? SAMPLE_PAYMENTS[0];
  return (
    <div className="record" aria-label="Interactive fictional payment record">
      <div className="record-bar">
        <span className="record-title">Payment record</span>
        <span className="record-mode">Test mode · fictional data</span>
      </div>
      <div className="record-picker" role="group" aria-label="Choose a fictional payment">
        {SAMPLE_PAYMENTS.map(x => (
          <button type="button" key={x.scenario} aria-pressed={x.scenario === key} onClick={() => setKey(x.scenario)}>
            <span className="mono">{x.reference}</span> {x.label}
          </button>
        ))}
      </div>
      <div className="record-body" aria-live="polite">
        <div className="record-head">
          <div>
            <p className="label">{p.scenario} · {p.reference}</p>
            <h3 className="record-name">{p.beneficiary}</h3>
          </div>
          <div className="record-amount">
            <span className="label">Amount</span>
            <strong className="num">{p.amount}</strong>
            <span className="caption">{p.corridor}</span>
          </div>
        </div>
        <dl className="record-status">
          <div><dt>execution</dt><dd><ExecStatus state={p.execution} /></dd></div>
          <div><dt>settlement</dt><dd><SettlementStatus state={p.settlement} scope={p.settlementScope} /></dd></div>
          <div><dt>reconciliation</dt><dd><ReconStatus state={p.reconciliation} /></dd></div>
          <div><dt>Route</dt><dd className="caption">{p.provider}</dd></div>
        </dl>
        <div className="record-cols">
          <div>
            <p className="label">Timeline</p>
            <ol className="timeline">
              {p.events.map((e, i) => (
                <li key={i}>
                  <span className="timeline-time mono">{e.time}</span>
                  <div><b>{e.label}</b><span className="caption">{e.source} · {e.outcome}</span></div>
                </li>
              ))}
            </ol>
          </div>
          <div className="record-explain">
            <p className="label">Who acts</p>
            <p>{p.whoActs}</p>
            <p className="label record-next">Next action</p>
            <p><b>{p.nextAction}</b></p>
            <p className="label record-next">Still unknown</p>
            <p>{p.unknown}</p>
          </div>
        </div>
      </div>
      <div className="record-foot">
        <span>The sandbox engine&rsquo;s seeded scenarios. Fictional providers and amounts. No real payments.</span>
      </div>
    </div>
  );
}
