"use client";
import { useState } from "react";
import { SAMPLE_PAYMENTS } from "@/lib/sample";
import { ExecStatus, EvidenceStatus, ReconStatus } from "@/components/Status";

/** Interactive, fictional-data payment record. Mirrors the test-mode engine's seeded workspace. */
export default function PaymentPreview() {
  const [id, setId] = useState(SAMPLE_PAYMENTS[0].id);
  const p = SAMPLE_PAYMENTS.find(x => x.id === id) ?? SAMPLE_PAYMENTS[0];
  return (
    <div className="record" aria-label="Interactive fictional payment record">
      <div className="record-bar">
        <span className="record-title">Payment record</span>
        <span className="record-mode">Test mode · fictional data</span>
      </div>
      <div className="record-picker" role="group" aria-label="Choose a fictional payment">
        {SAMPLE_PAYMENTS.map(x => (
          <button type="button" key={x.id} aria-pressed={x.id === id} onClick={() => setId(x.id)}>
            <span className="mono">{x.reference}</span> {x.label}
          </button>
        ))}
      </div>
      <div className="record-body" aria-live="polite">
        <div className="record-head">
          <div>
            <p className="label">{p.id} · {p.reference}</p>
            <h3 className="record-name">{p.beneficiary}</h3>
          </div>
          <div className="record-amount">
            <span className="label">Amount</span>
            <strong className="num">{p.amount}</strong>
            <span className="caption">{p.corridor}</span>
          </div>
        </div>
        <dl className="record-status">
          <div><dt>Execution</dt><dd><ExecStatus state={p.exec} /></dd></div>
          <div><dt>Evidence</dt><dd><EvidenceStatus state={p.evidence} /></dd></div>
          <div><dt>Reconciliation</dt><dd><ReconStatus state={p.recon} /></dd></div>
          <div><dt>Route</dt><dd className="caption">{p.provider}</dd></div>
        </dl>
        <div className="record-cols">
          <div>
            <p className="label">Timeline</p>
            <ol className="timeline">
              {p.events.map((e, i) => (
                <li key={i}>
                  <span className="timeline-time mono">{e.time}</span>
                  <div><b>{e.label}</b><span className="caption">{e.source} · {e.evidence}</span></div>
                </li>
              ))}
            </ol>
          </div>
          <div className="record-explain">
            <p className="label">What happened</p>
            <p>{p.explanation}</p>
            <p className="label record-next">Next action</p>
            <p><b>{p.nextAction}</b></p>
          </div>
        </div>
      </div>
      <div className="record-foot">
        <span>Illustrative view of the test-mode engine&rsquo;s seeded data. No real payments.</span>
      </div>
    </div>
  );
}
