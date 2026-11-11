"use client";

import { useMemo, useState } from "react";
import {
  actors, decide, exceptions, freeCash, initialDemo, money, outstanding,
  payout, prepare, repay, review, setDate,
  type Demo, type Role,
} from "@/lib/mentor-demo/engine";
import styles from "./GuidedAdvance.module.css";

const ID = "ADV-001";
const steps = [
  { short: "The gap", title: "A supplier is waiting. The customer will pay later.", lead: "A payment provider is considering an advance of SGD 100,000 for Redwood Wholesale. The supplier needs paying before the customer repays the provider." },
  { short: "Five checks", title: "Before money goes out, make the reasoning visible.", lead: "The operator checks the proposed advance against the invoice, credit limit, earlier overdue funding, repayment terms and genuinely free cash." },
  { short: "Treasury decides", title: "The software prepares. A named person decides.", lead: "Maya prepares the case. Daniel, a different treasury reviewer, approves or declines with a recorded reason. Clearline does not make the credit decision." },
  { short: "Supplier paid", title: "A supplier payout is not a customer repayment.", lead: "The provider pays the supplier in its own system. Clearline records evidence of that payout and opens the outstanding receivable." },
  { short: "Repayment", title: "Money comes back in pieces.", lead: "The customer repays SGD 40,000. That reduces the amount still owed from SGD 100,000 to SGD 60,000." },
  { short: "The gap remains", title: "SGD 60,000 is still owed.", lead: "A partial receipt is not the same as a settled advance. The repayment due date remains visible alongside the balance." },
  { short: "Exception", title: "Past due. Visible. Explained.", lead: "Time passes beyond the agreed due date. Clearline surfaces the remaining SGD 60,000 as an overdue repayment, with the evidence needed to review it." },
  { short: "Evidence", title: "Every step has a person, a date and a reason.", lead: "Treasury can inspect the history and export a JSON evidence package with a SHA-256 integrity digest. This is not a cryptographic signature or an audit certification." },
] as const;
const stepCaptions = ["Explore", "Inspect", "Approve", "Record", "Match", "Understand", "Investigate", "Export"];

