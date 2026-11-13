"use client";
import Link from "next/link";
import { useState } from "react";
import type { ComplianceHold } from "@/lib/clearline";
import { errorText, useWorkspace } from "../workspace";
import { HoldChip, human } from "../labels";
import { Btn, Dl, Empty, Field, Notice, PageHead, Panel, Status, fmtTime, ui } from "../ui";

function HoldCard({ h }: { h: ComplianceHold }) {
  const { dispatch, actors, actorName, actor } = useWorkspace();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [docs, setDocs] = useState(h.requestedDocuments.join(", "));
  const [reviewer, setReviewer] = useState(h.reviewerId ?? actors.find((a) => a.role === "compliance")?.id ?? "");
  const [decision, setDecision] = useState<"release" | "reject" | "request_more">("request_more");
  const [reason, setReason] = useState("");
  const run = (label: string, r: ReturnType<typeof dispatch>) =>
    setMsg(r.ok ? { text: `${label}: recorded.` } : { text: `${label} not recorded — ${errorText(r)}`, error: true });
  const closed = h.status === "released" || h.status === "rejected";

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
            <form onSubmit={(e) => { e.preventDefault(); run("Documents submitted", dispatch({ type: "submit_hold_documents", holdId: h.id, documents: docs.split(",").map((s) => s.trim()).filter(Boolean) })); }}>
              <Field label="Submit document names (metadata only)" hint="Comma-separated. No files are uploaded."><input value={docs} onChange={(e) => setDocs(e.target.value)} /></Field>
              <Btn type="submit" size="small" style={{ marginTop: 6 }}>Submit documents</Btn>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); run("Reviewer assigned", dispatch({ type: "assign_hold_reviewer", holdId: h.id, reviewerId: reviewer })); }}>
              <Field label="Assign reviewer"><select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>{actors.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}</select></Field>
              <Btn type="submit" size="small" style={{ marginTop: 6 }}>Assign reviewer</Btn>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); run("Reviewer decision", dispatch({ type: "record_hold_decision", holdId: h.id, decision, reason })); setReason(""); }}>
              <Field label="Reviewer's decision (recorded, not made by Clearline)">
                <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="request_more">Request more information</option>
                  <option value="release">Reviewer decided: release</option>
                  <option value="reject">Reviewer decided: reject</option>
                </select>
              </Field>
              <Field label="Reason (required)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <p className={ui.hint}>Recording as {actor ? `${actor.name} (${actor.role})` : "—"}. Only the assigned compliance reviewer can record a decision.</p>
              <Btn type="submit" size="small" disabled={!reason.trim()}>Record reviewer decision</Btn>
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
      <PageHead eyebrow="Control" title="Compliance holds"
        lede="Holds are placed by the partner. Clearline records documents, the reviewer and the reviewer's decision; it never decides or releases a hold by itself." />
      <Notice>There is no release button. To record a decision, switch “Acting as” to the assigned compliance reviewer.</Notice>
      {ws.holds.length === 0 ? <Panel><Empty>No compliance holds in this workspace.</Empty></Panel> : ws.holds.map((h) => <HoldCard key={h.id} h={h} />)}
    </>
  );
}
