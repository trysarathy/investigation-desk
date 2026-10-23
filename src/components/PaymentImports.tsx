"use client";

// Import payment records with a saved column mapping. Choosing a file reads its header row here
// in the browser so the mapping can be checked against it before anything is sent. Changing a
// mapping saves it as the next version; the import then names that exact version.

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { parseCsv } from "@/lib/csv/parse";
import { FIELDS, type ColumnMapping } from "@/lib/payments/fields";
import type { ImportLog } from "@/lib/payments/store";
import type { ImportKind } from "@/lib/payments/types";
import { Status } from "./Status";

const KINDS: { kind: ImportKind; title: string }[] = [
  { kind: "instruction", title: "Payment instructions" },
  { kind: "provider", title: "Provider settlement reports" },
  { kind: "bank", title: "Bank records" },
];
const VALUE_MAPS: Record<ImportKind, (keyof NonNullable<ColumnMapping["values"]>)[]> = {
  instruction: ["chain", "token"], provider: ["status", "type", "chain"], bank: ["direction"],
};
const MAP_HELP: Record<string, string> = {
  status: "pending, awaiting_approval, processing, on_hold, provider_reports_complete, cancelled, expired, underpaid, overpaid, returned",
  type: "principal, fee, return, other",
  chain: "tron, ethereum, bsc, polygon, base, arbitrum, optimism",
  token: "USDT, USDC",
  direction: "credit, debit",
};

