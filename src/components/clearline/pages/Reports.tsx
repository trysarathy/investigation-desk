"use client";
import Link from "../Link";
import { Fragment, useState } from "react";
import { ENGINE_DISCLAIMER, exportCaseReport, serializeWorkspace } from "@/lib/clearline";
import { label } from "../human";
import { SyntheticReportView, useSyntheticReport } from "../CaseReport";
import { useWorkspace } from "../workspace";
import { download } from "../download";
import { Btn, Chip, Empty, PageHead, Panel, fmtTime, ui } from "../ui";

function CsvButton({ caseId }: { caseId: string }) {
  const { report, save } = useSyntheticReport({ caseId });
  return <Btn size="small" disabled={!report} onClick={() => save("csv")}>Export report<span className={ui.srOnly}> {caseId}</span> (.csv)</Btn>;
}

export default function Reports() {
  const { ws, actorName } = useWorkspace();
  const [viewing, setViewing] = useState<string | null>(null);
  const exportCase = (id: string) => {
    const r = exportCaseReport(ws, id);
    if (r.ok) download(`${id}.txt`, r.value.text, "text/plain");
  };
  return (
    <>
      <PageHead eyebrow="Oversight" title="Reports and evidence"
        lede="Export case reports and the whole sandbox workspace. Files are generated in your browser; nothing is sent anywhere."
        actions={<Btn kind="primary" onClick={() => download(`clearline-workspace-${ws.asOf.slice(0, 10)}.json`, serializeWorkspace(ws), "application/json")}>Export workspace (.json)</Btn>} />
      <p className={ui.hint}>{ENGINE_DISCLAIMER}</p>
      <Panel title="Case reports" id="cases">
        {ws.cases.length === 0 ? <Empty>No cases to export.</Empty> : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Case reports table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Case</th><th>Status</th><th>Payment</th><th><span className={ui.srOnly}>Export</span></th></tr></thead>
              <tbody>{ws.cases.map((c) => (
                <Fragment key={c.id}>
                  <tr data-case={c.id}>
                    <td data-label="Case">{c.title}<span className={ui.sub + " mono"}>{c.id}</span></td>
                    <td data-label="Status"><Chip tone={c.status === "resolved" ? "neutral" : c.status === "reopened" ? "bad" : "warn"} title={`API value: ${c.status}`}>{label("caseStatus", c.status)}</Chip></td>
                    <td data-label="Payment">{c.intentId ? <Link href={`/clearline/payments/${c.intentId}`} className="mono">{c.intentId}</Link> : "—"}</td>
                    <td data-label="Export">
                      <span className={ui.actions}>
                        <Btn size="small" aria-expanded={viewing === c.id} aria-controls={`report-${c.id}`} onClick={() => setViewing((v) => (v === c.id ? null : c.id))}>{viewing === c.id ? "Hide report" : "View report"}<span className={ui.srOnly}> {c.id}</span></Btn>
                        <CsvButton caseId={c.id} />
                        <Btn size="small" onClick={() => exportCase(c.id)}>Export case file<span className={ui.srOnly}> {c.id}</span> (.txt)</Btn>
                      </span>
                    </td>
                  </tr>
                  {viewing === c.id && <tr><td colSpan={4} data-label="Report"><SyntheticReportView reportRef={{ caseId: c.id }} id={`report-${c.id}`} /></td></tr>}
                </Fragment>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={`Evidence register (${ws.evidence.length})`} id="evidence">
        {ws.evidence.length === 0 ? <Empty>No evidence recorded.</Empty> : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Evidence register table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Recorded</th><th>Evidence</th><th>Source</th><th>Independent</th><th>Linked to</th></tr></thead>
              <tbody>{[...ws.evidence].reverse().map((e) => (
                <tr key={e.id}>
                  <td data-label="Recorded" className={ui.num}>{fmtTime(e.recordedAt)}<span className={ui.sub}>{actorName(e.recordedBy)}</span></td>
                  <td data-label="Evidence">{e.description}<span className={ui.sub}>{label("evidenceKind", e.kind)}{e.documentName ? ` · ${e.documentName} (metadata only)` : ""}</span></td>
                  <td data-label="Source">{e.source}<span className={ui.sub}>{e.independent ? "Independent evidence" : e.kind === "provider_status_report" ? "Provider claim" : "Recorded by a person"}</span></td>
                  <td data-label="Independent"><Chip tone={e.independent ? "info" : "neutral"}>{e.independent ? "Independent" : "Not independent"}</Chip></td>
                  <td data-label="Linked to">{e.intentId ? <Link href={`/clearline/payments/${e.intentId}`} className="mono">{e.intentId}</Link> : e.advanceId ?? e.caseId ?? "—"}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={`Audit log (${ws.audit.length})`} id="audit">
        {ws.audit.length === 0 ? <Empty>No audit events.</Empty> : (
          <div className={ui.tableWrap} role="group" tabIndex={0} aria-label="Audit log table">
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>At</th><th>Actor</th><th>Action</th><th>Summary</th></tr></thead>
              <tbody>{[...ws.audit].reverse().slice(0, 200).map((a) => (
                <tr key={a.id}>
                  <td data-label="At" className={ui.num}>{fmtTime(a.at)}</td>
                  <td data-label="Actor">{actorName(a.actorId)}</td>
                  <td data-label="Action"><code className={ui.code}>{a.action}</code></td>
                  <td data-label="Summary">{a.summary}<span className={ui.sub}>{a.entityType} {a.entityId}</span></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
