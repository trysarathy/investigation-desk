"use client";

// Decisions, owner, notes and live lookups for one request. Every action names who did it (Acting
// as) and goes to the server, which checks it is allowed in the request's current state.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActingAs, useActor } from "@/components/ActingAs";

type DecisionKind = "request_balance" | "accept_short" | "accept_over" | "dismiss_transfer" | "assign_transfer" | "acknowledge";
export interface TransferOption { key: string; label: string }

const COPY: Record<DecisionKind, { button: string; hint: string; placeholder: string }> = {
  acknowledge: { button: "Acknowledge payment", hint: "Do this once the customer is credited or the invoice is marked paid in your own system. It completes the request.", placeholder: "Optional, e.g. ledger reference" },
  request_balance: { button: "Ask for the balance", hint: "Keeps the request open until the rest arrives.", placeholder: "e.g. Emailed the customer the remaining amount" },
  accept_short: { button: "Accept as settled", hint: "Completes the request with less than requested. Recorded with your reason.", placeholder: "Why, e.g. agreed discount" },
  accept_over: { button: "Accept, handle the difference", hint: "Completes the request; refunds or credits for the difference happen outside this app.", placeholder: "e.g. Refund of the difference agreed with the customer" },
  dismiss_transfer: { button: "Not a payment for this request", hint: "The transfer stays on file with its evidence; it just stops counting against the request.", placeholder: "Why, e.g. counterfeit token; customer told" },
  assign_transfer: { button: "Assign to this request", hint: "Only when you have proof beyond the amount (remittance advice, sender address on file).", placeholder: "Your evidence, e.g. remittance advice received" },
};

async function post(id: string, actor: string, action: object): Promise<string | null> {
  try {
    const r = await fetch(`/api/requests/${encodeURIComponent(id)}/action`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, action }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? (j.message ?? null) : (j.error ?? `Failed (${r.status}).`);
  } catch {
    return "The server didn't answer. Nothing changed.";
  }
}

export function DecisionPanel({ requestId, allowed, flagged, ambiguous }: {
  requestId: string; allowed: DecisionKind[]; flagged: TransferOption[]; ambiguous: TransferOption[];
}) {
  const actor = useActor();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<string>("");
  if (!allowed.length) return null;
  const needsTransfer = allowed.includes("dismiss_transfer") ? flagged : allowed.includes("assign_transfer") ? ambiguous : [];
  const chosen = pick || needsTransfer[0]?.key;
  const go = async (kind: DecisionKind) => {
    setBusy(true); setMsg(null);
    const res = await post(requestId, actor, { kind: "decide", decision: { kind, note, ...(needsTransfer.length ? { observationKey: chosen } : {}) } });
    setBusy(false);
    if (res) setMsg(res); else { setNote(""); router.refresh(); setTimeout(() => router.refresh(), 1000); }
  };
  const needsNote = !allowed.includes("acknowledge");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!actor && <ActingAs />}
      {needsTransfer.length > 1 && (
        <select className="input" value={chosen} onChange={(e) => setPick(e.target.value)} aria-label="Transfer">
          {needsTransfer.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      )}
      <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
        aria-label="Decision note" placeholder={COPY[allowed[0]].placeholder} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {allowed.map((k, i) => (
          <button key={k} className={`btn ${i === 0 ? "btn-primary" : ""}`} disabled={busy || !actor || (needsNote && !note.trim())} onClick={() => go(k)}>
            {COPY[k].button}
          </button>
        ))}
      </div>
      {allowed.map((k) => <div key={k} className="field-hint"><strong>{COPY[k].button}:</strong> {COPY[k].hint}</div>)}
      {needsNote && !note.trim() && <div className="field-hint">A note is required: it is kept with the decision.</div>}
      {msg && <div className="bar bar-red" role="alert">{msg}</div>}
    </div>
  );
}

export function OwnerAndNote({ requestId, owner }: { requestId: string; owner?: string }) {
  const actor = useActor();
  const router = useRouter();
  const [o, setO] = useState(owner ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (action: object, after: () => void) => {
    setMsg(null);
    const res = await post(requestId, actor, action);
    if (res) setMsg(res); else { after(); router.refresh(); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); void act({ kind: "owner", owner: o }, () => {}); }}>
        <input className="input" style={{ flex: 1 }} value={o} onChange={(e) => setO(e.target.value)} placeholder="Owner" aria-label="Case owner" maxLength={60} />
        <button className="btn btn-sm" type="submit" disabled={!actor || o.trim() === (owner ?? "")}>Save</button>
        {actor && !owner && o.trim() === "" && <button className="btn btn-sm" type="button" onClick={() => { setO(actor); void act({ kind: "owner", owner: actor }, () => {}); }}>Assign to me</button>}
      </form>
      <form style={{ display: "flex", flexDirection: "column", gap: 6 }} onSubmit={(e) => { e.preventDefault(); void act({ kind: "note", text: note }, () => setNote("")); }}>
        <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note (not sent to the customer; no personal data)" aria-label="Internal note" maxLength={1000} />
        <div><button className="btn btn-sm" type="submit" disabled={!actor || !note.trim()}>Add note</button></div>
      </form>
      {!actor && <ActingAs />}
      {msg && <div className="bar bar-red" role="alert">{msg}</div>}
    </div>
  );
}

export function AttachHash({ requestId }: { requestId: string }) {
  const actor = useActor();
  const router = useRouter();
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form style={{ display: "flex", flexDirection: "column", gap: 6 }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      const res = await post(requestId, actor, { kind: "attach_hash", hash });
      setBusy(false);
      // A successful lookup returns a message too; tell the two apart by re-reading the page.
      const ok = res === null || /recorded|nothing changed/i.test(res);
      setMsg(res ? { ok, text: res } : null);
      if (ok) { setHash(""); router.refresh(); }
    }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input mono" style={{ flex: 1, minWidth: 0 }} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x… transaction hash" aria-label="Transaction hash" />
        <button className="btn btn-sm" type="submit" disabled={busy || !actor || hash.trim().length < 64}>{busy ? "Looking up…" : "Look up"}</button>
      </div>
      <div className="field-hint">Real Ethereum, read-only. Records the transfer only if it pays this request's address.</div>
      {msg && <div className={`bar ${msg.ok ? "bar-info" : "bar-red"}`} role="status">{msg.text}</div>}
    </form>
  );
}
