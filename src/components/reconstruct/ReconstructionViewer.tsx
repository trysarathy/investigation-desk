"use client";
/**
 * rc6 phase 10: shows a reconstruction report (report.json) the user picks from their own machine. The file is read
 * and parsed in this browser tab only: nothing is uploaded, stored or sent to the server, and every value is rendered
 * as text.
 */
import { useId, useState, type ChangeEvent } from "react";
import s from "@/components/control/control.module.css";
import { parseReportText } from "@/lib/clearline/merchant/reconstruct/schema";
import type { ReconstructionReport } from "@/lib/clearline/merchant/reconstruct/types";

function Table({ label, head, rows }: { label: string; head: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className={s.tableWrap} role="region" aria-label={label} tabIndex={0}>
      <table className={s.table}>
        <thead><tr>{head.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th scope="row" key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function ReportView({ report: r }: { report: ReconstructionReport }) {
  return (
    <article aria-labelledby="report-title" className={s.section}>
      <p className={s.warnBox} role="note" data-testid="report-label"><strong>{r.label}</strong></p>
      <h2 id="report-title" className={s.h}>{r.title}</h2>
      <p className={s.muted}>Entity {r.entity.name} ({r.entity.id}), {r.entity.currency}, {r.entity.timeZone}. Tolerance band {r.policy.band}. Generated: {r.generatedAt ?? "not stated"}.</p>

      <h3 className={s.h}>Summary</h3>
      <dl className={s.dl}>
        {r.figures.map((f) => (
          <div key={f.key}><dt>{f.label}</dt><dd>{f.value}{f.onceBankConfirmed ? ` (once the bank line is confirmed: ${f.onceBankConfirmed})` : ""}</dd></div>
        ))}
      </dl>

      <h3 className={s.h}>Questions to ask the provider</h3>
      {r.questions.length ? <ol>{r.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ol> : <p>None.</p>}

      <h3 className={s.h}>Unmappable fields</h3>
      {r.unmappable.length
        ? <Table label="Unmappable fields" head={["Field", "Source", "Kind", "Detail"]} rows={r.unmappable.map((u) => [u.field, u.source, u.kind, u.detail])} />
        : <p>None.</p>}

      <h3 className={s.h}>Items</h3>
      <Table label="Result, rule and deciding step per item" head={["Order", "Invoice", "Credited", "Difference", "Result", "Rule", "Step", "Once bank-confirmed", "Owner"]}
        rows={r.items.map((it) => [it.orderId, it.invoice, it.credited, it.differences.map((d) => `${d.amount} ${d.typeText}`).join("; ") || it.difference, it.resultText, it.rule, String(it.decidingStep), `${it.onceBankConfirmed.resultText} (${it.onceBankConfirmed.rule})`, it.owner ?? ""])} />

      <h3 className={s.h}>Bridge per batch</h3>
      {r.bridges.length ? r.bridges.map((b) => (
        <section key={b.batchId} aria-label={`Batch ${b.batchId}`}>
          <p>Batch {b.batchId}: tied {b.tied ? "yes" : "no"}; settlement verified {b.settlementVerified ? "yes" : "no"}{b.bankLineLabel ? ` (${b.bankLineLabel})` : ""}. {b.bankEvidenceLabel}.</p>
          <Table label={`Bridge for batch ${b.batchId}`} head={["Line", "Amount", "Reason"]} rows={b.lines.map((l) => [l.label, l.amount, l.reason])} />
        </section>
      )) : <p>No settlement batch.</p>}

      <h3 className={s.h}>Journal proposals</h3>
      <p>Every entry is a proposal: posting rule pending sign-off.</p>
      {r.journals.length ? (
        <Table label="Journal proposals" head={["Entry", "Kind", "Status", "Lines"]}
          rows={r.journals.map((j) => [j.id, j.kindText, `${j.status} · ${j.postingRule}`, j.lines.map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.account} ${l.amount}`).join("; ")])} />
      ) : <p>None.</p>}
    </article>
  );
}

export function ReconstructionViewer() {
  const id = useId();
  const [report, setReport] = useState<ReconstructionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setReport(null);
    setError(null);
    if (!file) return;
    const parsed = parseReportText(await file.text());
    if (parsed.ok) setReport(parsed.report); else setError(parsed.error);
  }
  return (
    <section aria-labelledby={`${id}-h`} className={s.section}>
      <h2 id={`${id}-h`} className={s.h}>Open a report from your machine</h2>
      <div className={s.field}>
        <label htmlFor={`${id}-file`} className={s.label}>Reconstruction report (report.json)</label>
        <input id={`${id}-file`} className={s.input} type="file" accept="application/json,.json" aria-describedby={`${id}-hint`} onChange={onFile} />
        <p id={`${id}-hint`} className={s.hint}>The file is read in this browser tab only. It is not uploaded or sent to the server.</p>
      </div>
      <div aria-live="polite">
        {error ? <p className={s.resultError} role="alert">{error}</p> : null}
        {report ? <ReportView report={report} /> : null}
      </div>
    </section>
  );
}