function download(filename: string, contents: string) {
  const objectUrl = URL.createObjectURL(new Blob([contents], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function GuidedAdvance() {
  const [state, setState] = useState<Demo>(() => initialDemo());
  const [role, setRole] = useState<Role>("operator");
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState("Invoice and terms reviewed; within customer limit and available cash.");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [digest, setDigest] = useState("");

  const advance = state.advances.find((a) => a.id === ID)!;
  const customer = state.customers.find((c) => c.id === advance.customerId)!;
  const checks = useMemo(() => review(state, ID), [state]);
  const incidents = useMemo(() => exceptions(state).filter((e) => e.advanceId === ID), [state]);
  const history = useMemo(() => state.events.filter((e) => e.advanceId === ID), [state]);
  const owed = outstanding(advance);
  const paid = advance.paid;
  const received = advance.repaid;
  const percentage = paid > 0 ? Math.round((received / paid) * 100) : 0;
  const allPass = checks.every((c) => c.status === "pass");

  const restart = () => {
    setState(initialDemo()); setStep(0); setRole("operator");
    setError(""); setFeedback(""); setDigest("");
    setReason("Invoice and terms reviewed; within customer limit and available cash.");
  };

  function transition(next: () => Demo, target: number, message: string) {
    try {
      const updated = next();
      setState(updated);
      setStep(target);
      setError("");
      setFeedback(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The fictional action could not be completed.");
      setFeedback("");
    }
  }

  async function exportEvidence() {
    try {
      const payload = {
        label: "FICTIONAL DEMO CASE — NOT A REAL FINANCIAL APPROVAL",
        as_of: state.asOf,
        advance,
        customer,
        cash: { ...state.cash, free: freeCash(state), note: "Cash classifications are provider-supplied, not determined by Clearline." },
        checks,
        events: history,
        outstanding: owed,
        export_note: "SHA-256 is an integrity digest, not an authorization signature or independent audit.",
      };
      const canonical = JSON.stringify(payload, null, 2) + "\n";
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      const hex = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
      download("clearline-adv-001-fictional-evidence.json", JSON.stringify({ ...payload, sha256_of_payload: hex }, null, 2) + "\n");
      setDigest(hex); setError(""); setFeedback("Fictional evidence JSON downloaded. SHA-256 integrity digest calculated locally.");
    } catch {
      setError("The download needs a secure browser context. Use the HTTPS demo link.");
    }
  }

  const current = steps[step];
  const action = () => {
    if (step === 0) { setStep(1); setFeedback(""); setError(""); return; }
    if (step === 1) { transition(() => prepare(state, ID, role), 2, "Maya prepared the case. This is not a credit approval."); return; }
    if (step === 2) { transition(() => decide(state, ID, role, "approved", reason), 3, "Daniel's simulated treasury decision and reason were recorded."); return; }
    if (step === 3) { transition(() => payout(setDate(state, "2026-11-10"), ID, role), 4, "Supplier payout evidence recorded for 10 Nov. No real payment was made."); return; }
    if (step === 4) { transition(() => repay(setDate(state, "2026-11-14"), ID, role, 40000), 5, "SGD 40,000 matched to this fictional advance. SGD 60,000 remains owed."); return; }
    if (step === 5) { transition(() => setDate(state, "2026-11-19"), 6, "Replay advanced beyond the 17 Nov due date. The remaining balance is overdue."); return; }
    if (step === 6) { setStep(7); setFeedback(""); setError(""); }
    if (step === 7) { void exportEvidence(); }
  };
  const actionLabels = [
    "Start guided case", "Prepare for treasury review", "Record treasury approval",
    "Record supplier payout", "Match SGD 40,000 repayment",
    "Advance the replay to 19 November", "Inspect the evidence trail", "Download evidence package",
  ];
  const allowed = step === 1 || step === 3 || step === 4 ? role === "operator" :
    step === 2 ? role === "approver" && reason.trim().length > 0 && allPass : true;
  const nextActor = step === 2 ? "Treasury approver" : step === 1 || step === 3 || step === 4 ? "Operator" : null;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="/mentor-demo" aria-label="Return to Clearline work queue">
          <span className={styles.brandMark}>C</span>
          <strong>clearline</strong><span className={styles.separator}>/</span><span>Funding Desk</span>
        </a>
        <div className={styles.topActions}>
          <a href="/mentor-demo" className={styles.back}>← Full work queue</a>
          <button type="button" className={styles.reset} onClick={restart}>↻ Restart story</button>
        </div>
      </header>
      <div className={styles.disclosure} role="note">FICTIONAL DEMO CASES · Simulated roles and records · No real funds, approvals or customer data</div>

      <main className={styles.container}>
        <div className={styles.intro}>
          <div><p className={styles.kicker}>THE ADVANCE-TO-REPAYMENT STORY · ADV-001</p>
            <h1>One advance. Every decision in view.</h1>
            <p>Follow a fictional SGD 100,000 supplier payment from the initial review to the last unresolved repayment.</p>
          </div>
          <div className={styles.rolePicker}>
            <label htmlFor="guide-role">Acting as · simulated</label>
            <select id="guide-role" aria-label="Demo role" value={role}
              onChange={(e) => { setRole(e.target.value as Role); setFeedback(""); setError(""); }}>
              <option value="operator">Maya · Operator</option>
              <option value="approver">Daniel · Treasury</option>
              <option value="viewer">Alex · Read-only viewer</option>
            </select>
            <small>Role switching is for demonstration, not authentication.</small>
          </div>
        </div>

        <nav className={styles.steps} aria-label="Guided case progress">
          {steps.map((item, index) => <div key={item.short}
            className={styles.step + (step === index ? " " + styles.currentStep : "") + (index < step ? " " + styles.finishedStep : "")}
            aria-current={step === index ? "step" : undefined}>
            <span className={styles.stepNumber}>{index < step ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <span className={styles.stepLabel}>{item.short}</span>
          </div>)}
        </nav>

        <div className={styles.mainGrid}>
          <section className={styles.story} aria-labelledby="story-title">
            <div className={styles.storyTop}>
              <div className={styles.storyIndex}>CHAPTER {String(step + 1).padStart(2, "0")} / 08 · {stepCaptions[step]}</div>
              <h2 id="story-title">{current.title}</h2>
              <p>{current.lead}</p>
            </div>

            {step === 0 && <div className={styles.concept}>
              <div><span>Business customer</span><strong>{customer.name}</strong><small>Repays the provider later</small></div>
              <div className={styles.flowArrow}>→</div>
              <div><span>Payment provider</span><strong>Northline Payments</strong><small>Advances its own funds</small></div>
              <div className={styles.flowArrow}>→</div>
              <div><span>Overseas supplier</span><strong>{advance.supplier}</strong><small>Paid through provider systems</small></div>
            </div>}

            {step === 1 && <div className={styles.checkList} aria-label="Advance checks">
              {checks.map((c, i) => <div className={styles.check} key={c.key}>
                <span className={styles.checkIndex}>{String(i + 1).padStart(2, "0")}</span>
                <div><strong>{c.title}</strong><p>{c.reason}</p></div>
                <span className={c.status === "pass" ? styles.goodStatus : styles.warningStatus}>{c.status === "pass" ? "PASS" : "REVIEW"}</span>
              </div>)}
              <div className={styles.cashFormula}>
                <strong>Free cash, not just bank balance</strong>
                <p>{money(state.cash.balance)} − {money(state.cash.safeguarded)} − {money(state.cash.pending)} − {money(state.cash.buffer)}</p>
                <b>= {money(freeCash(state))}</b>
                <small>Balance − provider-classified safeguarded funds − pending payouts − buffer. Classifications are supplied by the provider.</small>
              </div>
            </div>}

            {step === 2 && <div className={styles.approval}>
              <div className={styles.person}><span className={styles.personIcon}>M</span><div><strong>Maya · Operator</strong><small>Prepared for treasury · not approved</small></div><span className={styles.done}>Recorded</span></div>
              <div className={styles.person}><span className={styles.personIcon}>D</span><div><strong>Daniel · Treasury</strong><small>Independent reviewer · named decision</small></div><span className={styles.pending}>Decision needed</span></div>
              <label htmlFor="decision-reason">Reason recorded with approval</label>
              <textarea id="decision-reason" value={reason} rows={3} onChange={(e) => setReason(e.target.value)} />
              <p className={styles.note}>Switch the simulated role to Daniel before approving. A viewer or operator cannot perform this action.</p>
            </div>}

            {step >= 3 && step <= 6 && <div className={styles.flowLedger}>
              <div className={styles.flowRow}><div><small>10 NOV · SUPPLIER PAYOUT</small><strong>{money(paid || advance.amount)}</strong><span>{paid ? "Payout recorded from provider evidence" : "Pending provider payout record"}</span></div><span className={styles.outgoing}>OUT →</span></div>
              <div className={styles.lightRail}><div className={styles.lightFill} style={{ width: percentage + "%" }} /></div>
              <div className={styles.flowRow}><div><small>14 NOV · CUSTOMER REPAYMENT</small><strong>{money(received)}</strong><span>{received ? "Partial receipt allocated by reference" : "Waiting for an incoming receipt"}</span></div><span className={styles.returning}>← BACK</span></div>
              <div className={styles.owedAmount}><span>CUSTOMER STILL OWES</span><strong>{money(owed)}</strong><p>{percentage}% of the supplier payout repaid · agreed due date 17 Nov 2026</p></div>
              {step >= 6 && <div className={styles.overdueFlag}>OVERDUE · Due 17 Nov · Reviewing as of 19 Nov · {money(owed)} unresolved</div>}
              <div className={styles.formulaNote}>A recorded supplier payout creates the receivable. An incoming customer receipt reduces it. Clearline does not move either payment.</div>
            </div>}

            {step === 7 && <div className={styles.history} aria-label="Evidence timeline">
              {history.map((event) => <article className={styles.event} key={event.id}>
                <span className={styles.eventDot} aria-hidden="true" />
                <div><small>{event.at} · {event.actor}</small><strong>{event.label}</strong><p>{event.detail}</p></div>
              </article>)}
              <div className={styles.eventAlert}><strong>Outstanding on {state.asOf}: {money(owed)}</strong><span>Due {advance.due} · Late repayment requires human follow-up.</span></div>
              {digest && <div className={styles.digestBox}><small>SHA-256 OF EXPORTED PAYLOAD</small><code>{digest}</code><p>Integrity fingerprint only; not a signature or certification.</p></div>}
            </div>}

            <div className={styles.actionArea}>
              <div><span>Next action</span><strong>{nextActor ? "Requires simulated " + nextActor : "Walkthrough"}</strong></div>
              <button type="button" onClick={action} disabled={!allowed} className={styles.cta}>{actionLabels[step]} <span>→</span></button>
            </div>
            {!allowed && <p className={styles.roleWarning}>Select {nextActor === "Treasury approver" ? "Daniel · Treasury" : "Maya · Operator"} to continue. This separation is part of the demo.</p>}
            {error && <div className={styles.error} role="alert">{error}</div>}
            {feedback && <div className={styles.success} role="status">{feedback}</div>}
          </section>

          <aside className={styles.side}>
            <div className={styles.caseCard}>
              <div className={styles.caseHead}><span>THE CASE</span><span>ADV-001</span></div>
              <h3>{customer.name}</h3><p>Supplier · {advance.supplier}</p>
              <div className={styles.caseAmount}>{money(advance.amount)}</div>
              <dl>
                <div><dt>Invoice</dt><dd>{advance.invoice}</dd></div>
                <div><dt>Payout date</dt><dd>{advance.payoutDate}</dd></div>
                <div><dt>Repayment due</dt><dd>{advance.due}</dd></div>
                <div><dt>Replay date</dt><dd>{state.asOf}</dd></div>
                <div><dt>Case stage</dt><dd>{advance.stage.replaceAll("_", " ")}</dd></div>
              </dl>
            </div>
            <div className={styles.balanceCard}>
              <span>ADVANCE LIFE CYCLE</span>
              <div className={styles.miniNumber}><strong>{money(paid)}</strong><small>Supplier payout recorded</small></div>
              <div className={styles.miniNumber}><strong>{money(received)}</strong><small>Customer repayments recorded</small></div>
              <div className={styles.miniNumber}><strong>{money(owed)}</strong><small>Still owed · after recorded payout</small></div>
              <div className={styles.balanceBar}><span style={{ width: percentage + "%" }} /></div>
              <small>Only recorded supplier payouts create an outstanding balance.</small>
            </div>
            {step >= 6 && <div className={styles.flagCard}>
              <strong>{incidents.length} case exception{incidents.length === 1 ? "" : "s"}</strong>
              {incidents.map((e) => <p key={e.id}><b>{e.title}</b> · {e.detail}</p>)}
              <small>These alerts reflect only fictional case data, not provider systems.</small>
            </div>}
          </aside>
        </div>
        <footer className={styles.footer}>Clearline is an operational control prototype. Human treasury teams retain credit authority; the provider moves funds in its own systems. No escrow, blockchain, bank connectivity or real approvals occur here.</footer>
      </main>
    </div>
  );
}
