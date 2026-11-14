"use client";
/**
 * Case reports, produced by the engine from the browser workspace; nothing is sent anywhere.
 *  - The synthetic case report (rc3: buildCaseReport) for a payment or case: read in place, or saved as
 *    JSON / CSV (caseReportToJson / caseReportToCsv; amounts are exact decimal strings, CSV cells are
 *    protected against formula injection by the engine).
 *  - The case file (exportCaseReport): a case's notes and history as text / JSON.
 */
import { useMemo } from "react";
import {
  CASE_REPORT_MARKING, buildCaseReport, caseReportToCsv, caseReportToJson, exportCaseReport,
  type DecimalAmount, type SyntheticCaseReport,
} from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { describeError, label } from "./human";
import { download } from "./download";
import { fmtTime, ui } from "./ui";

/** The case file (notes and history) for one case. */
export function useCaseReport(caseId: string | undefined) {
  const { ws } = useWorkspace();
  const report = useMemo(() => (caseId ? exportCaseReport(ws, caseId) : null), [ws, caseId]);
  const save = (fmt: "txt" | "json") => {
    if (!caseId || !report?.ok) return false;
    if (fmt === "txt") download(`${caseId}.txt`, report.value.text, "text/plain");
    else download(`${caseId}.json`, JSON.stringify(report.value.json, null, 2), "application/json");
    return true;
  };
  const error = report && !report.ok ? `${describeError(report.error, ws).text} (${report.error.code})` : null;
  return { report, save, error };
}

export type ReportRef = { paymentId: string } | { caseId: string };

/** The engine's synthetic case report for a payment or a case. */
export function useSyntheticReport(ref: ReportRef | undefined) {
  const { ws } = useWorkspace();
  const key = ref ? ("paymentId" in ref ? `p:${ref.paymentId}` : `c:${ref.caseId}`) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => (ref ? buildCaseReport(ws, ref) : null), [ws, key]);
  const base = result?.ok ? `clearline-case-report-${result.value.subject.caseId ?? result.value.subject.paymentId}` : "";
  const save = (fmt: "json" | "csv") => {
    if (!result?.ok) return false;
    if (fmt === "json") download(`${base}.json`, caseReportToJson(result.value), "application/json");
    else download(`${base}.csv`, caseReportToCsv(result.value), "text/csv");
    return true;
  };
  const error = result && !result.ok ? `${describeError(result.error, ws).text} (${result.error.code})` : null;
  return { report: result?.ok ? result.value : null, save, error };
}

const amt = (d: DecimalAmount | undefined) => (d ? `${d.currency} ${d.value}` : "—");
const SECTION: Record<string, string> = {
  provider_reported: "Provider reported", independent_evidence: "Independent evidence", unknown: "Still unknown",
  contradiction: "Contradiction", outstanding: "Financially outstanding", next_action: "Next action",
};

/** The synthetic report, readable in place: a focusable, scrollable box so wide tables never widen the page. */
export function SyntheticReportView({ reportRef, id }: { reportRef: ReportRef; id: string }) {
  const { report, error } = useSyntheticReport(reportRef);
  if (error) return <p className={`${ui.status} ${ui.statusErr}`} role="alert">The case report could not be produced. {error}</p>;
  if (!report) return null;
  return <ReportBody r={report} id={id} />;
}

