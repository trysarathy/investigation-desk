"use client";
import { useState } from "react";
import { canResolveCase, canResolveException, type EvidenceKind, type TargetRef } from "@/lib/clearline";
import { useWorkspace } from "./workspace";
import { ActionButton, gateOf, useRun, useSettled, type Gate } from "./Action";
import { describeResolution, label } from "./human";
import { Field, Status, ui } from "./ui";

const EVIDENCE_KINDS: EvidenceKind[] = [
  "document_metadata", "bank_statement_line", "provider_settlement_report", "funds_returned_confirmation", "beneficiary_correction", "note",
];

/**
 * Case / exception actions. Every action goes to the engine; the engine decides whether it is
 * allowed (dry run before the click) and the UI shows its reason in words when not.
 */
export function TargetActions({ target, status, idPrefix }: { target: TargetRef; status: string; idPrefix: string }) {
  const { ws, preview, actors } = useWorkspace();
  const { msg, run } = useRun();
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

  const resolved = status === "resolved";
  const id = (s: string) => `${idPrefix}-${s}`;
  // Dry runs use what the person typed (settled), so the gate matches what the engine will decide.
  const tNote = useSettled(note), tInfoFrom = useSettled(infoFrom), tInfoReq = useSettled(infoReq), tEvDesc = useSettled(evDesc);
  const tEvName = useSettled(evName), tEvRef = useSettled(evRef), tResolution = useSettled(resolution), tReopen = useSettled(reopenReason);

  const gAssign = gateOf(preview({ type: "assign_owner", target, ownerId: owner }), ws);
  const gNote = gateOf(preview({ type: "add_note", target, text: tNote }), ws, !note.trim() && "Write a note first.");
  const gInfo = target.kind === "case" ? gateOf(preview({ type: "request_info", caseId: target.id, from: tInfoFrom, request: tInfoReq }), ws, !infoReq.trim() && "Describe what you need first.") : null;
  const gEvidence = gateOf(preview({ type: "attach_evidence", target, evidence: { kind: evKind, description: tEvDesc, documentName: tEvName || undefined, reference: tEvRef || undefined } }), ws, !evDesc.trim() && "Describe the evidence first.");
  const check = target.kind === "exception" ? canResolveException(ws, target.id) : canResolveCase(ws, target.id);
  const gResolve: Gate = !check.allowed
    ? { ok: false, reason: describeResolution(check.code, check.reason, ws, target.id), code: check.code }
    : gateOf(preview({ type: "resolve", target, note: tResolution }), ws, !resolution.trim() && "Write a resolution note first.");
  const gReopen = gateOf(preview({ type: "reopen", target, reason: tReopen }), ws, !reopenReason.trim() && "Give a reason to reopen first.");

  return (
    <div className={ui.panelBody}>
      <Status msg={msg} />
      <div className={ui.formGrid}>
        <form onSubmit={(e) => { e.preventDefault(); run("Assign owner", { type: "assign_owner", target, ownerId: owner }); }}>
          <Field label="Assign owner">
            <select id={id("owner")} value={owner} onChange={(e) => setOwner(e.target.value)}>
              {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gAssign}>Assign owner</ActionButton></div>
        </form>
        <form onSubmit={(e) => { e.preventDefault(); run("Add note", { type: "add_note", target, text: note }, { onOk: () => setNote("") }); }}>
          <Field label="Add note"><textarea id={id("note")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and what you found" /></Field>
          <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gNote}>Add note</ActionButton></div>
        </form>
        {target.kind === "case" && gInfo && (
          <form onSubmit={(e) => { e.preventDefault(); run("Request information", { type: "request_info", caseId: target.id, from: infoFrom, request: infoReq }, { onOk: () => setInfoReq("") }); }}>
            <Field label="Request information from"><input id={id("info-from")} value={infoFrom} onChange={(e) => setInfoFrom(e.target.value)} /></Field>
            <Field label="Request"><input id={id("info-req")} value={infoReq} onChange={(e) => setInfoReq(e.target.value)} placeholder="e.g. Confirm the beneficiary account name" /></Field>
            <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gInfo}>Request information</ActionButton></div>
          </form>
        )}
        <form onSubmit={(e) => {
          e.preventDefault();
          run("Attach evidence", { type: "attach_evidence", target, evidence: { kind: evKind, description: evDesc, documentName: evName || undefined, reference: evRef || undefined } },
            { onOk: () => { setEvDesc(""); setEvName(""); setEvRef(""); } });
        }}>
          <Field label="Attach evidence (metadata only)" hint="File contents are never uploaded or stored.">
            <select id={id("ev-kind")} value={evKind} onChange={(e) => setEvKind(e.target.value as EvidenceKind)}>
              {EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{label("evidenceKind", k)}</option>)}
            </select>
          </Field>
          <Field label="Description"><input id={id("ev-desc")} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} /></Field>
          <Field label="Document name (optional)"><input id={id("ev-name")} value={evName} onChange={(e) => setEvName(e.target.value)} placeholder="statement-2026-11.pdf" /></Field>
          <Field label="Reference (optional)"><input id={id("ev-ref")} value={evRef} onChange={(e) => setEvRef(e.target.value)} /></Field>
          <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gEvidence}>Attach evidence metadata</ActionButton></div>
        </form>
        {!resolved ? (
          <form onSubmit={(e) => { e.preventDefault(); run(target.kind === "case" ? "Close case" : "Resolve exception", { type: "resolve", target, note: resolution }, { onOk: () => setResolution("") }); }}>
            <Field label="Resolution note"><textarea id={id("resolve")} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
            <div style={{ marginTop: 6 }} data-testid="resolve-gate"><ActionButton type="submit" size="small" gate={gResolve} name="Resolve">Resolve</ActionButton></div>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); run("Reopen", { type: "reopen", target, reason: reopenReason }, { onOk: () => setReopenReason("") }); }}>
            <Field label="Reason to reopen"><textarea id={id("reopen")} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} /></Field>
            <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gReopen}>Reopen</ActionButton></div>
          </form>
        )}
      </div>
    </div>
  );
}
