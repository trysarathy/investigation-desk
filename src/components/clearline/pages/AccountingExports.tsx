"use client";
import Link from "../Link";
import { useState } from "react";
import {
  ACCOUNTING_EXPORT_MARKING, accountingExportToJson, buildJournalExport, buildReconciliationExport, journalExportToCsv, reconciliationExportToCsv,
  type ActionResult, type ExportEvidenceClass, type Workspace,
} from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { ActionButton, gateOf, useSettled, type Gate, type Msg } from "../Action";
import { describeError, label } from "../human";
import { download } from "../download";
import { Btn, Chip, Empty, Field, PageHead, Panel, Status, fmtTime, ui } from "../ui";
import { POSTING_NOTE, useBridge } from "../accounting";
import { AccountingOverview } from "./Accounting";

const CLASSES: ExportEvidenceClass[] = ["evidenced", "provider_reported_only", "unresolved"];
const refused = (what: string, r: ActionResult, ws: Workspace): Msg => (r.ok ? null : { text: `${what} — not applied. ${describeError(r.error, ws).text} (${r.error.code})`, error: true });

function saveJournal(ws: Workspace, exportId: string, fmt: "csv" | "json"): string | null {
  const doc = buildJournalExport(ws, { exportId });
  if (!doc.ok) return describeError(doc.error, ws).text;
  download(`${doc.value.documentId}.${fmt}`, fmt === "csv" ? journalExportToCsv(doc.value) : accountingExportToJson(doc.value), fmt === "csv" ? "text/csv" : "application/json");
  return null;
}

