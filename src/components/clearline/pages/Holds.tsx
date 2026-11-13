"use client";
import Link from "../Link";
import { useState } from "react";
import { ActionButton, gateOf, useRun } from "../Action";
import type { ComplianceHold } from "@/lib/clearline";
import { useWorkspace } from "../workspace";
import { HoldChip, human } from "../labels";
import { Dl, Empty, Field, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";

function HoldCard({ h }: { h: ComplianceHold }) {
  const { ws, preview, actors, actorName, actor } = useWorkspace();
  const { msg, run } = useRun();
  const [docs, setDocs] = useState(h.requestedDocuments.join(", "));
  const [reviewer, setReviewer] = useState(h.reviewerId ?? actors.find((a) => a.role === "compliance")?.id ?? "");
  const [decision, setDecision] = useState<"release" | "reject" | "request_more">("request_more");
  const [reason, setReason] = useState("");
  const closed = h.status === "released" || h.status === "rejected";
  const docList = docs.split(",").map((s) => s.trim()).filter(Boolean);
  const aDocs = { type: "submit_hold_documents", holdId: h.id, documents: docList } as const;
  const aReviewer = { type: "assign_hold_reviewer", holdId: h.id, reviewerId: reviewer } as const;
  const aDecision = { type: "record_hold_decision", holdId: h.id, decision, reason: reason || "Dry run" } as const;
  const gDocs = gateOf(closed ? null : preview(aDocs), ws, !docList.length && "List at least one document name first.");
  const gReviewer = gateOf(closed ? null : preview(aReviewer), ws);
  const gDecision = gateOf(closed ? null : preview(aDecision), ws);
  const gDecisionInput = gDecision.ok && !reason.trim() ? { ok: false as const, reason: "Give the reviewer's reason first." } : gDecision;

  return (
    <Panel id={h.id} title={<>Hold on <Link href={`/clearline/payments/${h.intentId}`} className="mono">{h.intentId}</Link></>} actions={<HoldChip v={h.status} />}>
      <div className={ui.panelBody}>
        <Dl items={[
          ["Reported by", `Partner (${h.providerId})`],
          ["Reason", h.reason],
          ["Requested documents", h.requestedDocuments.join(", ") || "—"],
          ["Submitted documents", h.submittedDocuments.length ? h.submittedDocuments.map((d) => `${d.name} (${fmtTime(d.at)})`).join(", ") : "None yet"],
          ["Reviewer", actorName(h.reviewerId)],
          ["Partner release reported", h.partnerReleaseReportedAt ? fmtTime(h.partnerReleaseReportedAt) : "No"],
          ["Automatic release", "Never — a person records every decision"],
        ]} />
        {h.decisions.length > 0 && (
          <>
            <h3 style={{ fontSize: 13, margin: "14px 0 4px" }}>Reviewer decisions</h3>
            <ul style={{ margin: 0 }}>{h.decisions.map((d, i) => <li key={i}>{human(d.decision)} — {d.reason} <span className={ui.hint}>({actorName(d.reviewerId)}, {fmtTime(d.at)})</span></li>)}</ul>
          </>
        )}
        <Status msg={msg} />
        {!closed && (
          <div className={ui.formGrid} style={{ marginTop: 12 }}>
            <form onSubmit={(e) => { e.preventDefault(); run("Submit documents", aDocs); }}>
              <Field label="Submit document names (metadata only)" hint="Comma-separated. No files are uploaded."><input value={docs} onChange={(e) => setDocs(e.target.value)} /></Field>
              <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gDocs}>Submit documents</ActionButton></div>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); run("Assign reviewer", aReviewer); }}>
              <Field label="Assign reviewer"><select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>{actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <div style={{ marginTop: 6 }}><ActionButton type="submit" size="small" gate={gReviewer}>Assign reviewer</ActionButton></div>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); run("Record reviewer decision", { ...aDecision, reason }, { onOk: () => setReason("") }); }}>
              <Field label="Reviewer's decision (recorded, not made by Clearline)">
                <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="request_more">Request more information</option>
                  <option value="release">Reviewer decided: release</option>
                  <option value="reject">Reviewer decided: reject</option>
                </select>
              </Field>
              <Field label="Reason (required)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <p className={ui.hint}>Recording as {actor ? `${actor.name} (${actor.role})` : "—"}. Only the assigned compliance reviewer can record a decision.</p>
              <ActionButton type="submit" size="small" gate={gDecisionInput}>Record reviewer decision</ActionButton>
            </form>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function Holds() {
  const { ws } = useWorkspace();
  return (
    <>
      <PageHead eyebrow="Oversight" title="Compliance holds"
        lede="Holds are placed by the partner. Clearline records documents, the reviewer and the reviewer's decision; it never decides or releases a hold by itself." />
      <Notice>There is no release button. To record a decision, switch “Acting as” to the assigned compliance reviewer.</Notice>
      {ws.holds.length === 0 ? <Panel><Empty>No compliance holds in this workspace.</Empty></Panel> : ws.holds.map((h) => <HoldCard key={h.id} h={h} />)}
    </>
  );
}
