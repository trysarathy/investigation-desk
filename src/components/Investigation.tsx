"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { DRAFT_TEMPLATES } from "@/lib/templates";
import { CHAIN_NAMES, type Chain, type Evidence } from "@/lib/types";
import type { CaseView, VerdictView } from "@/lib/view";
import { useAssignments } from "./assignments";
import { Mono } from "./Mono";
import { ConfidenceLabel, Status } from "./Status";

const STATUS_TEXT = { pass: "Passed", warn: "Check", fail: "Failed", info: "Info" } as const;

export function Investigation({ view }: { view: CaseView }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(view.revealed);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedFindings, setConfirmedFindings] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState("");
  const { owners, assign } = useAssignments();

  const history = view.verdicts.slice(0, revealed);
  const v = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : undefined;
  const changed = prev && (prev.code !== v.code || prev.state !== v.state) ? prev : undefined;
  const owner = owners[view.id] ?? view.owner;
  const replyLocked = v.confidence === "Medium" && !confirmed;
  const replyText = draft ?? v.reply?.text ?? "";

  // A new verdict invalidates the analyst's confirmation and edits.
  useEffect(() => {
    setConfirmed(false);
    setConfirmedFindings({});
    setDraft(null);
    setEditing(false);
  }, [v]);

  const recheck = () => {
    if (checking) return;
    setChecking(true);
    // Fixture mode: the next stored snapshot stands in for a fresh fetch.
    setTimeout(() => {
      setRevealed((r) => Math.min(r + 1, view.verdicts.length));
      setChecking(false);
    }, 700);
  };

  const copy = () => {
    if (!v.reply || replyLocked) return;
    navigator.clipboard?.writeText(replyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".cmd")) return;
      if (e.key === "Escape") {
        if (editing) { setEditing(false); return; }
        router.push("/");
        return;
      }
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (e.key === "c") copy();
      else if (e.key === "e" && v.reply && !replyLocked) { e.preventDefault(); setEditing(true); }
      else if (e.key === "r") recheck();
      else if (e.key === "a") assign(view.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <Link href="/" className="muted">Cases</Link>
          <span className="faint">/</span>
          <h1 className="mono">{view.id}</h1>
          <span className="muted mono">{view.customerId}</span>
          <span className="badge">Sample data</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" type="button" onClick={recheck} disabled={checking}>Re-run checks <span className="kbd">R</span></button>
          <Link className="btn" href="/">Back <span className="kbd">Esc</span></Link>
        </div>
      </div>

      {changed && !checking && (
        <div className="bar bar-red fade-in" role="alert">
          <Status status="fail" label="Verdict changed" />
          <span>from <span className="code">{changed.state === "paused" ? "Paused" : changed.code}</span> to <span className="code">{v.state === "paused" ? "Paused" : v.code}</span> at {formatTime(v.checkedAt)}. History is kept below.</span>
        </div>
      )}

      <VerdictBar v={v} checking={checking} />

      {!checking && v.findings.map((f) => (
        <section key={f.code} className={`bar ${f.confidence === "Medium" ? "bar-amber" : "bar-info"}`} aria-label={`${f.confidence === "Medium" ? "Likely cause" : "Also found"}: ${f.label}`} style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {f.confidence === "Medium" ? <Status status="warn" label="Likely cause" /> : <Status status="info" label="Also found" />}
            <span className="code">{f.code}</span>
            <strong style={{ color: "var(--text)" }}>{f.label}</strong>
            <span>({f.confidence}, does not change the {v.code} verdict)</span>
          </div>
          <span style={{ color: "var(--text)" }}>{f.reason} {f.nextStep}</span>
          {f.confidence === "Medium" && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
              <input type="checkbox" checked={!!confirmedFindings[f.code]} onChange={(e) => setConfirmedFindings((c) => ({ ...c, [f.code]: e.target.checked }))} />
              {confirmedFindings[f.code] ? "Confirmed by analyst" : "I've checked the evidence and confirm this likely cause"}
            </label>
          )}
        </section>
      ))}

      <div className="cols">
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <section className="panel" aria-label="Evidence">
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
              <h2>Evidence</h2>
              <span className="faint">Highlighted rows are cited by the verdict</span>
            </div>
            {checking ? <TimelineSkeleton /> : (
              <ol className="timeline">
                {v.evidence.map((e, i) => <EvidenceRow key={e.id} e={e} cited={v.evidenceIds.includes(e.id) || v.findings.some((f) => f.evidenceIds.includes(e.id))} delay={i * 60} />)}
              </ol>
            )}
          </section>

          {!checking && v.state === "verdict" && <ChecksRun v={v} />}

          {history.length > 1 && (
            <section className="panel" aria-label="Verdict history" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <h2>Verdict history</h2>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {history.map((h, i) => (
                  <li key={i}><span className="code">{h.state === "paused" ? "Paused" : h.code}</span> {h.label} <span className="faint">at {formatTime(h.checkedAt)}</span></li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="side">
          <section className="panel" aria-label="Next step">
            <span className="section-title">Next step</span>
            <p style={{ margin: 0 }}>{v.nextStep}</p>
          </section>

          <section className="panel" aria-label="Case">
            <span className="section-title">Case</span>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "80px 1fr", gap: 4 }}>
              <dt className="muted">Owner</dt>
              <dd style={{ margin: 0 }}>
                {owner ?? <span className="faint">Unassigned</span>}{" "}
                {!owner && <button className="btn btn-sm" type="button" onClick={() => assign(view.id)}>Assign to me <span className="kbd">A</span></button>}
              </dd>
              <dt className="muted">Status</dt>
              <dd style={{ margin: 0 }}>{view.status === "resolved" ? "Resolved" : "Open"}</dd>
              <dt className="muted">Opened</dt>
              <dd style={{ margin: 0 }}>{formatTime(view.openedAt)}</dd>
            </dl>
          </section>

          <section className="panel" aria-label="Reply draft">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="section-title">Reply draft</span>
              {v.reply && !checking && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-sm" type="button" onClick={() => setEditing((x) => !x)} disabled={replyLocked}>{editing ? "Done" : "Edit"} <span className="kbd">E</span></button>
                  <button className="btn btn-sm btn-primary" type="button" onClick={copy} disabled={replyLocked}>{copied ? "Copied" : "Copy"} <span className="kbd">C</span></button>
                </div>
              )}
            </div>
            {checking ? <div className="skel" style={{ height: 64 }} /> : v.state === "paused" ? (
              <p className="muted" style={{ margin: 0 }}>No reply while the check is paused.</p>
            ) : v.code === "D99" ? (
              <>
                <p className="muted" style={{ margin: 0 }}>No reply draft for an unknown verdict. Record what you find.</p>
                <textarea className="input" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Investigation notes" aria-label="Investigation notes" />
              </>
            ) : !v.reply ? (
              <p className="muted" style={{ margin: 0 }}>No approved template for {v.code} yet. Write the reply by hand.</p>
            ) : (
              <>
                {v.confidence === "Medium" && (
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
                    <span>I've checked the evidence and confirm this verdict. The reply stays locked until then.</span>
                  </label>
                )}
                {editing ? (
                  <textarea className="input" rows={6} value={replyText} onChange={(e) => setDraft(e.target.value)} aria-label="Edit reply" autoFocus />
                ) : (
                  <div className="reply" aria-disabled={replyLocked} style={replyLocked ? { opacity: 0.55 } : undefined}>
                    <ReplyText text={replyText} />
                  </div>
                )}
                {/\{\w+\}/.test(replyText) && <p className="s-warn" style={{ margin: 0, fontSize: 12 }}>Fill the highlighted fields before sending.</p>}
                <p className="faint" style={{ margin: 0, fontSize: 12 }}>
                  {DRAFT_TEMPLATES.has(v.code) ? `Draft ${v.code} wording, pending the spec text.` : `From the approved ${v.code} template.`} Every value comes from the evidence.
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function VerdictBar({ v, checking }: { v: VerdictView; checking: boolean }) {
  if (checking) {
    return (
      <div className="verdict-bar" role="status" aria-live="polite">
        <div className="verdict-title">Checking {v.checkingChain === "all chains" ? "all chains" : CHAIN_NAMES[v.checkingChain as Chain]}…</div>
      </div>
    );
  }
  const cls = v.state === "paused" ? "paused" : v.code === "D99" ? "unknown" : v.confidence === "Medium" ? "medium" : "";
  const title = v.state === "paused"
    ? `Check paused: ${v.pausedChains.map((c) => CHAIN_NAMES[c]).join(", ")} not responding`
    : v.code === "D99" ? "No rule matched." : v.confidence === "Medium" ? `Likely: ${v.label.toLowerCase()}` : v.label;
  const n = v.checks.length;
  return (
    <div className={`verdict-bar ${cls}`} role="status" aria-live="polite">
      {v.state === "verdict" && <span className="verdict-code">{v.code}</span>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 240 }}>
        <div className="verdict-title">{title}</div>
        <div className="muted">
          {v.state === "paused"
            ? `No verdict is guessed while a chain is unreachable. Last attempt ${formatTime(v.checkedAt)}.`
            : v.confidence === "Medium"
              ? `Likely — confirm before replying. Based on ${n} checks at ${formatTime(v.checkedAt)}.`
              : `Based on ${n} checks at ${formatTime(v.checkedAt)}.`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <span className="faint" style={{ fontSize: 12 }}>Confidence</span>
        <ConfidenceLabel confidence={v.confidence} paused={v.state === "paused"} />
      </div>
    </div>
  );
}

function EvidenceRow({ e, cited, delay }: { e: Evidence; cited: boolean; delay: number }) {
  return (
    <li className={`fade-in${cited ? " cited" : ""}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="tl-label" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>{e.label}</span>
        <span className={`status s-${e.status}`} style={{ fontSize: 12 }}>
          <Status status={e.status} label={STATUS_TEXT[e.status]} />
        </span>
      </div>
      <div className="tl-value">
        <span>{e.value}</span>
        {e.mono?.map((m) => (
          <span key={m.label} className="tl-mono"><span className="k">{m.label}</span><Mono value={m.value} head={8} tail={8} /></span>
        ))}
        {e.detail && <span className="tl-detail">{e.detail}</span>}
      </div>
      <div className="tl-source"><Source e={e} /></div>
    </li>
  );
}

function Source({ e }: { e: Evidence }) {
  const s = e.source;
  switch (s.kind) {
    case "explorer":
      return <a href={s.url} target="_blank" rel="noreferrer" title="Sample hash: the explorer will not find it">Explorer ↗</a>;
    case "ledger":
      return <span className="muted">Ledger row {s.row}</span>;
    case "addresses":
      return <span className="muted">File A row {s.row}</span>;
    case "settings":
      return <Link href="/settings?tab=rules" className="muted">Settings</Link>;
    case "input":
      return <span className="muted">Ticket</span>;
    case "provider":
      return <span className="muted">{s.provider} {s.reference}</span>;
    default:
      return null;
  }
}

function ChecksRun({ v }: { v: VerdictView }) {
  return (
    <details className="panel checks">
      <summary>
        <h2>Checks run</h2>
        <span className="muted">{v.checks.filter((c) => c.matched).length} matched of {v.checks.length}</span>
      </summary>
      <table className="table">
        <thead><tr><th>Code</th><th>Result</th><th>Reason</th></tr></thead>
        <tbody>
          {v.checks.map((c) => (
            <tr key={c.code} style={{ cursor: "default" }}>
              <td className="code">{c.code}</td>
              <td>{c.matched ? <Status status="warn" label={`Matched (${c.confidence})`} /> : <Status status="info" label="No match" />}</td>
              <td className="muted">{c.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="faint" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <span>Reproducible with {v.record.ruleVersion} and {v.record.settingsVersion}.</span>
        {v.record.evidenceHashes.length > 0 && (
          <span>Response SHA-256: {v.record.evidenceHashes.map((h) => `${h.chain} ${h.sha256.slice(0, 12)}`).join(" · ")}</span>
        )}
      </div>
    </details>
  );
}

function TimelineSkeleton() {
  return (
    <ol className="timeline" aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i}><div className="skel" style={{ width: 90 }} /><div className="skel" /><div className="skel" style={{ width: 60 }} /></li>
      ))}
    </ol>
  );
}

function ReplyText({ text }: { text: string }) {
  const parts = text.split(/(\{\w+\})/g);
  return <>{parts.map((p, i) => (/^\{\w+\}$/.test(p) ? <span key={i} className="placeholder">{p}</span> : <span key={i}>{p}</span>))}</>;
}
