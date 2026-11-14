"use client";

import { useMemo, useState } from "react";
import {
  actors, createDemoAdvance, decide, dailyDigest, exceptions, freeCash, importBundledSample, initialDemo,
  journalCsv, ledgerCsv, money, outstanding, payout, prepare, repay,
  review, setDate, type Advance, type Demo, type Role,
} from "@/lib/mentor-demo/engine";
import styles from "./MentorDemo.module.css";

type Panel = "overview" | "approvals" | "exceptions" | "ledger" | "evidence" | "settings" | "newcase";
const nav: { key: Panel; label: string; icon: string }[] = [
  { key: "overview", label: "Queue", icon: "◫" },
  { key: "approvals", label: "Advance review", icon: "◇" },
  { key: "exceptions", label: "Exceptions", icon: "⚑" },
  { key: "ledger", label: "Outstanding ledger", icon: "▤" },
  { key: "evidence", label: "Evidence", icon: "▧" },
  { key: "settings", label: "Demo settings", icon: "⚙" },
  { key: "newcase", label: "New case", icon: "+" },
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
  const [queueQuery, setQueueQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState("all");
  const [newCustomer, setNewCustomer] = useState("C-001");
  const [newSupplier, setNewSupplier] = useState("");
  const [newInvoice, setNewInvoice] = useState("");
  const [newAmount, setNewAmount] = useState("50000");
  const [newPayout, setNewPayout] = useState("2026-11-12");
  const [newDue, setNewDue] = useState("2026-11-19");
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
  const awaiting = state.advances.filter((a) => a.stage === "proposed" || a.stage === "prepared");
  const evidenceNeeded = state.advances.filter((a) => ["proposed", "prepared"].includes(a.stage) && review(state, a.id).some((c) => c.status !== "pass"));
  const upcoming = state.advances.filter((a) => a.stage === "approved" && a.payoutDate >= state.asOf && a.payoutDate <= new Date(Date.parse(state.asOf + "T00:00:00Z") + 86400000).toISOString().slice(0, 10));
  const overdue = state.advances.filter((a) => outstanding(a) > 0 && a.due < state.asOf);
  const partly = state.advances.filter((a) => a.repaid > 0 && outstanding(a) > 0);
  const openCases = state.advances.filter((a) => !["repaid", "declined", "written_off"].includes(a.stage));
  const queueGroups = [
    { id: "awaiting", label: "Awaiting review", rows: awaiting, type: "advance" },
    { id: "evidence", label: "Evidence requested", rows: evidenceNeeded, type: "advance" },
    { id: "cutoff", label: "Approaching cutoff (24 h)", rows: upcoming, type: "advance" },
    { id: "overdue", label: "Overdue repayment", rows: overdue, type: "advance" },
    { id: "partial", label: "Partial repayments", rows: partly, type: "advance" },
    { id: "unmatched", label: "Unmatched cash", rows: [], type: "receipt" },
    { id: "mine", label: "My open cases", rows: openCases.filter((a) => a.preparedBy === actors[role]), type: "advance" },
    { id: "all", label: "All open cases", rows: openCases, type: "advance" },
  ] as const;
  const q = queueQuery.trim().toLowerCase();
  const matches = (a: Advance) => [a.id, a.invoice, a.supplier, state.customers.find((c) => c.id === a.customerId)?.name ?? ""].some((value) => value.toLowerCase().includes(q));
  const filteredGroups = queueGroups.filter((g) => queueFilter === "all" || queueFilter === g.id);
  const importSample = () => {
    if (role !== "operator") { setWarning("Only the simulated operator can import sample cases."); return; }
    act(() => importBundledSample(state, role), "A new synthetic case was imported from the bundled sample CSV.");
  };
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
      <header className={styles.pilotHeader}>
        <div className={styles.pilotMain}>
          <div className={styles.brand}>
            <span className={styles.mark}>C</span><strong>Clearline</strong>
            <span className={styles.brandDivider} aria-hidden="true">│</span><span className={styles.productName}>FUNDING OPERATING DESK</span>
          </div>
          <button type="button" className={styles.menuButton} aria-label="Toggle navigation" onClick={() => setMobileNav(!mobileNav)}>☰</button>
          <nav className={`${styles.pilotNav} ${mobileNav ? styles.pilotNavOpen : ""}`} aria-label="Funding desk sections">
            {nav.map((item) => <button key={item.key} type="button" onClick={() => jump(item.key)}
              className={`${styles.navButton} ${panel === item.key ? styles.active : ""}`}
              aria-current={panel === item.key ? "page" : undefined}>{item.label}
              {item.key === "exceptions" && <span className={styles.count}>{alerts.length}</span>}</button>)}
          </nav>
        </div>
        <div className={styles.pilotIdentity}>
          <span className={styles.identityName}>{actors[role]}</span><span className={styles.roleChip}>{role}</span>
          <span className={styles.providerName}>Northline Payments (Synthetic)</span>
          <select aria-label="Demo role" value={role} onChange={(e) => { setRole(e.target.value as Role); setMessage(""); setWarning(""); }}>
            <option value="operator">Operator</option><option value="approver">Treasury approver</option><option value="viewer">Viewer</option>
          </select>
          <button type="button" className={styles.resetLink} onClick={() => { setState(initialDemo()); setPanel("overview"); setSelected("ADV-001"); setQueueFilter("all"); setQueueQuery(""); setMessage("Demo reset to the original fictional records."); setWarning(""); }}>Reset demo</button>
        </div>
      </header>
      <aside className={styles.sandboxBar} aria-label="Sandbox notice">Pilot workspace — sandbox payouts and approvals are simulated; no live payments.</aside>
      <main className={styles.main}>
        <div className={styles.body}>
          <div className={styles.pageHead}>
            <div>
              <h1>{panel === "overview" ? "Work queue" : panel === "newcase" ? "New advance case" : nav.find((n) => n.key === panel)?.label}</h1>
              <p>{panel === "overview" ? "What needs your attention, what is at risk, and what you can do next." :
                panel === "approvals" ? "Operator prepares the advance; a named treasury reviewer approves or declines." :
                panel === "exceptions" ? "Only the repayments and incoming receipts that need a response." :
                panel === "ledger" ? "Record supplier payouts and see how much the customer still owes." :
                panel === "evidence" ? "Every advance comes with the checks, decisions and repayment timeline." :
                panel === "newcase" ? "Create a synthetic advance to review. No money is moved." :
                "Review provider-defined cash classifications and export files."}</p>
            </div>
          </div>
          {warning && <div className={styles.error} role="alert">{warning}</div>}
          {message && <div className={styles.success} role="status">{message}</div>}
          <div className={styles.rolebar}>
            <span>AS OF {state.asOf} · {role.toUpperCase()} MODE · FICTIONAL DATA</span>
            <label className={styles.dateLabel}>Replay date <input aria-label="Replay date" type="date" min="2026-11-01" max="2026-11-30" value={state.asOf}
              onChange={(e) => act(() => setDate(state, e.target.value), "Replay date updated.")}/></label>
          </div>
          {panel === "overview" && <>
            <div className={styles.queueToolbar}>
              <div className={styles.searchGroup}>
                <input type="search" aria-label="Search cases" value={queueQuery} onChange={(e) => setQueueQuery(e.target.value)}
                  placeholder="Case id, customer, supplier or invoice" />
                <button type="button" className={styles.secondary} onClick={() => setQueueFilter("all")}>Search</button>
              </div>
              <div className={styles.queueActions}>
                <button type="button" className={styles.primary} onClick={() => jump("newcase")}>New case</button>
                <button type="button" className={styles.secondary} onClick={importSample}>Import sample CSV</button>
              </div>
            </div>
            <div className={styles.queueFilters} aria-label="Queue status filters">
              <button type="button" className={queueFilter === "all" ? styles.filterOn : ""} onClick={() => setQueueFilter("all")}>All groups</button>
              {queueGroups.map((group) => <button type="button" key={group.id}
                className={queueFilter === group.id ? styles.filterOn : ""}
                onClick={() => setQueueFilter(group.id)}>{group.label} {group.id === "unmatched" ? state.unmatched.length : group.rows.length}</button>)}
            </div>
            <div className={styles.queueList}>
              {filteredGroups.map((group) => {
                const entries = group.type === "advance" ? group.rows.filter(matches) : [];
                const receipts = group.type === "receipt" ? state.unmatched.filter((r) => !q || [r.id, r.customer, r.reference].some((v) => v.toLowerCase().includes(q))) : [];
                return <section key={group.id} className={styles.queueSection} aria-label={group.label}>
                  <div className={styles.queueSectionTitle}><strong>{group.label.toUpperCase()} <span>{entries.length + receipts.length}</span></strong>
                    {entries.length + receipts.length === 0 && <span className={styles.queueNothing}>Nothing here.</span>}</div>
                  {entries.map((a) => <button type="button" key={a.id} className={styles.queueRow} onClick={() => select(a.id, group.id === "overdue" || group.id === "partial" ? "ledger" : "approvals")}>
                    <span><strong>{a.id} · {state.customers.find((c) => c.id === a.customerId)?.name}</strong>
                      <small>{a.supplier} · {a.invoice} · {stageText[a.stage]}</small></span>
                    <span className={styles.queueMoney}>{money(group.id === "overdue" || group.id === "partial" ? outstanding(a) : a.amount)}</span>
                    <span className={styles.queueDue}>Due {a.due}</span><span className={styles.queueArrow}>Open →</span>
                  </button>)}
                  {receipts.map((r) => <div className={styles.queueRow} key={r.id}>
                    <span><strong>{r.id} · {r.customer}</strong><small>Reference: {r.reference} · needs manual matching</small></span>
                    <span className={styles.queueMoney}>{money(r.amount)}</span><span className={styles.queueDue}>Unassigned</span>
                    <button type="button" className={styles.linkButton} onClick={() => jump("exceptions")}>Inspect →</button>
                  </div>)}
                </section>;
              })}
            </div>
            <div className={styles.queueSummary}><span>Outstanding: <strong>{money(totals.owed)}</strong></span><span>Available cash: <strong>{money(freeCash(state))}</strong></span><span>Exceptions: <strong>{alerts.length}</strong></span></div>
            <button type="button" className={styles.linkButton} onClick={() => select("ADV-001")}>Open advance review →</button>
          </>}

          {panel === "newcase" && <section className={styles.card}>
            <div className={styles.cardTitle}><div><h2>Prepare a new funding case</h2><p>Only synthetic records are added to this local demonstration.</p></div></div>
            <form className={styles.newCaseForm} onSubmit={(e) => { e.preventDefault(); try {
              const next = createDemoAdvance(state, role, { customerId: newCustomer, supplier: newSupplier, invoice: newInvoice,
                amount: Number(newAmount), payoutDate: newPayout, due: newDue });
              setState(next); setSelected(next.advances[next.advances.length - 1].id); setPanel("approvals");
              setMessage("Synthetic case created. Run checks and prepare it for treasury review."); setWarning("");
            } catch (err) { setWarning(err instanceof Error ? err.message : "Cannot create the case."); setMessage(""); } }}>
              <label>Customer<select value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)}>{state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Supplier<input aria-label="New case supplier" value={newSupplier} maxLength={100} onChange={(e) => setNewSupplier(e.target.value)} placeholder="Supplier name" required/></label>
              <label>Invoice reference<input aria-label="New case invoice reference" value={newInvoice} maxLength={80} onChange={(e) => setNewInvoice(e.target.value)} placeholder="INV-2026-001" required/></label>
              <label>Amount (SGD)<input aria-label="New case amount" type="number" value={newAmount} min="1" step="1" onChange={(e) => setNewAmount(e.target.value)} required/></label>
              <label>Payout date<input aria-label="New case payout date" type="date" min="2026-11-01" max="2026-11-30" value={newPayout} onChange={(e) => setNewPayout(e.target.value)} required/></label>
              <label>Due date<input aria-label="New case due date" type="date" min="2026-11-01" max="2026-11-30" value={newDue} onChange={(e) => setNewDue(e.target.value)} required/></label>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondary} onClick={() => jump("overview")}>Cancel</button>
                <button type="submit" className={styles.primary} disabled={role !== "operator"}>Create synthetic case</button>
              </div>
              <p className={styles.fine}>No connected bank accounts, no credit decisions, no real payouts.</p>
            </form>
          </section>}

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
          <footer className={styles.footer}><span>Clearline funding operating desk. Separate from live production. Sandbox payouts are simulated; no live payments.</span><span>Environment: mentor demo</span></footer>
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