function JournalExport() {
  const { ws, preview, dispatch, actorName, actorId } = useWorkspace();
  const v = useBridge();
  const [msg, setMsg] = useState<Msg>(null);
  const exportPeriod = (periodId: string, name: string) => {
    const r = dispatch({ type: "export_journal", periodId });
    if (!r.ok) { setMsg(refused(`Journal export for ${name}`, r, ws)); return; }
    const rec = r.value.workspace.accounting?.exports.find((x) => x.id === r.value.createdIds[0]);
    setMsg({ text: `Journal export for ${name} — recorded by the engine (${label("actionOutcome", r.value.outcome)}): ${rec?.documentId ?? r.value.createdIds[0]}, ${rec?.proposalIds?.length ?? 0} entries. Download the file below. Nothing was posted.` });
  };
  return (
    <Panel title="Journal export (generic CSV journal import)" id="journal">
      <div className={ui.panelBody}>
        <p style={{ marginTop: 0 }}>Exports a period&apos;s <strong>approved</strong> entries as a file your accountant imports into your own ledger. The entries become “exported”; they are posted only when a person records the posting with the ledger&apos;s reference. Acting as <strong>{actorName(actorId)}</strong>.</p>
        <Status msg={msg} />
        {v.periods.length === 0 ? <Empty>No accounting periods yet. <Link href="/clearline/accounting/setup#periods">Open a period</Link>.</Empty> : (
          <ul className={ui.actionList}>
            {v.periods.map((p) => {
              const approved = v.proposals.filter((x) => x.periodId === p.id && x.status === "approved").length;
              const g: Gate = gateOf(preview({ type: "export_journal", periodId: p.id }), ws);
              return (
                <li key={p.id} className={ui.actionRow} data-period={p.name}>
                  <p><strong>{p.name}</strong> · {p.statusLabel} · <span data-testid="approved-count">{approved}</span> approved entr{approved === 1 ? "y" : "ies"} ready to export</p>
                  <div data-testid="export-journal-gate"><ActionButton size="small" gate={g} name="Export journal" onClick={() => exportPeriod(p.id, p.name)}>Export journal<span className={ui.srOnly}> for {p.name}</span></ActionButton></div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function ReconciliationExport() {
  const { ws, preview, dispatch, actorName, actorId } = useWorkspace();
  const v = useBridge();
  const open = v.periods.find((p) => p.status === "open") ?? v.periods[0];
  const [from, setFrom] = useState(open?.from ?? `${ws.asOf.slice(0, 7)}-01`);
  const [to, setTo] = useState(open?.to ?? ws.asOf.slice(0, 10));
  const tFrom = useSettled(from), tTo = useSettled(to);
  const [msg, setMsg] = useState<Msg>(null);
  const doc = buildReconciliationExport(ws, { from: tFrom, to: tTo });
  const g = gateOf(preview({ type: "record_reconciliation_export", from: tFrom, to: tTo }), ws);
  const save = (fmt: "csv" | "json") => {
    // The file is built from the workspace the engine records it against; the record keeps its id and hash.
    const before = ws;
    const built = buildReconciliationExport(before, { from, to });
    const r = dispatch({ type: "record_reconciliation_export", from, to });
    if (!r.ok || !built.ok) { setMsg(r.ok ? { text: `Reconciliation export — not built. ${built.ok ? "" : describeError(built.error, ws).text}`, error: true } : refused("Reconciliation export", r, ws)); return; }
    const rec = r.value.workspace.accounting?.exports.find((x) => x.id === r.value.createdIds[0]);
    download(`${built.value.documentId}.${fmt}`, fmt === "csv" ? reconciliationExportToCsv(built.value) : accountingExportToJson(built.value), fmt === "csv" ? "text/csv" : "application/json");
    setMsg({ text: `Reconciliation export ${built.value.documentId} (.${fmt}) — recorded by the engine as ${rec?.id ?? r.value.createdIds[0]}${rec && rec.sha256 !== built.value.sha256 ? " (warning: the recorded hash differs from the file)" : ""}; ${built.value.rows.length} rows, downloaded in your browser.` });
  };
  return (
    <Panel title="Reconciliation export" id="reconciliation-export">
      <div className={ui.panelBody}>
        <p style={{ marginTop: 0 }}>One row per settled, returned or unresolved money movement in the date range, with its evidence class, references and the journal entries that rest on it. Each download is recorded in the audit history. Acting as <strong>{actorName(actorId)}</strong>.</p>
        <form className={ui.formRow} onSubmit={(e) => e.preventDefault()} aria-label="Reconciliation export date range">
          <Field label="From (first day)"><input id="rx-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To (not included)"><input id="rx-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </form>
        {doc.ok ? (
          <div data-testid="rx-summary" style={{ marginTop: 10 }}>
            <p style={{ margin: "0 0 4px" }}><span className="mono">{doc.value.documentId}</span> · {doc.value.rows.length} rows for <span className="mono">{doc.value.period.from}</span> to <span className="mono">{doc.value.period.to}</span> (end exclusive)</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {CLASSES.map((c) => <li key={c}>{label("exportEvidenceClass", c)}: <strong>{doc.value.summary[c].rows}</strong>{Object.entries(doc.value.summary[c].byCurrency).map(([cur, val]) => <span key={cur} className="mono"> · {cur} {val}</span>)}</li>)}
            </ul>
          </div>
        ) : <p className={`${ui.status} ${ui.statusErr}`} data-testid="rx-invalid">{describeError(doc.error, ws).text} ({doc.error.code})</p>}
        <Status msg={msg} />
        <div className={ui.actions} style={{ alignItems: "flex-start", marginTop: 8 }}>
          <div><ActionButton size="small" gate={g} name="Download reconciliation export (.csv)" onClick={() => save("csv")}>Download reconciliation export (.csv)</ActionButton></div>
          <div><ActionButton size="small" gate={g} name="Download reconciliation export (.json)" onClick={() => save("json")}>Download reconciliation export (.json)</ActionButton></div>
        </div>
      </div>
    </Panel>
  );
}

function ExportRecords() {
  const { ws, actorName } = useWorkspace();
  const v = useBridge();
  const [err, setErr] = useState<string | null>(null);
  return (
    <Panel title={`Export records (${v.exports.length})`} id="records">
      {err && <div className={ui.panelBody}><p className={`${ui.status} ${ui.statusErr}`}>{err}</p></div>}
      {v.exports.length === 0 ? <Empty>No exports recorded yet.</Empty> : (
        <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Export records table">
          <table className={`${ui.table} ${ui.stack}`}>
            <thead><tr><th>Recorded</th><th>Kind</th><th>Document</th><th>Range</th><th className={ui.r}>Rows</th><th><span className={ui.srOnly}>Download</span></th></tr></thead>
            <tbody>{[...v.exports].reverse().map((x) => (
              <tr key={x.id} id={x.id} data-export={x.kind}>
                <td data-label="Recorded" className={ui.num}>{fmtTime(x.at)}<span className={ui.sub}>{actorName(x.by)}</span></td>
                <td data-label="Kind">{label("accountingExportKind", x.kind)}<span className={ui.sub + " mono"}>{x.id}</span></td>
                <td data-label="Document"><span className="mono">{x.documentId}</span><span className={ui.sub + " mono"} title={x.sha256}>sha256 {x.sha256.slice(0, 16)}…</span>{x.kind === "journal" && <span className={ui.sub}>Mapping revision {x.mappingRevision} · {x.proposalIds?.length ?? 0} entries</span>}</td>
                <td data-label="Range" className={ui.num}><span className="mono">{x.from}</span> to <span className="mono">{x.to}</span></td>
                <td data-label="Rows" className={`${ui.r} ${ui.num}`}>{x.rowCount}</td>
                <td data-label="Download">{x.kind === "journal" ? (
                  <span className={ui.actions}>
                    <Btn size="small" onClick={() => setErr(saveJournal(ws, x.id, "csv"))}>Download journal (.csv)<span className={ui.srOnly}> {x.documentId}</span></Btn>
                    <Btn size="small" onClick={() => setErr(saveJournal(ws, x.id, "json"))}>Download journal (.json)<span className={ui.srOnly}> {x.documentId}</span></Btn>
                  </span>
                ) : <span className={ui.hint}>Recorded id and hash; download a range above.</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function AccountingExports() {
  return (
    <>
      <PageHead eyebrow="Operations" title="Accounting exports"
        lede={<>Files for your accountant, generated in your browser. Nothing is sent anywhere. {POSTING_NOTE}</>} />
      <p className={ui.hint} data-testid="export-marking"><Chip tone="warn">Fictional</Chip> Every file is marked: {ACCOUNTING_EXPORT_MARKING}</p>
      <AccountingOverview />
      <JournalExport />
      <ReconciliationExport />
      <ExportRecords />
    </>
  );
}
