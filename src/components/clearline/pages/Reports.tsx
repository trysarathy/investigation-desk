"use client";
import Link from "../Link";
import { ENGINE_DISCLAIMER, exportCaseReport, serializeWorkspace } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { download } from "../download";
import { Btn, Chip, Empty, PageHead, Panel, fmtTime, ui } from "../ui";

export default function Reports() {
  const { ws, actorName } = useWorkspace();
  const exportCase = (id: string) => {
    const r = exportCaseReport(ws, id);
    if (r.ok) download(`${id}.txt`, r.value.text, "text/plain");
  };
  return (
    <>
      <PageHead eyebrow="Control" title="Reports and evidence"
        lede="Export case reports and the whole sandbox workspace. Files are generated in your browser; nothing is sent anywhere."
        actions={<Btn kind="primary" onClick={() => download(`clearline-workspace-${ws.asOf.slice(0, 10)}.json`, serializeWorkspace(ws), "application/json")}>Export workspace (.json)</Btn>} />
      <p className={ui.hint}>{ENGINE_DISCLAIMER}</p>
      <Panel title="Case reports" id="cases">
        {ws.cases.length === 0 ? <Empty>No cases to export.</Empty> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Case</th><th>Status</th><th>Payment</th><th><span className={ui.srOnly}>Export</span></th></tr></thead>
              <tbody>{ws.cases.map((c) => (
                <tr key={c.id}>
                  <td data-label="Case">{c.title}<span className={ui.sub + " mono"}>{c.id}</span></td>
                  <td data-label="Status"><Chip tone={c.status === "resolved" ? "ok" : "warn"}>{c.status}</Chip></td>
                  <td data-label="Payment">{c.intentId ? <Link href={`/clearline/payments/${c.intentId}`} className="mono">{c.intentId}</Link> : "—"}</td>
                  <td data-label="Export"><Btn size="small" onClick={() => exportCase(c.id)} aria-label={`Export case report ${c.id}`}>Export report</Btn></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={`Evidence register (${ws.evidence.length})`} id="evidence">
        {ws.evidence.length === 0 ? <Empty>No evidence recorded.</Empty> : (
          <div className={ui.tableWrap}>
            <table className={`${ui.table} ${ui.stack}`}>
              <thead><tr><th>Recorded</th><th>Evidence</th><th>Source</th><th>Independent</th><th>Linked to</th></tr></thead>
              <tbody>{[...ws.evidence].reverse().map((e) => (
                <tr key={e.id}>
                  <td data-label="Recorded" className={ui.num}>{fmtTime(e.recordedAt)}<span className={ui.sub}>{actorName(e.recordedBy)}</span></td>
                  <td data-label="Evidence">{e.description}<span className={ui.sub}>{e.kind.replace(/_/g, " ")}{e.documentName ? ` · ${e.documentName} (metadata only)` : ""}</span></td>
                  <td data-label="Source">{e.source}</td>
                  <td data-label="Independent"><Chip tone={e.independent ? "ok" : "neutral"}>{e.independent ? "Independent" : "Not independent"}</Chip></td>
                  <td data-label="Linked to">{e.intentId ? <Link href={`/clearline/payments/${e.intentId}`} className="mono">{e.intentId}</Link> : e.advanceId ?? e.caseId ?? "—"}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={`Audit log (${ws.audit.length})`} id="audit">
        {ws.audit.length === 0 ? <Empty>No audit events.</Empty> : (
          <div className={ui.tableWrap}>
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