export function PaymentImports({ mappings, imports, preview }: { mappings: ColumnMapping[]; imports: ImportLog[]; preview: boolean }) {
  return (
    <>
      <h2 style={{ marginTop: 8 }}>Import records</h2>
      {preview
        ? <p className="muted" style={{ margin: 0 }}>Imports are off on this demo preview (DEMO_MODE=1), so it never holds real customer data.</p>
        : KINDS.map((k) => <ImportPanel key={k.kind} kind={k.kind} title={k.title} mappings={mappings.filter((m) => m.kind === k.kind)} />)}
      {imports.length > 0 && (
        <section className="panel" aria-label="Import history">
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Import history</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Import</th><th>Kind</th><th>File</th><th>Mapping</th><th>Outcome</th><th className="num">New</th><th className="num">Duplicate rows</th><th className="num">Rejected</th><th>SHA-256</th></tr></thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.importId} style={{ cursor: "default" }}>
                    <td className="mono">{i.importId}</td><td>{i.kind}</td><td>{i.fileName}</td><td className="mono">{i.mappingId} v{i.mappingVersion}</td>
                    <td>{i.outcome}</td><td className="num">{i.newRecords}</td><td className="num">{i.duplicateRows}</td><td className="num">{i.rejectedRows}</td>
                    <td className="mono faint">{i.sha256.slice(0, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

const latestOf = (ms: ColumnMapping[]) => {
  const byId = new Map<string, ColumnMapping>();
  for (const m of ms) if ((byId.get(m.mappingId)?.version ?? 0) < m.version) byId.set(m.mappingId, m);
  return [...byId.values()];
};
const mapText = (m?: Record<string, string>) => Object.entries(m ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n");
function parseMapText(t: string): { map?: Record<string, string>; error?: string } {
  const lines = t.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return {};
  const map: Record<string, string> = {};
  for (const l of lines) {
    const i = l.lastIndexOf(" = ");
    if (i < 1) return { error: `"${l}" should look like RAW = meaning.` };
    map[l.slice(0, i)] = l.slice(i + 3).trim();
  }
  return { map };
}

function ImportPanel({ kind, title, mappings }: { kind: ImportKind; title: string; mappings: ColumnMapping[] }) {
  const router = useRouter();
  const latest = useMemo(() => latestOf(mappings), [mappings]);
  const [selectedId, setSelectedId] = useState(latest[0]?.mappingId ?? "");
  const base = latest.find((m) => m.mappingId === selectedId) ?? latest[0];
  const [draft, setDraft] = useState<ColumnMapping | undefined>(base);
  const [mapTexts, setMapTexts] = useState<Record<string, string>>(() => Object.fromEntries(VALUE_MAPS[kind].map((k) => [k, mapText(base?.values?.[k])])));
  const [file, setFile] = useState<File | undefined>();
  const [header, setHeader] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | undefined>();
  const [log, setLog] = useState<ImportLog | undefined>();

  const choose = (id: string) => {
    const m = latest.find((x) => x.mappingId === id)!;
    setSelectedId(id); setDraft(m); setMessage(undefined);
    setMapTexts(Object.fromEntries(VALUE_MAPS[kind].map((k) => [k, mapText(m.values?.[k])])));
  };
  const readHeader = async (f?: File) => {
    setFile(f); setLog(undefined); setHeader(undefined);
    if (!f) return;
    const head = (await f.slice(0, 64 * 1024).text()).split(/\r?\n/)[0] ?? "";
    setHeader(parseCsv(head.replace(/^﻿/, "") + "\n").header);
  };

  if (!draft) return null;
  const values: ColumnMapping["values"] = {};
  let mapError: string | undefined;
  for (const k of VALUE_MAPS[kind]) {
    const parsed = parseMapText(mapTexts[k] ?? "");
    if (parsed.error) mapError = `${k}: ${parsed.error}`;
    if (parsed.map) (values as Record<string, Record<string, string>>)[k] = parsed.map;
  }
  const edited: ColumnMapping = { ...draft, values };
  const stable = (m: ColumnMapping) => JSON.stringify([m.columns, m.timestampFormat, VALUE_MAPS[kind].map((k) => m.values?.[k] ?? {})]);
  const changed = !!base && stable(edited) !== stable(base);
  const missingRequired = header ? FIELDS[kind].filter((s) => s.required && !header.includes(edited.columns[s.field] ?? "")) : [];

  const save = async (): Promise<ColumnMapping | undefined> => {
    const { version: _v, createdAt: _c, ...body } = edited;
    const res = await fetch("/api/payments/mappings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (json.errors?.length) { setMessage({ kind: "error", text: json.errors.join(" ") }); return undefined; }
    setMessage({ kind: "info", text: json.unchanged ? "No change to save." : `Saved ${json.mapping.name} as version ${json.mapping.version}.` });
    setDraft(json.mapping);
    router.refresh();
    return json.mapping as ColumnMapping;
  };
  const run = async () => {
    if (!file) return;
    setBusy(true); setMessage(undefined);
    try {
      const m = changed ? await save() : draft;
      if (!m) return;
      const body = new FormData();
      body.set("file", file); body.set("mappingId", m.mappingId); body.set("mappingVersion", String(m.version));
      const res = await fetch(`/api/payments/imports/${kind}`, { method: "POST", body });
      const json = await res.json();
      if (json.error) setMessage({ kind: "error", text: json.error });
      else { setLog(json as ImportLog); router.refresh(); }
    } catch {
      setMessage({ kind: "error", text: "Import failed. Nothing was changed." });
    } finally { setBusy(false); }
  };

  return (
    <section className="panel" aria-label={title}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <h2>{title}</h2>
        <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Mapping
          <select value={selectedId} onChange={(e) => choose(e.target.value)} aria-label={`${title} mapping`}>
            {latest.map((m) => <option key={m.mappingId} value={m.mappingId}>{m.name} · v{m.version}</option>)}
          </select>
        </label>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="file" accept=".csv,text/csv" aria-label={`Choose ${title} CSV`} onChange={(e) => void readHeader(e.target.files?.[0])} />
          <button className="btn btn-primary" disabled={!file || busy || !!mapError || missingRequired.length > 0} onClick={() => void run()}>
            {busy ? "Importing…" : changed ? `Save as v${(base?.version ?? 0) + 1} and import` : `Import with v${draft.version}`}
          </button>
          {changed && <button className="btn" disabled={busy || !!mapError} onClick={() => void save()}>Save as v{(base?.version ?? 0) + 1}</button>}
        </div>
        {missingRequired.length > 0 && (
          <div className="bar bar-amber"><Status status="warn" label="Required columns not in this file" /> {missingRequired.map((s) => `${s.label} ("${edited.columns[s.field] ?? "unmapped"}")`).join(", ")}</div>
        )}
        <details>
          <summary className="muted">Columns and values ({draft.name}, v{draft.version}{changed ? ", edited" : ""})</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead><tr><th>Field</th><th>Column in file</th></tr></thead>
              <tbody>
                {FIELDS[kind].map((s) => {
                  const current = edited.columns[s.field] ?? "";
                  const options = [...new Set([...(header ?? []), ...(current ? [current] : [])])];
                  const absent = header && current && !header.includes(current);
                  return (
                    <tr key={s.field} style={{ cursor: "default" }}>
                      <td>{s.label}{s.required && <span className="faint"> · required</span>}</td>
                      <td>
                        <select value={current} aria-label={`Column for ${s.label}`}
                          onChange={(e) => setDraft({ ...edited, columns: Object.fromEntries(Object.entries({ ...edited.columns, [s.field]: e.target.value }).filter(([, v]) => v)) })}>
                          <option value="">— not mapped —</option>
                          {options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        {absent && <span className="s-warn" style={{ marginLeft: 8 }}>not in this file</span>}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ cursor: "default" }}>
                  <td>Timestamps</td>
                  <td>
                    <select value={edited.timestampFormat} aria-label="Timestamp format"
                      onChange={(e) => setDraft({ ...edited, timestampFormat: e.target.value as ColumnMapping["timestampFormat"] })}>
                      <option value="iso8601_offset">ISO 8601 with offset</option>
                      <option value="epoch_s">Unix time, seconds</option>
                      <option value="epoch_ms">Unix time, milliseconds</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {VALUE_MAPS[kind].map((k) => (
            <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              <span className="muted">{k} values, one per line as <span className="mono">RAW = meaning</span> ({MAP_HELP[k]}){k === "status" || k === "type" ? ". Anything not listed is kept raw as unmapped." : ". Empty: the file must use these names exactly."}</span>
              <textarea className="mono" rows={Math.min(10, Math.max(2, (mapTexts[k] ?? "").split("\n").length))} value={mapTexts[k] ?? ""}
                onChange={(e) => setMapTexts({ ...mapTexts, [k]: e.target.value })} aria-label={`${k} values`} />
            </label>
          ))}
          {draft.sources && draft.sources.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p className="muted" style={{ margin: 0 }}>Format sources:</p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{draft.sources.map((s) => <li key={s.url + s.about}>{s.about}: <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></li>)}</ul>
            </div>
          )}
          {draft.notes?.map((n) => <p key={n} className="faint" style={{ margin: "8px 0 0" }}>{n}</p>)}
        </details>
        {mapError && <div className="bar bar-red" role="alert">{mapError}</div>}
        {message && <div className={`bar ${message.kind === "error" ? "bar-red" : "bar-info"}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div>}
        {log && <ImportResult log={log} />}
      </div>
    </section>
  );
}

function ImportResult({ log }: { log: ImportLog }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="status">
      {log.outcome === "rejected" && <div className="bar bar-red"><Status status="fail" label="File rejected" /> {log.fileErrors.join(" ")} Nothing was imported.</div>}
      {log.outcome === "no_change" && <div className="bar bar-info"><Status status="info" label="No change" /> {log.notes.join(" ")}</div>}
      {log.outcome === "imported" && (
        <div className={`bar ${log.rejectedRows ? "bar-amber" : "bar-info"}`}>
          <Status status={log.rejectedRows ? "warn" : "pass"} label="Imported" />
          {log.acceptedRows} rows accepted ({log.newRecords} new, {log.duplicateRows} already held and kept as duplicate records){log.rejectedRows ? `, ${log.rejectedRows} rejected and not imported.` : "."} Matching re-ran.
        </div>
      )}
      {log.ignoredColumns.length > 0 && <p className="muted" style={{ margin: 0 }}>Columns not read: <span className="mono">{log.ignoredColumns.join(", ")}</span></p>}
      {log.outcome !== "no_change" && log.notes.map((n) => <p key={n} className="muted" style={{ margin: 0 }}>{n}</p>)}
      {log.rowErrors.length > 0 && (
        <div className="table-wrap" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
          <table className="table" aria-label="Rejected rows">
            <thead><tr><th>Line</th><th>Column</th><th>Value</th><th>Problem</th></tr></thead>
            <tbody>
              {log.rowErrors.map((e, i) => (
                <tr key={i} style={{ cursor: "default" }}>
                  <td className="num">{e.line}</td><td className="mono">{e.column ?? "—"}</td>
                  <td className="mono" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{e.value ?? ""}</td>
                  <td style={{ whiteSpace: "normal" }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
