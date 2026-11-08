"use client";

import { useMemo, useState } from "react";
import {
  actors, decide, dailyDigest, exceptions, freeCash, initialDemo,
  journalCsv, ledgerCsv, money, outstanding, payout, prepare, repay,
  review, setDate, type Advance, type Demo, type Role,
} from "@/lib/mentor-demo/engine";
import styles from "./MentorDemo.module.css";

type Panel = "overview" | "approvals" | "exceptions" | "ledger" | "evidence" | "settings";
const nav: { key: Panel; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "◫" },
  { key: "approvals", label: "Approvals", icon: "◇" },
  { key: "exceptions", label: "Exceptions", icon: "⚑" },
  { key: "ledger", label: "Outstanding ledger", icon: "▤" },
  { key: "evidence", label: "Evidence", icon: "▧" },
  { key: "settings", label: "Demo settings", icon: "⚙" },
];
function download(filename: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type: type + ";charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  return <span className={`${styles.tag} ${styles[tone]}`}>{children}</span>;
}
const stageText: Record<Advance["stage"], string> = {
  proposed: "Proposed", prepared: "Prepared", approved: "Approved", supplier_paid: "Supplier paid",
  partly_repaid: "Partly repaid", repaid: "Repaid", declined: "Declined", written_off: "Written off",
};
export default function MentorDemo() {
  const [state, setState] = useState<Demo>(() => initialDemo());
  const [role, setRole] = useState<Role>("operator");
  const [panel, setPanel] = useState<Panel>("overview");
  const [selected, setSelected] = useState("ADV-001");
  const [reason, setReason] = useState("Terms, invoice, customer limit and free cash reviewed.");
  const [receipt, setReceipt] = useState("40000");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const active = state.advances.find((a) => a.id === selected) ?? state.advances[0];
  const customer = state.customers.find((c) => c.id === active.customerId)!;
  const checks = useMemo(() => review(state, active.id), [state, active.id]);
  const alerts = useMemo(() => exceptions(state), [state]);
  const totals = useMemo(() => ({
    owed: state.advances.reduce((n, a) => n + outstanding(a), 0),
    paid: state.advances.reduce((n, a) => n + a.paid, 0),
    open: state.advances.filter((a) => outstanding(a) > 0).length,
  }), [state]);
  const timeline = state.events.filter((event) => event.advanceId === active.id);
  const act = (next: () => Demo, confirmation: string) => {
    try {
      const updated = next();
      setState(updated);
      setMessage(confirmation);
      setWarning("");
    } catch (e) {
      setWarning(e instanceof Error ? e.message : "The action could not complete.");
      setMessage("");
    }
  };
  const select = (id: string, next: Panel = "approvals") => {
    setSelected(id); setPanel(next); setWarning(""); setMessage(""); setMobileNav(false);
  };
  async function exportEvidence() {
    const payload = {
      label: "SYNTHETIC DEMONSTRATION — NOT AN AUDITED APPROVAL",
      version: 1,
      as_of: state.asOf,
      advance: active,
      customer,
      cash: { ...state.cash, free: freeCash(state), classification_note: "Confirm classifications with counsel" },
      checks,
      events: timeline,
      made_by: active.preparedBy ?? "Not prepared",
      reviewed_by: active.decidedBy ?? "No treasury decision",
      outstanding: outstanding(active),
    };
    const canonical = JSON.stringify(payload, null, 2) + "\n";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    download(`clearline-${active.id.toLowerCase()}-evidence.json`,
      JSON.stringify({ ...payload, sha256_of_payload: hash }, null, 2) + "\n", "application/json");
    setMessage("Synthetic evidence JSON downloaded with a SHA-256 digest of its canonical payload.");
  }
  const jump = (key: Panel) => { setPanel(key); setMobileNav(false); setWarning(""); setMessage(""); };

  return (
    <div className={styles.app}>
      <aside className={`${styles.sidebar} ${mobileNav ? styles.sidebarOpen : ""}`}>
        <div className={styles.brand}>
          <span className={styles.mark}>C</span>
          <span><strong>Clearline</strong><small>FUNDING DESK</small></span>
        </div>
        <div className={styles.workspace}>
          <span className={styles.workspaceLabel}>WORKSPACE</span>
          <strong>Northline Payments</strong>
          <small>Fictional provider · Singapore</small>
        </div>
        <div className={styles.sectionLabel}>WORKSPACE</div>
        <nav aria-label="Funding desk sections" className={styles.nav}>
          {nav.map((item) => <button key={item.key} type="button" onClick={() => jump(item.key)}
            className={`${styles.navButton} ${panel === item.key ? styles.active : ""}`}
            aria-current={panel === item.key ? "page" : undefined}>
            <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>{item.label}
            {item.key === "exceptions" && <span className={styles.count}>{alerts.length}</span>}
          </button>)}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.help}>
            <strong>About this demonstration</strong>
            <p>Everything is fictional. No bank account, ERP or credit decision is connected.</p>
          </div>
          <div className={styles.avatar}><span>M</span><div><strong>Mentor preview</strong><small>Safe simulation</small></div></div>
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.topbar}>
          <button type="button" className={styles.menuButton} onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">☰</button>
          <div className={styles.breadcrumb}>Northline Payments <span>/</span> <strong>{nav.find((n) => n.key === panel)?.label}</strong></div>
          <div className={styles.topRight}><Tag tone="amber">SYNTHETIC DEMO</Tag><span className={styles.today}>As of {state.asOf}</span></div>
        </header>
        <div className={styles.body}>
          <div className={styles.pageHead}>
            <div><div className={styles.eyebrow}>CLEARLINE · OPERATIONS</div>
              <h1>{panel === "overview" ? "Funding operations, in control." : nav.find((n) => n.key === panel)?.label}</h1>
              <p>{panel === "overview" ? "Approve with evidence. Know what's still owed. Surface only what matters." :
                panel === "approvals" ? "A person prepares each advance; a different treasury reviewer makes the decision." :
                panel === "exceptions" ? "Only the repayments and receipts that need someone's attention." :
                panel === "ledger" ? "Supplier paid isn't the same as customer repaid." :
                panel === "evidence" ? "Every review connected to the facts known at the time." :
                "Simulation controls, provider cash assumptions and export options."}</p>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => { setState(initialDemo()); setPanel("overview"); setSelected("ADV-001"); setMessage("Demo reset to the original fictional records."); setWarning(""); }}>↻ Reset demo</button>
              <button type="button" className={styles.primary} onClick={() => download("clearline-open-advances.csv", ledgerCsv(state), "text/csv")}>↓ Export ledger</button>
            </div>
          </div>
          {warning && <div className={styles.error} role="alert">{warning}</div>}
          {message && <div className={styles.success} role="status">{message}</div>}
          <div className={styles.rolebar}>
            <span>ACTING AS</span>
            <select aria-label="Demo role" value={role} onChange={(e) => { setRole(e.target.value as Role); setMessage(""); setWarning(""); }}>
              <option value="operator">{actors.operator}</option>
              <option value="approver">{actors.approver}</option>
              <option value="viewer">{actors.viewer}</option>
            </select>
            <span className={styles.roleHint}>Role switching is for the simulation only—not real authentication.</span>
            <label className={styles.dateLabel}>Replay date <input aria-label="Replay date" type="date" min="2026-11-01" max="2026-11-30" value={state.asOf}
              onChange={(e) => act(() => setDate(state, e.target.value), "Replay date updated.")}/></label>
          </div>

          {panel === "overview" && <>
            <div className={styles.metrics}>
              <div className={styles.metric}><span>STILL OWED BY CUSTOMERS</span><strong>{money(totals.owed)}</strong><small>{totals.open} outstanding advances</small></div>
              <div className={styles.metric}><span>SUPPLIERS PAID</span><strong>{money(totals.paid)}</strong><small>Recorded payout evidence only</small></div>
              <div className={styles.metric}><span>FREE CASH ESTIMATE</span><strong>{money(freeCash(state))}</strong><small>After provider-designated restrictions</small></div>
              <div className={styles.metric}><span>NEEDS ATTENTION</span><strong>{alerts.length}</strong><small>{alerts.length === 0 ? "All clear" : "Exceptions awaiting review"}</small></div>
            </div>
            <div className={styles.twoCols}>
              <section className={styles.card}><div className={styles.cardTitle}><div><h2>What needs you today</h2><p>Quiet by design. Only exceptions appear here.</p></div><button className={styles.linkButton} onClick={() => jump("exceptions")}>View all →</button></div>
                {alerts.length ? alerts.slice(0, 4).map((item) => <button className={styles.exceptionRow} key={item.id} onClick={() => item.advanceId ? select(item.advanceId, "exceptions") : jump("exceptions")}>
                  <span className={item.severity === "high" ? styles.dotRed : styles.dotAmber}/><span><strong>{item.title}</strong><small>{item.detail}</small></span><span className={styles.chevron}>↗</span>
                </button>) : <div className={styles.empty}>✓ All clear. Nothing needs you today.</div>}
              </section>
              <section className={styles.card}><div className={styles.cardTitle}><div><h2>At the cutoff</h2><p>Start with a proposed advance.</p></div></div>
                <div className={styles.focus}><span>REQUIRES OPERATOR REVIEW</span><strong>{active.id === "ADV-001" ? "ADV-001" : "ADV-001"}</strong><p>Redwood Wholesale → Harbor Machinery</p><div className={styles.focusAmount}>SGD 100,000.00</div><Tag>Proposed</Tag></div>
                <button className={styles.primaryWide} onClick={() => select("ADV-001")}>Open advance review <span>↗</span></button>
              </section>
            </div>
            <section className={styles.card}><div className={styles.cardTitle}><div><h2>Outstanding advances</h2><p>From supplier payout through full repayment.</p></div><button className={styles.linkButton} onClick={() => jump("ledger")}>Open ledger →</button></div><AdvanceTable state={state} onSelect={(id) => select(id, "ledger")}/></section>
          </>}

          {(panel === "approvals" || panel === "evidence") && <>
            <div className={styles.selector}><label>ADVANCE <select aria-label="Select advance" value={active.id} onChange={(e) => select(e.target.value, panel)}>
              {state.advances.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.supplier}</option>)}
            </select></label><Tag tone={active.stage === "declined" ? "red" : active.stage === "repaid" ? "green" : "neutral"}>{stageText[active.stage]}</Tag></div>
            <div className={styles.twoColsMain}>
              <section className={styles.card}><div className={styles.detailHeader}><span>ADVANCE {active.id}</span><h2>{customer.name}</h2><p>Supplier: {active.supplier} · Invoice {active.invoice}</p><strong>{money(active.amount)}</strong></div>
                <div className={styles.infoGrid}><div><span>DUE DATE</span><strong>{active.due}</strong></div><div><span>PAYOUT DATE</span><strong>{active.payoutDate}</strong></div><div><span>AMOUNT PAID</span><strong>{money(active.paid)}</strong></div><div><span>STILL OWED</span><strong>{money(outstanding(active))}</strong></div></div>
                <div className={styles.cardTitle}><div><h2>Deterministic advance checks</h2><p>Five visible checks; software does not approve credit.</p></div></div>
                {checks.map((check) => <div className={styles.check} key={check.key}><Tag tone={check.status === "pass" ? "green" : check.status === "fail" ? "red" : "amber"}>{check.status.replace("_", " ")}</Tag><span><strong>{check.title}</strong><small>{check.reason}</small></span></div>)}
                <div className={styles.decision}>
                  <label>Decision reason<textarea aria-label="Decision reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3}/></label>
                  <div className={styles.buttonRow}>
                    <button type="button" className={styles.secondary} disabled={role !== "operator" || active.stage !== "proposed"} onClick={() => act(() => prepare(state, active.id, role), "Advance prepared; now switch to treasury approver.")}>Prepare advance</button>
                    <button type="button" className={styles.primary} disabled={role !== "approver" || active.stage !== "prepared" || checks.some((c) => c.status !== "pass")} onClick={() => act(() => decide(state, active.id, role, "approved", reason), "Treasury approval recorded in synthetic timeline.")}>Approve</button>
                    <button type="button" className={styles.danger} disabled={role !== "approver" || active.stage !== "prepared" || !reason.trim()} onClick={() => act(() => decide(state, active.id, role, "declined", reason), "Treasury decline recorded with a reason.")}>Decline</button>
                  </div>
                  <p className={styles.fine}>Maker-checker enforced: operator prepares; a separate treasury approver decides. These are simulated identities.</p>
                </div>
              </section>
              <section className={styles.card}><div className={styles.cardTitle}><div><h2>Evidence timeline</h2><p>Recorded simulated steps, in order.</p></div></div>
                {timeline.length ? timeline.map((e) => <div className={styles.timeline} key={e.id}><span className={styles.timeDot}/><div><small>{e.at} · {e.actor}</small><strong>{e.label}</strong><p>{e.detail}</p></div></div>) : <div className={styles.empty}>No actions recorded for this advance yet.</div>}
                <div className={styles.evidenceActions}>
                  <button className={styles.secondary} type="button" onClick={() => void exportEvidence()}>↓ Download evidence JSON</button>
                  <button className={styles.secondary} type="button" onClick={() => download("clearline-daily-digest.txt", dailyDigest(state))}>↓ Daily digest</button>
                </div>
              </section>
            </div>
          </>}

          {panel === "exceptions" && <section className={styles.card}><div className={styles.cardTitle}><div><h2>Exception queue</h2><p>{alerts.length} flagged issues · no notifications when everything is clear</p></div><button className={styles.secondary} onClick={() => download("clearline-daily-digest.txt", dailyDigest(state))}>↓ Daily digest</button></div>
            {alerts.length === 0 ? <div className={styles.empty}>✓ Nothing needs you today. All clear.</div> : alerts.map((e) => <div className={styles.exceptionDetail} key={e.id}>
              <Tag tone={e.severity === "high" ? "red" : "amber"}>{e.severity === "high" ? "Attention" : "Review"}</Tag><div><h3>{e.title}</h3><p>{e.detail}</p></div>
              {e.advanceId && <button className={styles.linkButton} onClick={() => select(e.advanceId!, "approvals")}>Inspect evidence →</button>}
            </div>)}
            <div className={styles.cardTitle}><div><h2>Daily digest preview</h2><p>For the provider&apos;s existing email or Slack workflow.</p></div></div><pre className={styles.digest}>{dailyDigest(state)}</pre>
          </section>}

          {panel === "ledger" && <><section className={styles.card}><div className={styles.cardTitle}><div><h2>Advances and repayments</h2><p>The outstanding amount is calculated from recorded supplier payouts, repayments, and adjustments.</p></div></div><AdvanceTable state={state} onSelect={(id) => select(id, "ledger")}/></section>
            <div className={styles.twoCols}>
              <section className={styles.card}><div className={styles.cardTitle}><div><h2>Record synthetic payout</h2><p>A file-backed payout event; no money is sent.</p></div></div>
                <div className={styles.actionForm}><label>Advance<select aria-label="Payout advance" value={selected} onChange={(e) => setSelected(e.target.value)}>{state.advances.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}</select></label>
                  <button className={styles.primary} disabled={role !== "operator" || active.stage !== "approved"} onClick={() => act(() => payout(state, selected, role), "Synthetic supplier payout recorded.")}>Record supplier paid</button><small>Available after treasury approval and on or after payout date.</small>
                </div>
              </section>
              <section className={styles.card}><div className={styles.cardTitle}><div><h2>Match synthetic receipt</h2><p>Reference first; never match an ambiguous amount alone.</p></div></div>
                <div className={styles.actionForm}><label>Advance<select aria-label="Receipt advance" value={selected} onChange={(e) => setSelected(e.target.value)}>{state.advances.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.invoice}</option>)}</select></label>
                  <label>Receipt amount (SGD, whole units)<input aria-label="Receipt amount" type="number" min="1" step="1" value={receipt} onChange={(e) => setReceipt(e.target.value)}/></label>
                  <button className={styles.primary} disabled={role !== "operator" || outstanding(active) === 0} onClick={() => act(() => repay(state, active.id, role, Number(receipt)), "Receipt matched by reference and outstanding balance updated.")}>Record customer repayment</button></div>
              </section>
            </div>
          </>}

          {panel === "settings" && <div className={styles.twoCols}>
            <section className={styles.card}><div className={styles.cardTitle}><div><h2>Cash classification</h2><p>Provider-supplied assumptions; confirm safeguarding treatment with counsel.</p></div></div>
              {([["Bank balance", state.cash.balance], ["Safeguarded customer money", state.cash.safeguarded], ["Pending payouts", state.cash.pending], ["Operating liquidity buffer", state.cash.buffer]] as const)
                .map(([name, n]) => <div className={styles.settingRow} key={name}><span>{name}</span><strong>{money(n)}</strong></div>)}
              <div className={styles.total}><span>Free cash available for review</span><strong>{money(freeCash(state))}</strong></div>
              <p className={styles.fine}>Undrawn credit lines are excluded. This is a simulated view, not safeguarding legal advice.</p>
            </section>
            <section className={styles.card}><div className={styles.cardTitle}><div><h2>Exports for existing tools</h2><p>Files, not automatic bank or ERP postings.</p></div></div>
              <div className={styles.exportList}>
                <button onClick={() => download("clearline-open-advances.csv", ledgerCsv(state), "text/csv")}>↧ Open advances CSV <span>Stable column order</span></button>
                <button onClick={() => download("clearline-journal-illustration.csv", journalCsv(state), "text/csv")}>↧ Accounting journal CSV <span>Balanced illustrative entries; not a production mapping</span></button>
                <button onClick={() => download("clearline-daily-digest.txt", dailyDigest(state))}>↧ Exceptions digest <span>Plain English, one-line all clear when empty</span></button>
              </div>
              <div className={styles.cardTitle}><div><h2>Roles</h2><p>Simulated accounts only</p></div></div>
              <div className={styles.settingRow}><span>Operator</span><strong>{actors.operator}</strong></div>
              <div className={styles.settingRow}><span>Treasury approver</span><strong>{actors.approver}</strong></div>
              <div className={styles.settingRow}><span>Viewer</span><strong>{actors.viewer}</strong></div>
            </section>
          </div>}
          <footer className={styles.footer}>Clearline Funding Desk · fictional data · no real transfers, accounts, approvals or customer records · browser-only mentor demonstration</footer>
        </div>
      </main>
    </div>
  );
}
function AdvanceTable({ state, onSelect }: { state: Demo; onSelect: (id: string) => void }) {
  return <div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr><th>Advance</th><th>Customer / Supplier</th><th>Amount</th><th>Still owed</th><th>Due date</th><th>Status</th><th></th></tr></thead>
    <tbody>{state.advances.map((a) => <tr key={a.id}><td><strong>{a.id}</strong><small>{a.invoice}</small></td><td>{state.customers.find((c) => c.id === a.customerId)?.name}<small>{a.supplier}</small></td><td>{money(a.amount)}</td><td><strong>{money(outstanding(a))}</strong></td><td>{a.due}</td><td><Tag tone={a.stage === "repaid" ? "green" : a.stage === "declined" ? "red" : a.stage === "partly_repaid" ? "amber" : "neutral"}>{stageText[a.stage]}</Tag></td>
      <td><button type="button" className={styles.linkButton} onClick={() => onSelect(a.id)}>View ↗</button></td></tr>)}</tbody>
  </table></div>;
}
