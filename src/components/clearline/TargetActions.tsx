"use client";
import { useState } from "react";
import { canResolveException, type EvidenceKind, type TargetRef } from "@/lib/clearline";
import { errorText, useWorkspace } from "./workspace";
import { Btn, Field, Status, ui } from "./ui";

const EVIDENCE_KINDS: [EvidenceKind, string][] = [
  ["document_metadata", "Document metadata"],
  ["bank_statement_line", "Bank statement line reference"],
  ["provider_settlement_report", "Provider settlement report"],
  ["funds_returned_confirmation", "Funds returned confirmation"],
  ["beneficiary_correction", "Beneficiary correction"],
  ["note", "Note"],
];

type Msg = { text: string; error?: boolean } | null;

/**
 * Case / exception actions. Every action goes to the engine; the engine decides whether it is
 * allowed and the UI shows its reason when not.
 */
export function TargetActions({ target, status, idPrefix }: { target: TargetRef; status: string; idPrefix: string }) {
  const { ws, dispatch, actors } = useWorkspace();
  const [msg, setMsg] = useState<Msg>(null);
  const [owner, setOwner] = useState(actors[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [infoFrom, setInfoFrom] = useState("Provider operations (sandbox)");
  const [infoReq, setInfoReq] = useState("");
  const [evKind, setEvKind] = useState<EvidenceKind>("document_metadata");
  const [evDesc, setEvDesc] = useState("");
  const [evName, setEvName] = useState("");
  const [evRef, setEvRef] = useState("");
  const [resolution, setResolution] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  const run = (label: string, fn: () => ReturnType<typeof dispatch>, clear?: () => void) => {
    const r = fn();
    if (r.ok) { setMsg({ text: `${label}: recorded.` }); clear?.(); }
    else setMsg({ text: `${label} not applied — ${errorText(r)}`, error: true });
  };

  const resolved = status === "resolved";
  const gate = target.kind === "exception" ? canResolveException(ws, target.id) : null;
  const id = (s: string) => `${idPrefix}-${s}`;

  return (
    <div className={ui.panelBody}>
      <Status msg={msg} />
      <div className={ui.formGrid}>
        <form onSubmit={(e) => { e.preventDefault(); run("Owner assigned", () => dispatch({ type: "assign_owner", target, ownerId: owner })); }}>
          <Field label="Assign owner">
            <select id={id("owner")} value={owner} onChange={(e) => setOwner(e.target.value)}>
              {actors.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
            </select>
          </Field>
          <Btn type="submit" size="small" style={{ marginTop: 6 }}>Assign owner</Btn>
        </form>
        <form onSubmit={(e) => { e.preventDefault(); run("Note", () => dispatch({ type: "add_note", target, text: note }), () => setNote("")); }}>
          <Field label="Add note"><textarea id={id("note")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and what you found" /></Field>
          <Btn type="submit" size="small" style={{ marginTop: 6 }} disabled={!note.trim()}>Add note</Btn>
        </form>
        {target.kind === "case" && (
          <form onSubmit={(e) => { e.preventDefault(); run("Information request", () => dispatch({ type: "request_info", caseId: target.id, from: infoFrom, request: infoReq }), () => setInfoReq("")); }}>
            <Field label="Request information from"><input id={id("info-from")} value={infoFrom} onChange={(e) => setInfoFrom(e.target.value)} /></Field>
            <Field label="Request"><input id={id("info-req")} value={infoReq} onChange={(e) => setInfoReq(e.target.value)} placeholder="e.g. Confirm the beneficiary account name" /></Field>
            <Btn type="submit" size="small" style={{ marginTop: 6 }} disabled={!infoReq.trim()}>Request information</Btn>
          </form>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          run("Evidence metadata", () => dispatch({ type: "attach_evidence", target, evidence: { kind: evKind, description: evDesc, documentName: evName || undefined, reference: evRef || undefined } }),
            () => { setEvDesc(""); setEvName(""); setEvRef(""); });
        }}>
          <Field label="Attach evidence (metadata only)" hint="File contents are never uploaded or stored.">
            <select id={id("ev-kind")} value={evKind} onChange={(e) => setEvKind(e.target.value as EvidenceKind)}>
              {EVIDENCE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Description"><input id={id("ev-desc")} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} /></Field>
          <Field label="Document name (optional)"><input id={id("ev-name")} value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="statement-2026-11.pdf" /></Field>
          <Field label="Reference (optional)"><input id={id("ev-ref")} value={evRef} onChange={(e) => setEvRef(e.target.value)} /></Field>
          <Btn type="submit" size="small" style={{ marginTop: 6 }} disabled={!evDesc.trim()}>Attach evidence metadata</Btn>
        </form>
        {!resolved ? (
          <form onSubmit={(e) => { e.preventDefault(); run("Resolve", () => dispatch({ type: "resolve", target, note: resolution }), () => setResolution("")); }}>
            <Field label="Resolution note"><textarea id={id("resolve")} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
            {gate && !gate.allowed && (
              <p className={ui.err} data-testid="resolve-blocked">Cannot resolve yet: {gate.reason} <code>{gate.code}</code></p>
            )}
            {target.kind === "case" && <p className={ui.hint}>The engine checks whether this case can close; if it cannot, the reason appears above.</p>}
            <Btn type="submit" size="small" style={{ marginTop: 6 }} disabled={(gate ? !gate.allowed : false) || !resolution.trim()}>Resolve</Btn>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); run("Reopen", () => dispatch({ type: "reopen", target, reason: reopenReason }), () => setReopenReason("")); }}>
            <Field label="Reason to reopen"><textarea id={id("reopen")} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} /></Field>
            <Btn type="submit" size="small" style={{ marginTop: 6 }} disabled={!reopenReason.trim()}>Reopen</Btn>
          </form>
        )}
      </div>
    </div>
  );
}
