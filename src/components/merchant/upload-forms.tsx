"use client";

import { useId, useMemo, useRef, useState, type DragEvent } from "react";
import { FILE_TYPES, NETWORK_IDS, STATUS_TARGETS, fieldsOf, validateMapping, type FieldDef, type FileType, type Mapping } from "@/lib/clearline/mapping";
import type { ColumnMapping, MappingSuggestion } from "@/lib/clearline/mapping";
import { detectDateFormat } from "@/lib/clearline/ingest/dates";
import { detectDecimalSeparator } from "@/lib/clearline/ingest/decimal";
import { ACCEPT, FILE_TYPE_HINTS, FILE_TYPE_LABELS, LIMITS_TEXT, bankAccountLabel } from "@/lib/clearline/upload-words";
import s from "@/components/control/control.module.css";
import m from "./merchant.module.css";
import g from "./screens-g2.module.css";

/**
 * rc7 upload screens, client parts. Each request goes to /api/control/merchant/uploads (session, organisation, exact
 * Origin, Idempotency-Key and role are checked there). Suggestions are only ever preselected: nothing is used until
 * the person presses "Confirm mapping", and an ambiguous date order or decimal separator is asked, never guessed.
 * File contents are never logged; the file goes to the server only.
 */

const API = "/api/control/merchant/uploads";
const MAX_BYTES = 20 * 1024 * 1024;
const FLASH = "clearline.control.flash";

