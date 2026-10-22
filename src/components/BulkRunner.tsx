"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isNonCredited, resultsCsv } from "@/lib/bulk/export";
import type { BulkResult } from "@/lib/bulk/types";
import type { RowError } from "@/lib/csv/files";
import { CHAIN_NAMES } from "@/lib/types";
import { ConfidenceLabel, Status } from "./Status";

interface Job {
  id: string; filename: string; total: number; done: number; status: "running" | "done";
  skipped: RowError[]; results: BulkResult[]; casesCreated?: number;
}

export function BulkRunner({ blocked }: { blocked?: string }) {
  const [job, setJob] = useState<Job | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<number | undefined>();

  // Poll while the job runs. One request a second is plenty; the chains are the slow part.
  useEffect(() => {
    if (!job || job.status === "done") return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/bulk/${job.id}`).catch(() => undefined);
      if (res?.ok) setJob(await res.json());
    }, 1000);
    return () => clearTimeout(t);
  }, [job]);

  const start = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    if (!input.files?.[0]) return;
    setBusy(true); setError(undefined); setJob(undefined); setCreated(undefined);
    const body = new FormData();
    body.set("file", input.files[0]);
    try {
      const res = await fetch("/api/bulk", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Bulk run could not start.");
      else {
        const first = await fetch(`/api/bulk/${json.id}`);
        setJob(await first.json());
      }
    } catch {
      setError("Bulk run could not start.");
    } finally {
      setBusy(false);
    }
  };

  const createCases = async () => {
    if (!job) return;
    const res = await fetch(`/api/bulk/${job.id}/cases`, { method: "POST" });
    const json = await res.json();
    if (res.ok) setCreated(json.created); else setError(json.error);
  };

  const exportCsv = () => {
    if (!job) return;
    const blob = new Blob([resultsCsv(job.results)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bulk-results-${job.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of job?.results ?? []) {
      const k = r.state === "verdict" ? `${r.code} ${r.label}` : r.state === "paused" ? "Check paused" : "Lookup failed";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [job]);
  const rows = useMemo(() => [...(job?.results ?? [])].sort((a, b) => a.line - b.line), [job]);
  const nonCredited = rows.filter(isNonCredited).length;
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <>
      <section className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0 }}>
          Upload a CSV with columns <span className="mono">tx_hash</span>, <span className="mono">chain</span> (optional) and{" "}
          <span className="mono">customer_id</span> (optional), up to 1,000 rows. Each row runs the same checks as a pasted hash, against your uploaded Files A and B.
        </p>
        {blocked ? (
          <div className="bar bar-amber" role="status">{blocked}</div>
        ) : (
          <form onSubmit={start} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input name="file" type="file" accept=".csv,text/csv" aria-label="Choose bulk CSV" required />
            <button className="btn btn-primary" type="submit" disabled={busy || job?.status === "running"}>Run</button>
          </form>
        )}
        {error && <div className="bar bar-red" role="alert">{error}</div>}
      </section>

      {job && (
        <section className="panel" aria-label="Bulk progress" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <strong>{job.filename}</strong>
            <span className="muted num">{job.done} of {job.total} checked{job.skipped.length ? ` · ${job.skipped.length} ${job.skipped.length === 1 ? "row" : "rows"} skipped` : ""}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Bulk progress"
            style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width 300ms" }} />
          </div>
          {counts.length > 0 && (
            <p className="muted" style={{ margin: 0 }}>{counts.map(([k, n]) => `${n} × ${k}`).join(" · ")}</p>
          )}
          {job.status === "done" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn btn-primary" type="button" onClick={createCases} disabled={nonCredited === 0}>
                Create cases for non-credited ({nonCredited})
              </button>
              <button className="btn" type="button" onClick={exportCsv}>Export results CSV</button>
              {created !== undefined && (
                <span role="status"><Status status="pass" label={`${created} case${created === 1 ? "" : "s"} created`} /> <Link href="/">Open the queue</Link>
                  {created < nonCredited && <span className="faint"> ({nonCredited - created} already open)</span>}</span>
              )}
            </div>
          )}
        </section>
      )}

      {job && job.skipped.length > 0 && (
        <section className="panel table-wrap" aria-label="Skipped rows">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Skipped rows (not investigated, not guessed)</h2></div>
          <table className="table">
            <thead><tr><th>Line</th><th>Column</th><th>Value</th><th>Problem</th></tr></thead>
            <tbody>
              {job.skipped.map((e, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="num">{e.line}</td><td className="mono">{e.column ?? "—"}</td>
                  <td className="mono">{e.value ?? ""}</td><td style={{ whiteSpace: "normal" }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {rows.length > 0 && (
        <section className="panel table-wrap" aria-label="Bulk results">
          <table className="table">
            <thead>
              <tr><th>Line</th><th>Customer</th><th>Chain</th><th style={{ textAlign: "right" }}>Amount</th><th>Verdict</th><th>Confidence</th><th>Note</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} style={{ cursor: "default" }}>
                  <td className="num">{r.line}</td>
                  <td className="mono muted">{r.customerId ?? "—"}{r.customerInferred && <span className="faint" title="Owner of the destination in File A at block time"> (File A)</span>}</td>
                  <td>{r.foundChain ? <span className="badge">{CHAIN_NAMES[r.foundChain]}</span> : <span className="faint">—</span>}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{r.amount ? `${r.amount} ${r.token ?? ""}` : "—"}</td>
                  <td>
                    {r.state === "verdict"
                      ? <Link href={`/investigate?q=${encodeURIComponent(r.txHash)}${r.customerId ? `&customer=${encodeURIComponent(r.customerId)}` : ""}`}><span className="code">{r.code}</span> {r.label}</Link>
                      : <Status status="warn" label={r.label} />}
                  </td>
                  <td><ConfidenceLabel confidence={r.confidence} paused={r.state !== "verdict"} /></td>
                  <td className="faint" style={{ whiteSpace: "normal" }}>{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
