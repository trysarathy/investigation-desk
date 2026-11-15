"use client";
import Link from "../Link";
import { Fragment, useEffect, useState } from "react";
import { HUMAN_LABELS, type CurrencyCode, type JournalProposalRow, type JournalProposalStatus } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ActionButton, gateOf, useRun, useSettled, type Gate } from "../Action";
import { label } from "../human";
import { SIMULATED_ROLE_NOTE } from "../nav";
import { FilterBar, SearchFilter, SelectFilter, matchesText, useQuery, useSearchText } from "../filters";
import { Btn, Chip, Code, Dl, Empty, Field, Metric, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";
import { Balanced, EvidenceLinks, LinesAccounts, LinesAmounts, POSTING_NOTE, ProposalStatus, SupplierPaid, exact, notProposedFor, useBridge } from "../accounting";

const STATUSES = Object.keys(HUMAN_LABELS.journalProposalStatus) as JournalProposalStatus[];
/** A reference the engine accepts, used only for the dry run while the field is still empty. */
const DRY_RUN_REF = "DRY-RUN-REF";

/** The overview: period, mapping status and counts per status. Shared with the other Accounting tabs. */
export function AccountingOverview() {
  const v = useBridge();
  const { actorName } = useWorkspace();
  const open = v.periods.filter((p) => p.status === "open");
  const count = (s: JournalProposalStatus) => v.proposals.filter((p) => p.status === s).length;
  return (
    <Panel title="Overview" id="overview">
      <div className={ui.panelBody}>
        <Dl items={[
          ["Open period", open.length === 0
            ? <span data-testid="overview-period">No open period. <Link href="/clearline/accounting/setup#periods">Open one</Link> before entries can be proposed.</span>
            : <span data-testid="overview-period">{open.map((p) => <span key={p.id} style={{ display: "block" }}><strong>{p.name}</strong> <span className="mono">{p.from}</span> to <span className="mono">{p.to}</span> (end exclusive) · {p.statusLabel}</span>)}</span>],
          ["Account mapping", <span key="m" data-testid="overview-mapping" data-unmapped={v.unmappedKeys.length}>
            {!v.mapping ? <>No mapping yet. <Link href="/clearline/accounting/setup#mapping">Map your accounts</Link>.</>
              : v.unmappedKeys.length === 0 ? <>Revision {v.mapping.revision} · every account the entries use is mapped<span className={ui.sub}>by {actorName(v.mapping.updatedBy)}, {fmtTime(v.mapping.updatedAt)}</span></>
                : <><Chip tone="bad">Export blocked</Chip> {v.unmappedKeys.length} account role{v.unmappedKeys.length === 1 ? "" : "s"} not mapped: {v.unmappedKeys.map((k) => <Code key={k}>{k}</Code>)}
                  <span className={ui.sub} data-testid="overview-mapping-reason">{label("bridgeReason", "UNMAPPED_ACCOUNT_ROLE")} <code className={ui.apiValue}>UNMAPPED_ACCOUNT_ROLE</code> · <Link href="/clearline/accounting/setup#mapping">Edit the mapping</Link></span></>}
          </span>],
          ["Supported by evidence, not yet proposed", <span key="p" data-testid="overview-pending">{v.pending.length}</span>],
        ]} />
      </div>
      <div className={ui.panelBody} style={{ paddingTop: 0 }}>
        <div className={ui.metrics} style={{ marginBottom: 0 }} data-testid="overview-counts">
          {(["proposed", "approved", "exported", "posted"] as const).map((s) => (
            <Metric key={s} href={`/clearline/accounting?status=${s}#entries`} label={label("journalProposalStatus", s)} value={<span data-testid={`count-${s}`}>{count(s)}</span>} note={`Show ${s} entries`} />
          ))}
        </div>
        <p className={ui.hint} style={{ margin: "8px 0 0" }}>Also {count("rejected")} rejected and {count("superseded")} superseded. {POSTING_NOTE}</p>
      </div>
    </Panel>
  );
}

/** Review one proposed entry: approve (a different person), reject with a reason, record a posting. */
function ProposalReview({ p, id }: { p: JournalProposalRow; id: string }) {
  const { ws, preview, actors, actorId, actorName } = useWorkspace();
  const { msg, run } = useRun();
  const [approver, setApprover] = useState(() => (actors.find((a) => a.role === "approver" && a.id !== p.createdBy) ?? actors[0]).id);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const tNote = useSettled(note), tReason = useSettled(reason), tRef = useSettled(ref);

  const approveAction = { type: "approve_journal_proposal", proposalId: p.id, ...(tNote.trim() ? { note: tNote } : {}) } as const;
  const gApprove = gateOf(preview(approveAction, { actorId: approver }), ws);
  const gRejectEngine = gateOf(preview({ type: "reject_journal_proposal", proposalId: p.id, reason: tReason.trim() ? tReason : "Dry run" }), ws);
  const gReject: Gate = gRejectEngine.ok && !reason.trim() ? { ok: false, reason: "Give a reason for rejecting first." } : gRejectEngine;
  const gPostEngine = gateOf(preview({ type: "record_posting", proposalId: p.id, externalReference: tRef.trim() ? tRef.trim() : DRY_RUN_REF }), ws);
  const gPost: Gate = gPostEngine.ok && !ref.trim() ? { ok: false, reason: "Type the journal reference your ledger gave this entry first." } : gPostEngine;

  return (
    <div id={id} className={ui.panelBody} data-testid="proposal-review" data-proposal={p.id}>
      <p style={{ marginTop: 0 }} data-testid="proposal-narrative">{p.narrative}</p>
      <Dl items={[
        ["Rule", <><span>{p.ruleLabel}</span> <Code>{p.ruleCode}</Code></>],
        ["Entry date", <span className="mono" key="d">{p.entryDate}{p.postingDate !== p.entryDate ? ` → posting date ${p.postingDate}` : ""}</span>],
        ["Proposed by", <>{actorName(p.createdBy)}<span className={ui.sub}>{fmtTime(p.createdAt)}</span></>],
        ["Evidence ids", <span className="mono" key="e">{[...new Set(p.lines.flatMap((l) => l.evidenceIds))].join(", ")}</span>],
      ]} />
      {p.priorPeriodItem && <Notice info>Prior-period item: {p.priorPeriodItem.reason}</Notice>}
      {p.supersession && <Notice>{label("supersession", p.supersession.code)}: {p.supersession.reason}{p.supersession.replacedBy ? ` Replaced by ${p.supersession.replacedBy}.` : ""}</Notice>}
      {p.evidenceChange && <Notice>{label("supersession", p.evidenceChange.code)} after export: {p.evidenceChange.reason} The entry is unchanged; a reversal is proposed next time entries are proposed.</Notice>}
      {!p.current && !p.supersession && (p.status === "proposed" || p.status === "approved") && <Notice>The evidence no longer gives exactly this entry; the engine supersedes it on the next action.</Notice>}
      <Status msg={msg} />

      <div className={ui.actionGroup}>
        <h4 className={ui.eyebrow}>Approve</h4>
        <p className={ui.hint} style={{ marginTop: 0 }}>Proposed by <strong>{actorName(p.createdBy)}</strong> (maker). The approver must be a different person with the approver role. Approving does not post anything.</p>
        <form className={ui.formRow} onSubmit={(e) => { e.preventDefault(); run("Approve entry", { type: "approve_journal_proposal", proposalId: p.id, ...(note.trim() ? { note } : {}) }, { actorId: approver, onOk: () => setNote("") }); }}>
          <Field label="Approver" hint={SIMULATED_ROLE_NOTE}>
            <select id={`${id}-approver`} value={approver} onChange={(e) => setApprover(e.target.value)} data-testid="approver-select">
              {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Approval note (optional)"><input id={`${id}-approve-note`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div data-testid="approve-gate"><ActionButton type="submit" size="small" gate={gApprove} name="Approve entry">Approve entry</ActionButton></div>
        </form>
      </div>

      <div className={ui.actionGroup}>
        <h4 className={ui.eyebrow}>Reject</h4>
        <form className={ui.formRow} onSubmit={(e) => { e.preventDefault(); run("Reject entry", { type: "reject_journal_proposal", proposalId: p.id, reason }, { onOk: () => setReason("") }); }}>
          <Field label="Reason for rejecting" hint={`Acting as ${actorName(actorId)} (change it at the top of the page).`}><input id={`${id}-reject-reason`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div data-testid="reject-gate"><ActionButton type="submit" size="small" gate={gReject} name="Reject entry">Reject entry</ActionButton></div>
        </form>
      </div>

      <div className={ui.actionGroup}>
        <h4 className={ui.eyebrow}>Record posting</h4>
        <p className={ui.hint} style={{ marginTop: 0 }} data-testid="posting-note"><strong>{POSTING_NOTE}</strong> After you import the exported file into your own ledger, type the journal reference your ledger gave this entry. The record is marked simulated.</p>
        <form className={ui.formRow} onSubmit={(e) => { e.preventDefault(); run("Record posting", { type: "record_posting", proposalId: p.id, externalReference: ref.trim() }, { onOk: () => setRef("") }); }}>
          <Field label="External ledger reference" hint="2–64 letters, digits or . _ - / # : (e.g. JE-2026-11-0042)"><input id={`${id}-ext-ref`} value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" /></Field>
          <div data-testid="posting-gate"><ActionButton type="submit" size="small" gate={gPost} name="Record posting">Record posting</ActionButton></div>
        </form>
        {p.posting && <p className={ui.hint} data-testid="posting-recorded">Recorded by {actorName(p.posting.recordedBy)} at {fmtTime(p.posting.recordedAt)}: external reference <span className="mono">{p.posting.externalReference}</span> (simulated). Clearline posted nothing.</p>}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary>Entry history ({p.history.length})</summary>
        <ol className={ui.timeline}>{p.history.map((h, i) => <li key={i} className={ui.tlItem}><span className={ui.tlTime}>{fmtTime(h.at)}</span><div><p className={ui.tlTitle}>{label("auditAction", h.action)}</p><p className={ui.tlMeta}>{h.detail} · {actorName(h.actorId)}</p></div></li>)}</ol>
      </details>
    </div>
  );
}

export default function Accounting() {
  const { ws, preview, actorName, actorId } = useWorkspace();
  const v = useBridge();
  const { msg, run } = useRun();
  const { get } = useQuery();
  const status = get("status");
  const payment = get("payment");
  const [text, setText, commitText, clearText] = useSearchText();
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  // A link to #jp_… opens that entry's review.
  useEffect(() => {
    const h = decodeURIComponent(window.location.hash.slice(1));
    if (h.startsWith("jp_")) setOpenRows((s) => new Set(s).add(h));
  }, []);
  const toggle = (id: string) => setOpenRows((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const intentOf = (id?: string) => (id ? ws.intents.find((i) => i.id === id) : undefined);
  const rows = v.proposals.filter((p) =>
    (!status || p.status === status) && (!payment || p.intentId === payment) &&
    matchesText(text, p.id, p.ruleCode, p.ruleLabel, p.narrative, p.intentId, intentOf(p.intentId)?.internalReference, p.posting?.externalReference,
      ...p.accounts.flatMap((a) => [a.accountCode, a.accountName])));
  const payments = [...new Set(v.proposals.map((p) => p.intentId).filter((x): x is string => !!x))].map((id) => ({ value: id, label: `${intentOf(id)?.internalReference ?? id} (${id})` }));
  const filters = [status && `status “${label("journalProposalStatus", status)}”`, payment && `payment ${payment}`, text.trim() && `text “${text.trim()}”`].filter(Boolean);
  const notProposed = payment ? notProposedFor(v, ws, payment) : v.notProposed;

  const propose = preview({ type: "propose_journal_entries" });
  const gPropose: Gate = propose.ok && propose.value.outcome === "no_new_proposals" ? { ok: false, reason: `${label("actionOutcome", "no_new_proposals")}.`, code: "no_new_proposals" } : gateOf(propose, ws);

  return (
    <>
      <PageHead eyebrow="Operations" title="Accounting"
        lede={<>Journal entries proposed from recorded evidence, for a second person to approve and export to your accountant.</>} />
      <Notice info><span data-testid="bridge-disclaimer">{v.disclaimer}</span></Notice>
      <AccountingOverview />

      <Panel title="Propose entries from evidence" id="propose">
        <div className={ui.panelBody}>
          <p style={{ marginTop: 0 }}>The engine proposes a balanced entry only from a bank statement line or a final chain transfer matched by a trusted reference. A provider&apos;s report alone never gives an entry. Acting as <strong>{actorName(actorId)}</strong>.</p>
          {v.pending.length > 0 && (
            <ul data-testid="pending-list" style={{ margin: "0 0 10px", paddingLeft: 18 }}>
              {v.pending.map((x) => <li key={x.sourceKey}>{x.ruleLabel} · <span className="mono">{x.entryDate}</span>{x.reason ? <> — {x.reason}</> : x.priorPeriodItem ? <> — prior-period item, posting date <span className="mono">{x.postingDate}</span></> : null}</li>)}
            </ul>
          )}
          <Status msg={msg} />
          <div data-testid="propose-gate"><ActionButton gate={gPropose} name="Propose entries" onClick={() => run("Propose entries", { type: "propose_journal_entries" })}>Propose entries</ActionButton></div>
        </div>
      </Panel>

      <FilterBar label="Filter journal entries" onClear={clearText} clear={filters.length ? ["status", "payment", "q"] : undefined}
        summary={<>Showing {rows.length} of {v.proposals.length} entries{filters.length ? <> · filtered by {filters.join(", ")}</> : null}.</>}>
        <SearchFilter label="Search" placeholder="Entry, payment, account, reference…" value={text} onChange={setText} onCommit={commitText} />
        <SelectFilter param="status" label="Status" options={STATUSES.map((s) => ({ value: s, label: label("journalProposalStatus", s) }))} />
        <SelectFilter param="payment" label="Payment" options={payments} />
      </FilterBar>

      <Panel title={`Proposed entries (${rows.length})`} id="entries">
        {rows.length === 0 ? (v.proposals.length === 0
          ? <Empty>No journal entries yet. Use Propose entries above once a period is open and evidence is recorded.</Empty>
          : <Empty>No entries match these filters. Clear the filters to see all {v.proposals.length}.</Empty>) : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Proposed journal entries table">
            <table className={`${ui.table} ${ui.stack} ${ui.jTable}`}>
              <thead><tr><th>Date</th><th>Entry</th><th>Accounts</th><th className={ui.r}>Debit</th><th className={ui.r}>Credit</th><th>Currency</th><th>Balanced</th><th>Status</th><th>Evidence</th></tr></thead>
              <tbody>{rows.map((p) => {
                const isOpen = openRows.has(p.id);
                return (
                  <Fragment key={p.id}>
                    <tr id={p.id} data-proposal={p.id} data-rule={p.ruleCode}>
                      <td data-label="Date" className={ui.jNum}>{p.postingDate}{p.priorPeriodItem && <span className={ui.sub}>Prior-period item (dated {p.priorPeriodItem.originalDate})</span>}</td>
                      <td data-label="Entry" className={ui.jEntry}>{p.ruleLabel}<span className={ui.sub}><span className="mono">{p.id}</span> · <Code>{p.ruleCode}</Code></span><SupplierPaid p={p} /></td>
                      <td data-label="Accounts" className={ui.jAccounts}><LinesAccounts p={p} /></td>
                      <td data-label="Debit" className={`${ui.r} ${ui.jNum}`}><LinesAmounts p={p} side="debit" /></td>
                      <td data-label="Credit" className={`${ui.r} ${ui.jNum}`}><LinesAmounts p={p} side="credit" /></td>
                      <td data-label="Currency" className="mono" data-testid="entry-currency">{p.currency}</td>
                      <td data-label="Balanced"><Balanced p={p} /></td>
                      <td data-label="Status" className={ui.jStatus}><ProposalStatus p={p} />
                        {p.approval && <span className={ui.sub}>Approved by {actorName(p.approval.by)}</span>}
                        {p.rejection && <span className={ui.sub}>Rejected by {actorName(p.rejection.by)}: {p.rejection.reason}</span>}
                        {p.export && <span className={ui.sub}>In export <span className="mono">{p.export.exportId}</span></span>}
                        {p.posting && <span className={ui.sub}>Reference <span className="mono">{p.posting.externalReference}</span> — recorded by a person (simulated)</span>}
                        {!p.current && (p.status === "proposed" || p.status === "approved") && <span className={ui.sub}>Evidence changed</span>}
                        <span style={{ display: "block", marginTop: 6 }}><Btn size="small" aria-expanded={isOpen} aria-controls={`review-${p.id}`} onClick={() => toggle(p.id)}>{isOpen ? "Hide review" : "Review"}<span className={ui.srOnly}> entry {p.id}</span></Btn></span>
                      </td>
                      <td data-label="Evidence" className={ui.jEvidence}><EvidenceLinks p={p} ws={ws} /></td>
                    </tr>
                    {isOpen && <tr className={ui.reviewRow}><td colSpan={9} data-label="Review"><ProposalReview p={p} id={`review-${p.id}`} /></td></tr>}
                  </Fragment>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={`Not proposed, and why (${notProposed.length})`} id="not-proposed">
        {notProposed.length === 0 ? <Empty>Nothing was held back.</Empty> : (
          <ul className={ui.actionList} data-testid="not-proposed-list">
            {notProposed.map((n, i) => (
              <li key={i} className={ui.actionRow} data-code={n.code}>
                <div>
                  <p><Chip tone="neutral">No entry</Chip> <strong>{label("notProposed", n.code)}</strong></p>
                  <p className={ui.hint}>{n.text.startsWith(label("notProposed", n.code)) ? n.text.slice(label("notProposed", n.code).length).replace(/^\.\s*/, "") : n.text}</p>
                  <p className={ui.sub}><Code>{n.code}</Code> · <span className="mono">{n.refs.join(", ")}</span></p>
                </div>
                <div className={ui.r}>
                  {n.amount && <p className="mono" data-testid="not-proposed-amount">{n.amount.currency} {exact(n.amount.amountMinor, n.amount.currency as CurrencyCode)}</p>}
                  {n.exceptionIds.map((x) => <p key={x}><Link href={`/clearline/exceptions?view=all#${x}`}>Open exception {x}</Link></p>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