function newKey() {
  const c = globalThis.crypto;
  return `ui-${typeof c.randomUUID === "function" ? c.randomUUID() : Array.from(c.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
type Reply = { ok: boolean; data: Record<string, unknown> | null; message: string };
export async function post(url: string, body: BodyInit | unknown): Promise<Reply> {
  const multipart = body instanceof FormData;
  try {
    const res = await fetch(url, {
      method: "POST", credentials: "same-origin", body: multipart ? body : JSON.stringify(body ?? {}),
      headers: { "idempotency-key": newKey(), ...(multipart ? {} : { "content-type": "application/json" }) },
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const e = data?.error as { message?: string } | undefined;
    return { ok: res.ok, data, message: e?.message ?? (res.ok ? "" : `The server refused this (HTTP ${res.status}).`) };
  } catch { return { ok: false, data: null, message: "The server could not be reached. Nothing was saved." }; }
}
/** Reload after a server-confirmed change and show the confirmation next to `key` (same contract as the Control forms). */
export function reloadWith(key: string, message: string, url?: string) {
  try { sessionStorage.setItem(FLASH, JSON.stringify({ key, message, at: Date.now() })); } catch { /* the stored state still shows */ }
  if (url) window.location.assign(url); else window.location.reload();
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * The same request as post() (same endpoint, fields, credentials and Idempotency-Key header), sent with XMLHttpRequest
 * so the browser reports how many bytes have gone up. `onProgress` gets the share sent (0..1); 1 means every byte has
 * reached the server and it is now reading the file. The answer is read exactly as post() reads it.
 */
function postWithProgress(url: string, body: FormData, onProgress: (share: number) => void): Promise<Reply> {
  return new Promise((resolve) => {
    let xhr: XMLHttpRequest;
    try { xhr = new XMLHttpRequest(); } catch { void post(url, body).then(resolve); return; }
    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("idempotency-key", newKey());
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total)); };
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      let data: Record<string, unknown> | null = null;
      try { data = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { data = null; }
      const ok = xhr.status >= 200 && xhr.status < 300;
      const e = data?.error as { message?: string } | undefined;
      resolve({ ok, data, message: e?.message ?? (ok ? "" : `The server refused this (HTTP ${xhr.status}).`) });
    };
    xhr.onerror = () => resolve({ ok: false, data: null, message: "The server could not be reached. Nothing was saved." });
    xhr.onabort = xhr.onerror;
    xhr.send(body);
  });
}

/** Upload progress: bytes sent from the browser (the browser's own count), then "reading" once every byte is sent. */
function UploadProgress({ sent, size }: { sent: number; size: number }) {
  const pct = Math.floor(sent * 100);
  const reading = sent >= 1;
  return (
    <div className={g.progress} data-testid="upload-progress">
      <div className={g.progressHead}>
        <span>{reading ? "Sent. The server is reading and checking the file…" : "Sending the file"}</span>
        <span className={g.mono}>{reading ? mb(size) : `${pct}% · ${mb(Math.floor(size * sent))} of ${mb(size)}`}</span>
      </div>
      <progress className={g.bar} max={100} value={reading ? undefined : pct} aria-label={reading ? "The server is reading the file" : `Upload progress, ${pct}% sent`} />
    </div>
  );
}

export interface BankAccountChoice { id: string; entityId: string; displayName: string; accountLast4: string; currency: string }

export function UploadForm({ entities, bankAccounts = [] }: { entities: { id: string; name: string; currency: string }[]; bankAccounts?: BankAccountChoice[] }) {
  const id = useId();
  const [entityId, setEntityId] = useState(entities.length === 1 ? entities[0].id : "");
  const [fileType, setFileType] = useState<string>(FILE_TYPES[0]);
  /** v1: a bank statement belongs to one of the entity's active bank accounts (chosen by the person; preselected only when there is one). */
  const accounts = bankAccounts.filter((a) => a.entityId === entityId);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Bytes sent so far as a share of the file (0..1) while the request is uploading; null when not uploading. */
  const [progress, setProgress] = useState<number | null>(null);
  /** A JSON file with several lists: the server names them and the person chooses one (never guessed). */
  const [lists, setLists] = useState<string[]>([]);
  const pick = (f: File | null) => {
    setError(""); setLists([]);
    if (f && f.size > MAX_BYTES) { setFile(null); setError(`The file is ${mb(f.size)}; the largest file accepted is 20.0 MB. Split it into smaller files.`); return; }
    if (f && f.size === 0) { setFile(null); setError("The file is empty."); return; }
    setFile(f);
  };
  const drop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault(); setOver(false);
    const f = ev.dataTransfer.files?.[0] ?? null;
    if (f && input.current) { const dt = new DataTransfer(); dt.items.add(f); input.current.files = dt.files; }
    pick(f);
  };
  return (
    <form className={s.form} autoComplete="off" aria-describedby={`${id}-limits`} onSubmit={async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      if (!file) { setError("Choose a file to upload."); return; }
      setBusy(true); setError(""); setProgress(0);
      const r = await postWithProgress(API, f, setProgress);
      setProgress(null);
      if (!r.ok) {
        const choices = (r.data?.error as { code?: string; choices?: unknown } | undefined);
        if (choices?.code === "FILE_JSON_LIST_CHOICE" && Array.isArray(choices.choices)) setLists(choices.choices.filter((x): x is string => typeof x === "string"));
        setBusy(false); setError(r.message); return;
      }
      const up = r.data?.upload as { id: string; originalName: string };
      reloadWith(`upload:${up.id}`, `Stored “${up.originalName}”. Check the preview, then map its columns.`, `/control/merchant/uploads/${encodeURIComponent(up.id)}`);
    }}>
      <p className={s.hint} id={`${id}-limits`}>{LIMITS_TEXT}</p>
      <div className={m.formGrid}>
        <div className={s.field}>
          <label className={s.label} htmlFor={`${id}-entity`}>Entity</label>
          <select className={s.select} id={`${id}-entity`} name="entityId" required value={entityId} onChange={(ev) => setEntityId(ev.currentTarget.value)}>
            {entities.length === 1 ? null : <option value="" disabled>Choose an entity</option>}
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.id}, {e.currency})</option>)}
          </select>
        </div>
        <fieldset className={s.fieldset}>
          <legend>File type</legend>
          {FILE_TYPES.map((t, i) => (
            <div className={s.check} key={t}>
              <input type="radio" id={`${id}-${t}`} name="fileType" value={t} required defaultChecked={i === 0} aria-describedby={`${id}-${t}-hint`} onChange={(ev) => { if (ev.currentTarget.checked) setFileType(t); }} />
              <label htmlFor={`${id}-${t}`}>{FILE_TYPE_LABELS[t]} <span className={s.hint} id={`${id}-${t}-hint`}>{FILE_TYPE_HINTS[t]}</span></label>
            </div>
          ))}
        </fieldset>
        {fileType === "bank_statement" ? (
          <div className={s.field}>
            <label className={s.label} htmlFor={`${id}-account`}>Bank account</label>
            {accounts.length === 0 ? (
              <p className={s.hint} id={`${id}-account`} data-testid="no-bank-account">{entityId ? "This entity has no active bank account yet. Ask your administrator to add one; statements are uploaded to an account." : "Choose an entity first."}</p>
            ) : (
              <select className={s.select} id={`${id}-account`} name="bankAccountId" required key={entityId} defaultValue={accounts.length === 1 ? accounts[0].id : ""} aria-describedby={`${id}-account-h`}>
                {accounts.length === 1 ? null : <option value="" disabled>Choose a bank account</option>}
                {accounts.map((a) => <option key={a.id} value={a.id}>{bankAccountLabel(a)}</option>)}
              </select>
            )}
            <span className={s.hint} id={`${id}-account-h`}>The statement&rsquo;s lines must be in this account&rsquo;s currency.</span>
          </div>
        ) : null}
      </div>
      <div className={`${m.drop} ${g.drop} ${over ? `${m.dropOver} ${g.dropOver}` : ""} ${file ? g.dropChosen : ""}`} onDragOver={(ev) => { ev.preventDefault(); setOver(true); }} onDragEnter={(ev) => { ev.preventDefault(); setOver(true); }} onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setOver(false); }} onDrop={drop} data-testid="drop-zone">
        <span className={g.dropIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
        </span>
        <div className={g.dropBody}>
          <label className={s.label} htmlFor={`${id}-file`}>File</label>
          <input ref={input} className={m.fileInput} type="file" id={`${id}-file`} name="file" accept={ACCEPT} required aria-describedby={`${id}-drop`} onChange={(ev) => pick(ev.currentTarget.files?.[0] ?? null)} />
          <p className={s.hint} id={`${id}-drop`}>{over ? "Drop the file to choose it." : "Choose a file, or drag it onto this area."} {file ? <strong className={g.chosen}>Selected: <span className={g.mono}>{file.name}</span> ({mb(file.size)})</strong> : null}</p>
        </div>
      </div>
      {lists.length ? (
        <div className={s.field}>
          <label className={s.label} htmlFor={`${id}-list`}>Which list holds the records?</label>
          <select className={s.select} id={`${id}-list`} name="jsonList" required defaultValue="" aria-describedby={`${id}-list-h`}>
            <option value="" disabled>Choose a list</option>
            {lists.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <span className={s.hint} id={`${id}-list-h`}>This JSON file holds several lists. Choose the one with one record per row for this file type, then upload again. To use another list as another file type, upload the file again with that type.</span>
        </div>
      ) : null}
      <div><button type="submit" className={s.button} disabled={busy} aria-disabled={busy}>Upload file</button></div>
      {busy && progress !== null && file ? <UploadProgress sent={progress} size={file.size} /> : null}
      <p role={error ? "alert" : "status"} className={`${s.result} ${error ? s.resultError : s.resultOk}`}>{error ? `Refused: ${error}` : busy ? (progress !== null && progress < 1 ? "Uploading the file…" : "Uploading and reading the file…") : ""}</p>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ mapping

const DATE_WORDS: Record<string, string> = { iso: "Year-month-day (2026-11-30)", dmy: "Day/month/year (30/11/2026)", mdy: "Month/day/year (11/30/2026)", d_mon_y: "Day, month name, year (30 Nov 2026)", excel_serial: "Spreadsheet date numbers (46356)" };
const OFFSETS = [-720, -600, -480, -420, -360, -300, -240, -180, -120, -60, 0, 60, 120, 180, 240, 300, 330, 345, 360, 420, 480, 540, 570, 600, 660, 720, 780, 840];
const utc = (min: number) => `UTC${min < 0 ? "−" : "+"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
const CONSTANT = "__constant__";
/** rc7: the token contract as a mapping default the person confirms (configured tokens, by network and symbol). */
const DERIVE = "__derive__";
const isAmount = (d: FieldDef) => d.kind === "fiat_amount" || d.kind === "token_amount" || d.kind === "rate";
const isDate = (d: FieldDef) => d.kind === "date" || d.kind === "datetime";
/** A date-time column whose times may lack an offset: the person says which time zone they are in (never assumed). */
const needsZone = (d: FieldDef, det: ReturnType<typeof detectDateFormat> | null) =>
  d.kind === "datetime" && !!det && det.status !== "empty" && (det.status !== "decided" || (det.hasTime && det.offsets !== "all"));
const distinct = (values: string[]) => [...new Set(values.map((x) => x.trim()).filter((x) => x))].slice(0, 30);
/** A word's target: the person's choice, else the Clearline value it spells exactly ("Partially paid" → partially_paid). */
const word = (targets: readonly string[] | undefined, v: { words: Record<string, string> }, w: string) =>
  v.words[w] !== undefined ? v.words[w] : targets?.find((t) => t === w.toLowerCase().replace(/[\s-]+/g, "_")) ?? "";

interface FieldState { source: string; constant: string; dateFormat: string; offset: string; decimal: string; words: Record<string, string>; deduction: string }
export interface TemplateRef { id: string; name: string; version: number; mapping: Mapping }

function initial(def: FieldDef, base: ColumnMapping | undefined, proposal: string | undefined, currency: string): FieldState {
  const c = base;
  return {
    source: c?.derive ? DERIVE : c?.constant !== undefined ? CONSTANT : c?.header ?? (c ? "" : proposal ?? (def.kind === "currency" && def.allowConstant ? CONSTANT : "")),
    constant: c?.constant ?? (def.kind === "currency" ? currency : ""), dateFormat: c?.dateFormat ?? "", offset: c?.defaultUtcOffsetMinutes !== undefined ? String(c.defaultUtcOffsetMinutes) : "",
    decimal: c?.decimalSeparator ?? "", words: { ...(c?.statusValueMap ?? c?.networkValueMap ?? {}) }, deduction: c?.deductionSign ?? "",
  };
}

/** A status word that appears only further down the file (the preview shows the first 20 rows). */
function AddWord({ id, column, onAdd }: { id: string; column: string; onAdd: (word: string) => void }) {
  const [w, setW] = useState("");
  const add = () => { const x = w.trim(); if (x) { onAdd(x); setW(""); } };
  return (
    <div className={m.wordRow}>
      <label className={s.label} htmlFor={id}>Another word in {column}</label>
      <div className={s.row}>
        <input className={s.input} id={id} value={w} maxLength={80} onChange={(ev) => setW(ev.currentTarget.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } }} />
        <button type="button" className={`${s.button} ${s.buttonSecondary}`} onClick={add}>Add word</button>
      </div>
    </div>
  );
}

export function MappingForm({ uploadId, fileType, headers, rows, suggestion, current, exact, currency, entityName }: {
  uploadId: string; fileType: FileType; headers: string[]; rows: string[][]; suggestion: MappingSuggestion; current: Mapping | null; exact: TemplateRef | null; currency: string; entityName: string;
}) {
  const id = useId();
  const defs = fieldsOf(fileType);
  const base = current ?? exact?.mapping ?? null;
  const [state, setState] = useState<Record<string, FieldState>>(() => Object.fromEntries(defs.map((d) => [d.key, initial(d, base?.columns[d.key], base ? undefined : suggestion.proposal[d.key]?.header, currency)])));
  const [shape, setShape] = useState<string>(base?.shape ?? (fileType === "settlement_report" ? (suggestion.proposal.net || suggestion.proposal.gross ? "batch_totals" : suggestion.proposal.line_amount ? "per_payment_lines" : "") : ""));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tplName, setTplName] = useState(exact?.name ?? "");
  const [saved, setSaved] = useState<{ id: string; json: string; message: string } | null>(null);
  const [tplError, setTplError] = useState("");
  const column = (h: string) => { const i = headers.indexOf(h); return i < 0 ? [] : rows.map((r) => r[i] ?? ""); };
  const set = (key: string, patch: Partial<FieldState>) => { setState((x) => ({ ...x, [key]: { ...x[key], ...patch } })); setTouched((t) => new Set(t).add(key)); setSaved(null); };

  const plans = useMemo(() => Object.fromEntries(defs.map((d) => {
    const v = state[d.key];
    const values = v.source && v.source !== CONSTANT && v.source !== DERIVE ? column(v.source) : [];
    return [d.key, { values, date: isDate(d) && values.length ? detectDateFormat(values) : null, dec: isAmount(d) && values.length ? detectDecimalSeparator(values) : null }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [state, rows]);

  function build(): { mapping: Mapping; problems: string[] } {
    const columns: Record<string, ColumnMapping> = {};
    const problems: string[] = [];
    for (const d of defs) {
      const v = state[d.key], p = plans[d.key];
      if (!v.source) continue;
      if (v.source === DERIVE) { columns[d.key] = { derive: "network_and_symbol" }; continue; }
      const c: ColumnMapping = v.source === CONSTANT ? { constant: v.constant.trim() } : { header: v.source };
      if (fileType === "settlement_report" && d.key === "line_amount" && v.deduction === "negative") c.deductionSign = "negative";
      if (v.source === CONSTANT && !v.constant.trim()) problems.push(`${d.label}: type the fixed value, or choose a column.`);
      if (isAmount(d) && v.source !== CONSTANT) {
        const decided = p.dec?.status === "decided" ? p.dec.decimalSeparator : undefined;
        const sep = v.decimal || decided;
        if (sep) c.decimalSeparator = sep as "." | ",";
        else if (p.dec && p.dec.status !== "no_separators") problems.push(`${d.label}: choose the decimal separator.`);
      }
      if (isDate(d) && v.source !== CONSTANT) {
        const decided = p.date?.status === "decided" ? p.date.format : undefined;
        const f = v.dateFormat || decided;
        if (f) c.dateFormat = f;
        else if (p.date && p.date.status !== "empty") problems.push(`${d.label}: choose the date order.`);
        const needsOffset = needsZone(d, p.date);
        if (v.offset !== "") c.defaultUtcOffsetMinutes = Number(v.offset);
        else if (needsOffset) problems.push(`${d.label}: choose the time zone of times written without one.`);
      }
      const targets = STATUS_TARGETS[fileType]?.[d.key];
      if (targets && v.source !== CONSTANT) c.statusValueMap = Object.fromEntries([...distinct(p.values).map((w) => [w, word(targets, v, w)]), ...Object.entries(v.words)].filter(([, t]) => t));
      if (d.kind === "network" && v.source !== CONSTANT) { const w = Object.fromEntries(Object.entries(v.words).filter(([, t]) => t)); if (Object.keys(w).length) c.networkValueMap = w; }
      columns[d.key] = c;
    }
    if (fileType === "settlement_report" && !shape) problems.push("Choose whether the report has one row per payment or one row per batch.");
    const mapping: Mapping = { fileType, ...(fileType === "settlement_report" && shape ? { shape: shape as Mapping["shape"] } : {}), columns };
    return { mapping, problems };
  }
  function check(): Mapping | null {
    const { mapping, problems } = build();
    const v = validateMapping(mapping, headers);
    const all = [...problems, ...(v.ok ? [] : v.issues.map((i) => i.message))];
    setIssues(all);
    return all.length ? null : mapping;
  }

  const why = (d: FieldDef) => {
    const v = state[d.key];
    if (touched.has(d.key)) return "Chosen by you.";
    if (current) return "As confirmed earlier for this upload.";
    if (exact) return `From template “${exact.name}” v${exact.version}.`;
    if (!v.source) return d.required ? "No column looks like this field; choose one." : "No column looks like this field.";
    if (v.source === CONSTANT) return `Suggested: one ${d.label.toLowerCase()} for the whole file (${entityName}'s currency). Change it if the file says otherwise.`;
    const c = suggestion.fields.find((f) => f.field === d.key)?.candidates.find((x) => x.header === v.source);
    return c ? `Suggested because the ${c.why} (${Math.round(c.confidence * 100)}% match).` : "";
  };

  return (
    <form className={s.form} autoComplete="off" noValidate onSubmit={async (ev) => {
      ev.preventDefault();
      const mapping = check();
      if (!mapping) return;
      const json = JSON.stringify(mapping);
      const tpl = saved && saved.json === json ? saved.id : exact && !current && touched.size === 0 ? exact.id : null;
      setBusy(true);
      const r = await post(`${API}/${encodeURIComponent(uploadId)}/mapping`, tpl ? { templateId: tpl } : { mapping });
      if (!r.ok) { setBusy(false); setIssues([r.message]); return; }
      reloadWith(`mapping:${uploadId}`, `Mapping confirmed: ${Object.keys(mapping.columns).length} fields${tpl ? " (from a template)" : ""}. Next, validate every row.`);
    }}>
      {exact && !current ? <p role="status" className={m.notice} data-testid="template-applied">Mapping from template “{exact.name}” v{exact.version} applied — check and confirm.</p> : null}
      {!current && !exact ? <p className={s.hint}>Suggestions are filled in from the column names. Nothing is used until you press <strong>Confirm mapping</strong>.</p> : null}
      {fileType === "settlement_report" ? (
        <fieldset className={s.fieldset}>
          <legend>How is the report laid out? <span className={m.req}>Required</span></legend>
          {[["per_payment_lines", "One row per payment or refund line"], ["batch_totals", "One row per batch, with totals only"]].map(([v, l]) => (
            <div className={s.check} key={v}><input type="radio" id={`${id}-shape-${v}`} name="shape" value={v} checked={shape === v} onChange={() => { setShape(v); setSaved(null); }} /><label htmlFor={`${id}-shape-${v}`}>{l}</label></div>
          ))}
        </fieldset>
      ) : null}
      <ol className={m.fields}>
        {defs.map((d) => {
          const v = state[d.key], p = plans[d.key], fid = `${id}-${d.key}`;
          const targets = STATUS_TARGETS[fileType]?.[d.key];
          const words = (targets || d.kind === "network") && v.source && v.source !== CONSTANT && v.source !== DERIVE ? [...new Set([...distinct(p.values), ...Object.keys(v.words)])] : [];
          return (
            <li className={m.fieldRow} key={d.key} data-testid={`field-${d.key}`}>
              <div className={s.field}>
                <label className={s.label} htmlFor={fid}>{d.label} {d.required ? <span className={m.req}>Required</span> : <span className={m.opt}>Optional</span>}</label>
                <select className={s.select} id={fid} value={v.source} aria-describedby={`${fid}-why`} onChange={(ev) => set(d.key, { source: ev.currentTarget.value, dateFormat: "", decimal: "", words: {} })}>
                  <option value="">Not in this file</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  {d.allowConstant ? <option value={CONSTANT}>One fixed value for every row</option> : null}
                  {fileType === "provider_export" && d.key === "token_contract" ? <option value={DERIVE}>Work out from the network and token symbol (configured tokens)</option> : null}
                </select>
                <span className={s.hint} id={`${fid}-why`}>{why(d)}</span>
              </div>
              {v.source === DERIVE ? <p className={s.hint} role="note" data-testid="token-default">Each row&apos;s contract will be the one configured token on its network with its symbol. A row whose network and symbol match no token, or two, is rejected — nothing is guessed.</p> : null}
              {fileType === "settlement_report" && d.key === "line_amount" && v.source ? (
                <fieldset className={s.fieldset}>
                  <legend>Refunds and fees in {v.source} are written as</legend>
                  {[["", "Positive amounts"], ["negative", "Negative amounts (−20.00)"]].map(([val, l]) => (
                    <div className={s.check} key={val || "positive"}><input type="radio" id={`${fid}-ded-${val || "positive"}`} name={`${fid}-ded`} checked={v.deduction === val} onChange={() => set(d.key, { deduction: val })} /><label htmlFor={`${fid}-ded-${val || "positive"}`}>{l}</label></div>
                  ))}
                </fieldset>
              ) : null}
              {v.source === CONSTANT ? (
                <div className={s.field}>
                  <label className={s.label} htmlFor={`${fid}-const`}>Fixed {d.label.toLowerCase()}</label>
                  <input className={s.input} id={`${fid}-const`} value={v.constant} maxLength={d.kind === "currency" ? 3 : 200} onChange={(ev) => set(d.key, { constant: ev.currentTarget.value })} />
                </div>
              ) : null}
              {isAmount(d) && p.dec && p.dec.status !== "no_separators" ? (
                <fieldset className={s.fieldset}>
                  <legend>Decimal separator in {v.source}</legend>
                  {p.dec.status === "decided" ? <p className={s.hint}>Detected from the first rows: decimal {p.dec.decimalSeparator === "." ? "point (1,234.56)" : "comma (1.234,56)"}.</p>
                    : <p className={s.hint} role="note">{p.dec.status === "conflict" ? "The first rows mix both styles." : "The first rows read either way."} Choose how this column writes decimals.</p>}
                  {[[".", "Decimal point: 1,234.56"], [",", "Decimal comma: 1.234,56"]].map(([sep, l]) => (
                    <div className={s.check} key={sep}><input type="radio" id={`${fid}-dec-${sep === "." ? "point" : "comma"}`} name={`${fid}-dec`} checked={(v.decimal || (p.dec?.status === "decided" ? p.dec.decimalSeparator : "")) === sep} onChange={() => set(d.key, { decimal: sep })} /><label htmlFor={`${fid}-dec-${sep === "." ? "point" : "comma"}`}>{l}</label></div>
                  ))}
                </fieldset>
              ) : null}
              {isDate(d) && p.date && p.date.status !== "empty" ? (
                <fieldset className={s.fieldset}>
                  <legend>Date order in {v.source}</legend>
                  {p.date.status === "decided" ? <p className={s.hint}>Detected from the first rows: {DATE_WORDS[p.date.format]}.</p>
                    : <p className={s.hint} role="note">{p.date.status === "ambiguous" ? "Every date in the first rows could be day/month or month/day." : "The first rows do not decide the format."} Choose the order.</p>}
                  {(p.date.status === "ambiguous" ? ["dmy", "mdy"] : Object.keys(DATE_WORDS)).map((f) => (
                    <div className={s.check} key={f}><input type="radio" id={`${fid}-date-${f}`} name={`${fid}-date`} checked={(v.dateFormat || (p.date?.status === "decided" ? p.date.format : "")) === f} onChange={() => set(d.key, { dateFormat: f })} /><label htmlFor={`${fid}-date-${f}`}>{DATE_WORDS[f]}</label></div>
                  ))}
                </fieldset>
              ) : null}
              {needsZone(d, p.date) ? (
                <div className={s.field}>
                  <label className={s.label} htmlFor={`${fid}-tz`}>Time zone of times in {v.source} written without one</label>
                  <select className={s.select} id={`${fid}-tz`} value={v.offset} onChange={(ev) => set(d.key, { offset: ev.currentTarget.value })}>
                    <option value="">Choose a UTC offset</option>
                    {OFFSETS.map((o) => <option key={o} value={String(o)}>{utc(o)}</option>)}
                  </select>
                </div>
              ) : null}
              {words.length ? (
                <fieldset className={s.fieldset}>
                  <legend>{targets ? `What each word in ${v.source} means` : `Networks in ${v.source}`}</legend>
                  <p className={s.hint}>{targets ? "Words from the first rows. A row whose word is not mapped is rejected, never guessed." : "Usual network names are recognised; map any other word here."}</p>
                  {words.map((w, i) => (
                    <div className={m.wordRow} key={w}>
                      <label className={s.label} htmlFor={`${fid}-w${i}`}>“{w}”</label>
                      <select className={s.select} id={`${fid}-w${i}`} value={word(targets, v, w)} onChange={(ev) => set(d.key, { words: { ...v.words, [w]: ev.currentTarget.value } })}>
                        <option value="">{targets ? "Not mapped (row rejected)" : "Recognise automatically"}</option>
                        {(targets ?? NETWORK_IDS).map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                      </select>
                    </div>
                  ))}
                  {targets ? <AddWord id={`${fid}-add`} column={v.source} onAdd={(w) => set(d.key, { words: { ...v.words, [w]: v.words[w] ?? word(targets, { words: {} }, w) } })} /> : null}
                </fieldset>
              ) : null}
            </li>
          );
        })}
      </ol>
      {issues.length ? <div role="alert" className={m.issues}><p><strong>The mapping cannot be confirmed yet:</strong></p><ul>{issues.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
      <div className={m.actions}>
        <div className={m.inlineField}>
          <label className={s.label} htmlFor={`${id}-tpl`}>Template name</label>
          <input className={s.input} id={`${id}-tpl`} value={tplName} maxLength={120} onChange={(ev) => setTplName(ev.currentTarget.value)} aria-describedby={`${id}-tpl-hint`} />
          <span className={s.hint} id={`${id}-tpl-hint`}>Saved templates are offered again when a file with the same columns arrives. Saving again under the same name makes a new version.</span>
        </div>
        <button type="button" className={`${s.button} ${s.buttonSecondary}`} disabled={busy} onClick={async () => {
          setTplError("");
          if (!tplName.trim()) { setTplError("Type a name for the template."); return; }
          const mapping = check();
          if (!mapping) return;
          setBusy(true);
          const r = await post(`${API}/templates`, { fileType, name: tplName.trim(), headers, mapping });
          setBusy(false);
          if (!r.ok) { setTplError(r.message); return; }
          const t = r.data?.template as { id: string; name: string; version: number };
          setSaved({ id: t.id, json: JSON.stringify(mapping), message: `Saved template “${t.name}” version ${t.version}. Press Confirm mapping to use it for this file.` });
        }}>Save as template</button>
        <button type="submit" className={s.button} disabled={busy} aria-disabled={busy}>Confirm mapping</button>
      </div>
      <p role={tplError ? "alert" : "status"} className={`${s.result} ${tplError ? s.resultError : s.resultOk}`}>{tplError ? `Refused: ${tplError}` : saved?.message ?? (busy ? "Sending to the server…" : "")}</p>
    </form>
  );
}
