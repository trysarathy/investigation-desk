"use client";

import { useState } from "react";
import { formatTime } from "@/lib/format";
import type { FileKind, UploadRecord } from "@/lib/workspace/store";
import { Status } from "./Status";

const rows = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;

const TITLES: Record<FileKind, { title: string; columns: string }> = {
  A: { title: "File A · Deposit addresses", columns: "address, chain, customer_id, assigned_at, retired_at" },
  B: {
    title: "File B · Deposit ledger",
    columns: "deposit_id, tx_hash, chain, token, to_address, amount, status, credited_at, customer_id, transfer_index, reason_code",
  },
};

export function UploadPanel({ kind, current }: { kind: FileKind; current?: UploadRecord }) {
  const [active, setActive] = useState<UploadRecord | undefined>(current);
  const [last, setLast] = useState<UploadRecord | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    if (!input.files?.[0]) return;
    setBusy(true);
    setError(undefined);
    const body = new FormData();
    body.set("file", input.files[0]);
    try {
      const res = await fetch(`/api/uploads/${kind}`, { method: "POST", body });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setLast(json as UploadRecord);
        if ((json as UploadRecord).outcome === "replaced") setActive(json as UploadRecord);
      }
    } catch {
      setError("Upload failed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const t = TITLES[kind];
  return (
    <section className="panel" aria-label={t.title}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h2>{t.title}</h2>
        {active
          ? <span className="muted">{active.filename} · {formatTime(active.uploadedAt)} · {rows(active.acceptedRows)}
              {active.rejectedRows > 0 && <> · <span className="s-warn">{active.rejectedRows.toLocaleString("en-US")} rejected</span></>}</span>
          : <Status status="warn" label="Not uploaded" />}
      </div>
      <form onSubmit={upload} style={{ padding: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input name="file" type="file" accept=".csv,text/csv" aria-label={`Choose ${t.title} CSV`} required />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Upload"}</button>
        <span className="faint" style={{ fontSize: 12 }}>Columns: <span className="mono">{t.columns}</span></span>
      </form>
      {error && <div className="bar bar-red" role="alert" style={{ margin: "0 16px 16px" }}>{error}</div>}
      {last && <UploadResult r={last} />}
    </section>
  );
}

function UploadResult({ r }: { r: UploadRecord }) {
  return (
    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }} role="status">
      {r.outcome === "rejected" && (
        <div className="bar bar-red"><Status status="fail" label="File rejected" /> {r.fileErrors.join(" ")} The previous file is still in use.</div>
      )}
      {r.outcome === "no_change" && (
        <div className="bar bar-info"><Status status="info" label="No change" /> This file is identical to the current one (same SHA-256), so nothing was re-imported.</div>
      )}
      {r.outcome === "replaced" && (
        <div className={`bar ${r.rejectedRows ? "bar-amber" : "bar-info"}`}>
          <Status status={r.rejectedRows ? "warn" : "pass"} label="Uploaded" />
          {rows(r.acceptedRows)} accepted{r.rejectedRows ? `, ${rows(r.rejectedRows)} rejected. Rejected rows were not imported: fix them in your file and upload it again.` : "."}
        </div>
      )}
      {r.ignoredColumns.length > 0 && <p className="muted" style={{ margin: 0 }}>Ignored columns (not read or stored): <span className="mono">{r.ignoredColumns.join(", ")}</span></p>}
      {r.notes.map((n) => <p key={n} className="muted" style={{ margin: 0 }}>{n}</p>)}
      <p className="faint mono" style={{ margin: 0, fontSize: 12 }}>SHA-256 {r.sha256}</p>
      {r.rowErrors.length > 0 && (
        <div className="table-wrap" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
          <table className="table" aria-label="Rejected rows">
            <thead><tr><th>Line</th><th>Column</th><th>Value</th><th>Problem</th></tr></thead>
            <tbody>
              {r.rowErrors.map((e, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="num">{e.line}</td>
                  <td className="mono">{e.column ?? "—"}</td>
                  <td className="mono" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{e.value ?? ""}</td>
                  <td style={{ whiteSpace: "normal" }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.rejectedRows > r.rowErrors.length && <p className="faint" style={{ margin: 0, padding: 8 }}>Showing the first {r.rowErrors.length} of {r.rejectedRows}.</p>}
        </div>
      )}
    </div>
  );
}
