"use client";
import Link from "../Link";
import { useEffect, useMemo, useState } from "react";
import { NON_BANK_ROLES, type AccountMappingEntry } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ActionButton, gateOf, useRun, useSettled, type Gate } from "../Action";
import { ActorSelect } from "../ActorSelect";
import { label } from "../human";
import { Btn, Chip, Empty, Field, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";
import { POSTING_NOTE, useBridge } from "../accounting";
import { AccountingOverview } from "./Accounting";

/** Unsaved mapping edits are kept for this tab only (a per-viewer convenience), so a reload keeps them. */
const DRAFT_KEY = "clearline.console.mapping-draft.v1";
type Row = { accountKey: string; accountCode: string; accountName: string };
type Draft = { base: number; rows: Row[] };

function readDraft(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return typeof d?.base === "number" && Array.isArray(d.rows) ? d : null;
  } catch { return null; }
}
function writeDraft(d: Draft | null) {
  try { if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked: the draft lives in memory only */ }
}

/** First day of the month after `date` (YYYY-MM-DD). */
function nextMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function Periods() {
  const { ws, preview, actorName, actorId } = useWorkspace();
  const v = useBridge();
  const { msg, run } = useRun();
  const last = [...v.periods].sort((a, b) => (a.to < b.to ? -1 : 1)).at(-1);
  const defFrom = last ? last.to : `${ws.asOf.slice(0, 7)}-01`;
  const [name, setName] = useState(defFrom.slice(0, 7));
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(nextMonth(defFrom));
  const tName = useSettled(name), tFrom = useSettled(from), tTo = useSettled(to);
  const gOpen = gateOf(preview({ type: "open_accounting_period", name: tName, from: tFrom, to: tTo }), ws, !name.trim() && "Name the period first.");
  return (
    <Panel title="Accounting periods" id="periods">
      <div className={ui.panelBody}>
        <p style={{ marginTop: 0 }}>Periods are calendar dates in the organisation&apos;s time zone ({ws.organization.timezone}), from the first day up to but not including the end date. Closing a period needs the approver role and no proposed or approved entries left in it. A closed period cannot be reopened; later items dated in it move to the next open period as prior-period items.</p>
        <ActorSelect id="cl-actor-periods" />
        <Status msg={msg} />
      </div>
      {v.periods.length === 0 ? <Empty>No accounting periods yet.</Empty> : (
        <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Accounting periods table">
          <table className={`${ui.table} ${ui.stack}`}>
            <thead><tr><th>Period</th><th>Dates</th><th>Status</th><th>Entries</th><th>Opened / closed</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
            <tbody>{v.periods.map((p) => {
              const inPeriod = v.proposals.filter((x) => x.periodId === p.id);
              const gClose = gateOf(preview({ type: "close_accounting_period", periodId: p.id }), ws);
              const prop = preview({ type: "propose_journal_entries", periodId: p.id });
              const gPropose: Gate = prop.ok && prop.value.outcome === "no_new_proposals" ? { ok: false, reason: `${label("actionOutcome", "no_new_proposals")}.`, code: "no_new_proposals" } : gateOf(prop, ws);
              return (
                <tr key={p.id} id={p.id} data-period={p.name}>
                  <td data-label="Period"><strong>{p.name}</strong><span className={ui.sub + " mono"}>{p.id}</span></td>
                  <td data-label="Dates" className={ui.num}><span className="mono">{p.from}</span> to <span className="mono">{p.to}</span><span className={ui.sub}>end exclusive</span></td>
                  <td data-label="Status" data-testid="period-status"><Chip tone={p.status === "open" ? "info" : "neutral"}>{p.statusLabel}</Chip> <span className={ui.apiValue}>{p.status}</span></td>
                  <td data-label="Entries" className={ui.num}>{inPeriod.length}<span className={ui.sub}>{inPeriod.filter((x) => x.status === "proposed" || x.status === "approved").length} still proposed or approved</span></td>
                  <td data-label="Opened / closed">{actorName(p.openedBy)}<span className={ui.sub}>{fmtTime(p.openedAt)}</span>{p.closedBy && <span className={ui.sub}>Closed by {actorName(p.closedBy)}, {fmtTime(p.closedAt)}</span>}</td>
                  <td data-label="Actions">
                    <div className={ui.actions} style={{ alignItems: "flex-start" }}>
                      <div data-testid="close-gate"><ActionButton size="small" gate={gClose} name="Close period" onClick={() => run(`Close period ${p.name}`, { type: "close_accounting_period", periodId: p.id })}>Close period<span className={ui.srOnly}> {p.name}</span></ActionButton></div>
                      <div data-testid="propose-period-gate"><ActionButton size="small" gate={gPropose} name="Propose entries in this period" onClick={() => run(`Propose entries in ${p.name}`, { type: "propose_journal_entries", periodId: p.id })}>Propose entries in this period<span className={ui.srOnly}> {p.name}</span></ActionButton></div>
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <div className={ui.panelBody} style={{ borderTop: "1px solid var(--cl-line)" }}>
        <h3 className={ui.eyebrow}>Open a period</h3>
        <form className={ui.formRow} onSubmit={(e) => { e.preventDefault(); run(`Open period ${name}`, { type: "open_accounting_period", name, from, to }); }} aria-label="Open an accounting period">
          <Field label="Name"><input id="period-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="From (first day)"><input id="period-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To (not included)"><input id="period-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div data-testid="open-period-gate"><ActionButton type="submit" size="small" gate={gOpen} name="Open period">Open period</ActionButton></div>
        </form>
        <p className={ui.hint}>Acting as {actorName(actorId)}.</p>
      </div>
    </Panel>
  );
}

function MappingEditor() {
  const { ws, preview, actorName } = useWorkspace();
  const v = useBridge();
  const { msg, setMsg, run } = useRun();
  const current = v.mapping;
  const revision = current?.revision ?? 0;
  // Every account key the console knows: each statement account, every non-bank role and anything already mapped or used.
  const keys = useMemo(() => {
    const used = v.proposals.flatMap((p) => p.lines.map((l) => l.accountKey));
    const banks = ws.statementLines.filter((l) => l.source === "bank_statement").map((l) => `bank:${l.accountRef}`);
    const all = [...new Set([...(current?.entries ?? []).map((e) => e.accountKey), ...banks, ...used, ...NON_BANK_ROLES])];
    return all.sort((a, b) => (a.startsWith("bank:") === b.startsWith("bank:") ? a.localeCompare(b) : a.startsWith("bank:") ? -1 : 1));
  }, [ws, v, current]);
  const fromMapping = (): Row[] => keys.map((k) => { const e = current?.entries.find((x) => x.accountKey === k); return { accountKey: k, accountCode: e?.accountCode ?? "", accountName: e?.accountName ?? "" }; });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => { const d = readDraft(); if (d) { setDraft(d); setRestored(true); } }, []);
  // Keys that appeared since the draft started (e.g. a new statement account) are added to it, blank.
  const rows: Row[] = draft ? [...draft.rows, ...keys.filter((k) => !draft.rows.some((r) => r.accountKey === k)).map((k) => ({ accountKey: k, accountCode: "", accountName: "" }))] : fromMapping();
  const edit = (i: number, field: "accountCode" | "accountName", value: string) => {
    const next = { base: draft?.base ?? revision, rows: rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)) };
    setDraft(next);
    writeDraft(next);
  };
  const discard = () => { setDraft(null); writeDraft(null); setRestored(false); setMsg(null); };
  const entries: AccountMappingEntry[] = rows.filter((r) => r.accountCode.trim() || r.accountName.trim()).map((r) => ({ accountKey: r.accountKey, accountCode: r.accountCode.trim(), accountName: r.accountName.trim() }));
  const settled = useSettled(JSON.stringify(entries));
  const base = draft?.base ?? revision;
  const action = { type: "set_account_mapping", entries: JSON.parse(settled) as AccountMappingEntry[], expectedRevision: base } as const;
  const dry = preview(action);
  const conflict = !dry.ok && dry.error.message.startsWith("MAPPING_REVISION_CONFLICT");
  const gSave: Gate = !draft ? { ok: false, reason: "No changes to save." } : gateOf(dry, ws);
  const used = new Set(v.proposals.filter((p) => p.status === "proposed" || p.status === "approved").flatMap((p) => p.lines.map((l) => l.accountKey)));
  const save = () => run(`Save account mapping (revision ${base} → ${base + 1})`, { type: "set_account_mapping", entries, expectedRevision: base }, { onOk: () => { setDraft(null); writeDraft(null); setRestored(false); } });
  return (
    <Panel title="Chart-of-accounts mapping" id="mapping">
      <div className={ui.panelBody}>
        <p style={{ marginTop: 0 }}>Map each Clearline account role to an account code in your own chart of accounts (fictional codes in the sandbox). Each role needs its own code. A role an entry uses but that is not mapped blocks the journal export. Leave both fields empty to leave a role unmapped.</p>
        <p className={ui.hint} data-testid="mapping-revision">{current ? <>Saved revision <strong>{current.revision}</strong> by {actorName(current.updatedBy)}, {fmtTime(current.updatedAt)}.</> : "No mapping saved yet."}{draft && <> Editing from revision <strong>{draft.base}</strong>; not saved yet.</>}</p>
        {restored && draft && <Notice info>Your unsaved changes from this tab were kept (based on revision {draft.base}).</Notice>}
        {conflict && draft && (
          <div className={ui.notice} role="alert" data-testid="mapping-conflict">
            <p style={{ margin: "0 0 6px" }}><strong>The mapping changed since you started editing.</strong> {label("bridgeReason", "MAPPING_REVISION_CONFLICT")} <span className="mono">{dry.ok ? "" : dry.error.message}</span></p>
            <Btn size="small" onClick={discard}>Discard my changes and load revision {revision}</Btn>
          </div>
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} aria-label="Edit account mapping">
        <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Account mapping table">
          <table className={`${ui.table} ${ui.stack}`}>
            <thead><tr><th>Account role</th><th>Account code</th><th>Account name</th><th>State</th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const role = r.accountKey.startsWith("bank:") ? `${label("accountRole", "bank")} ${r.accountKey.slice(5)}` : label("accountRole", r.accountKey);
              const mapped = !!(r.accountCode.trim() || r.accountName.trim());
              return (
                <tr key={r.accountKey} data-account-key={r.accountKey}>
                  <td data-label="Account role">{role}<span className={ui.sub + " mono"}>{r.accountKey}</span></td>
                  <td data-label="Account code"><label className={ui.field}><span className={ui.srOnly}>Account code for {role}</span><input value={r.accountCode} onChange={(e) => edit(i, "accountCode", e.target.value)} autoComplete="off" /></label></td>
                  <td data-label="Account name"><label className={ui.field}><span className={ui.srOnly}>Account name for {role}</span><input value={r.accountName} onChange={(e) => edit(i, "accountName", e.target.value)} autoComplete="off" /></label></td>
                  <td data-label="State">{mapped ? <Chip tone="info">Mapped</Chip> : used.has(r.accountKey) ? <Chip tone="bad">Not mapped — blocks export</Chip> : <Chip tone="neutral">Not mapped</Chip>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className={ui.panelBody}>
          <Status msg={msg} />
          <div className={ui.actions} style={{ alignItems: "flex-start" }}>
            <div data-testid="mapping-save-gate"><ActionButton type="submit" size="small" gate={gSave} name="Save mapping">Save mapping</ActionButton></div>
            {draft && !conflict && <Btn size="small" onClick={discard}>Discard changes</Btn>}
          </div>
        </div>
      </form>
    </Panel>
  );
}

export default function AccountingSetup() {
  return (
    <>
      <PageHead eyebrow="Operations" title="Accounting periods and mapping"
        lede={<>Set up the periods entries are dated in, and how Clearline&apos;s account roles map to your chart of accounts. {POSTING_NOTE}</>} />
      <AccountingOverview />
      <Periods />
      <MappingEditor />
      <p className={ui.hint}>Every change here is recorded in the <Link href="/clearline/reports/audit?entity=account_mapping">audit history</Link>.</p>
    </>
  );
}
