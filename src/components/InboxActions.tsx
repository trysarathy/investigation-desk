"use client";

// Actions on one inbox item: status (with a reason to close or reopen), owner, follow-up date,
// notes; for a matching review, confirm or reject a candidate with a reason.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { INBOX_STATUSES, STATUS_LABELS, type InboxStatus } from "@/lib/payments/inbox";
import { useActor } from "./ActingAs";

export function InboxActions({ itemId, status, owner, followUp, kind }: { itemId: string; status: InboxStatus; owner?: string; followUp?: string; kind: "exception" | "review" }) {
  const router = useRouter();
  const actor = useActor();
  const [to, setTo] = useState<InboxStatus | "">("");
  const [why, setWhy] = useState("");
  const [ownerDraft, setOwnerDraft] = useState(owner ?? "");
  const [date, setDate] = useState(followUp ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | undefined>();
  const send = async (action: object) => {
    setMsg(undefined);
    const res = await fetch(`/api/inbox/${encodeURIComponent(itemId)}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, action }) });
    const json = await res.json();
    if (json.error) { setMsg(json.error); return false; }
    router.refresh();
    return true;
  };
  const allowed = INBOX_STATUSES.filter((s) => s !== status && (status === "closed" ? s === "reopened" : s !== "reopened") && !(kind === "review" && s === "closed"));
  return (
    <section className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} aria-label="Actions">
      <h2>Actions</h2>
      {!actor && <div className="bar bar-amber">Set Acting as above: every change records who made it.</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={to} onChange={(e) => setTo(e.target.value as InboxStatus)} aria-label="New status">
          <option value="">Change status…</option>
          {allowed.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        {(to === "closed" || to === "reopened") && <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={`Why it is being ${to}`} style={{ minWidth: 280 }} aria-label="Reason" />}
        <button className="btn" disabled={!to || !actor} onClick={async () => { if (await send({ kind: "status", to, why })) { setTo(""); setWhy(""); } }}>Apply</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)} placeholder="Owner" maxLength={60} aria-label="Owner" />
        <button className="btn" disabled={!actor || ownerDraft === (owner ?? "")} onClick={() => void send({ kind: "owner", owner: ownerDraft })}>Set owner</button>
        <button className="btn btn-sm" disabled={!actor || owner === actor} onClick={() => { setOwnerDraft(actor); void send({ kind: "owner", owner: actor }); }}>Take it</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Follow-up date" />
        <button className="btn" disabled={!actor || date === (followUp ?? "")} onClick={() => void send({ kind: "follow_up", date })}>Set follow-up</button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (no customer names or personal data)" rows={2} style={{ flex: 1 }} aria-label="Note" />
        <button className="btn" disabled={!actor || !note.trim()} onClick={async () => { if (await send({ kind: "note", text: note })) setNote(""); }}>Add note</button>
      </div>
      {msg && <div className="bar bar-red" role="alert">{msg}</div>}
    </section>
  );
}

export function ReviewDecide({ reviewId, candidates }: { reviewId: string; candidates: { recordId: string; label: string; reserved?: string; rank?: string }[] }) {
  const router = useRouter();
  const actor = useActor();
  const [why, setWhy] = useState("");
  const [msg, setMsg] = useState<string | undefined>();
  const decide = async (recordId: string, action: "confirm" | "reject") => {
    setMsg(undefined);
    const res = await fetch("/api/inbox/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, reviewId, recordId, action, why }) });
    const json = await res.json();
    if (json.error) setMsg(json.error);
    else { setWhy(""); router.refresh(); }
  };
  return (
    <section className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} aria-label="Resolve review">
      <h2>Resolve this review</h2>
      <p className="muted" style={{ margin: 0 }}>Confirm the right candidate, or reject a wrong one. The decision is kept with your name, the time and your reason, and applies on every later matching run.</p>
      <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why (required), e.g. what the provider confirmed" aria-label="Reason for the decision" />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Candidate</th><th>Ranking (never links)</th><th /></tr></thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.recordId} style={{ cursor: "default" }}>
                <td style={{ whiteSpace: "normal" }}>{c.label}{c.reserved && <> · held under <a href={`/payments/${c.reserved}`} className="mono">{c.reserved}</a> (reserved)</>}</td>
                <td className="faint" style={{ whiteSpace: "normal" }}>{c.rank ?? "—"}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-sm btn-primary" disabled={!actor || !why.trim()} onClick={() => void decide(c.recordId, "confirm")}>Confirm</button>
                  <button className="btn btn-sm" disabled={!actor || !why.trim()} onClick={() => void decide(c.recordId, "reject")}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="bar bar-red" role="alert">{msg}</div>}
    </section>
  );
}