function ReportBody({ r, id }: { r: SyntheticCaseReport; id: string }) {
  const subject = r.subject.caseId ?? r.subject.paymentId;
  const t = r.threeTruths;
  return (
    <div className={ui.reportBox} id={id} role="group" tabIndex={0} aria-label={`Case report ${subject}`} data-testid="case-report">
      <div className={ui.reportInner}>
        <p className={ui.marker} data-testid="report-marking">{CASE_REPORT_MARKING}</p>
        <p className={ui.reportTitle}>Case report · {r.subject.internalReference} <span className="mono">{subject}</span></p>
        <p className={ui.hint} style={{ margin: "0 0 8px" }}>Generated on the simulated clock {fmtTime(r.generatedAt)} · {r.subject.organization}{r.subject.scenario ? ` · guided case ${r.subject.scenario}` : ""}</p>
        <p style={{ margin: "0 0 10px", fontWeight: 600 }}>{r.summary.headline}</p>

        <table className={ui.money}>
          <caption className={ui.reportCaption}>Three separate truths</caption>
          <tbody>
            <tr><th scope="row">Execution (provider claim)</th><td>{t.execution.label} <span className={ui.apiValue}>{t.execution.state}</span></td></tr>
            <tr><th scope="row">Settlement evidence</th><td>{t.settlement.label} ({t.settlement.scopeLabel}) <span className={ui.apiValue}>{t.settlement.state} · {t.settlement.independent ? "independent" : "not independent"}</span></td></tr>
            <tr><th scope="row">Reconciliation</th><td>{t.reconciliation.label} <span className={ui.apiValue}>{t.reconciliation.state}</span></td></tr>
          </tbody>
        </table>

        <table className={ui.money}>
          <caption className={ui.reportCaption}>Amounts (exact)</caption>
          <tbody>
            <tr><th scope="row">Requested</th><td className="mono">{amt(r.amounts.requested)}</td></tr>
            <tr><th scope="row">Matched</th><td className="mono">{amt(r.amounts.matched)}</td></tr>
            <tr><th scope="row">Unreconciled</th><td className="mono" data-testid="report-unreconciled">{amt(r.amounts.unreconciled)}</td></tr>
            {r.amounts.differences.map((d) => (
              <tr key={d.statementLineId + d.code}><th scope="row">Difference {d.outstanding ? "(outstanding)" : "(earlier)"}</th><td className="mono">expected {amt(d.expected)} · reported {amt(d.reported)} · difference {amt(d.difference)} <span className={ui.apiValue}>{d.code} · {d.source}</span></td></tr>
            ))}
            {r.amounts.returnPosition && <tr><th scope="row">Return position</th><td>{r.amounts.returnPosition.text} <span className={ui.apiValue}>{r.amounts.returnPosition.code} · beneficiary paid: no</span></td></tr>}
            {r.amounts.funding && <tr><th scope="row">Funding advance</th><td className="mono">principal {amt(r.amounts.funding.principal)} · repaid {amt(r.amounts.funding.repaid)} · outstanding {amt(r.amounts.funding.outstanding)}</td></tr>}
          </tbody>
        </table>

        <table className={ui.money} data-testid="report-findings">
          <caption className={ui.reportCaption}>Findings</caption>
          <tbody>
            {r.findings.map((f, i) => (
              <tr key={i}><th scope="row">{SECTION[f.section] ?? f.section}</th><td>{f.text}{f.amount ? <> <strong className="mono">{amt(f.amount)}</strong></> : null} <span className={ui.apiValue}>{f.code}</span></td></tr>
            ))}
          </tbody>
        </table>

        <table className={ui.money} data-testid="report-timeline">
          <caption className={ui.reportCaption}>Evidence timeline, with sources</caption>
          <tbody>
            {r.timeline.map((e, i) => (
              <tr key={i}><th scope="row" className="mono">{fmtTime(e.at)}</th><td>{e.title}<span className={ui.sub}>Source: {e.source} — {e.independent ? "independent" : "not independent"}</span></td></tr>
            ))}
          </tbody>
        </table>

        {r.exceptions.length > 0 && (
          <table className={ui.money}>
            <caption className={ui.reportCaption}>Exceptions</caption>
            <tbody>
              {r.exceptions.map((e) => (
                <tr key={e.id}><th scope="row" className="mono">{e.id}</th><td>{e.label} · {label("exceptionStatus", e.status)} · owner {e.ownerId ?? "unassigned"}{e.dueDate ? ` · due ${e.dueDate}` : ""} <span className={ui.apiValue}>{e.code}</span></td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={ui.hint} style={{ marginBottom: 0 }}>{r.disclaimer}</p>
      </div>
    </div>
  );
}
