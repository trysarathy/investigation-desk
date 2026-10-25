"use client";

// Decisions, owner, notes and live lookups for one request. Every action names who did it (Acting
// as) and goes to the server, which checks it is allowed in the request's current state.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActingAs, useActor } from "@/components/ActingAs";

type DecisionKind = "request_balance" | "accept_short" | "accept_over" | "dismiss_transfer" | "assign_transfer" | "count_transfer" | "accept_other_network" | "refund_excess" | "acknowledge";
export interface TransferOption { key: string; label: string }

const COPY: Record<DecisionKind, { button: string; hint: string; placeholder: string }> = {
  acknowledge: { button: "Mark paid", hint: "Once the invoice is marked paid in your accounting system.", placeholder: "Optional, e.g. ledger reference" },
  request_balance: { button: "I've asked for the balance", hint: "Keeps the invoice open until the rest arrives; then it's marked paid automatically.", placeholder: "e.g. Sent the top-up request to the customer" },
  accept_short: { button: "Accept as settled", hint: "Marks it paid for less than requested, with your reason (e.g. you'll absorb the fee).", placeholder: "Why, e.g. we absorb the 50.00 fee" },
  accept_over: { button: "Keep as credit", hint: "Marks it paid; the extra is kept as credit with the customer.", placeholder: "e.g. Customer asked to keep it as credit" },
  refund_excess: { button: "Record the refund", hint: "Marks the invoice paid and records that treasury will refund the extra. This app never sends money.", placeholder: "e.g. Refund address confirmed by email; instruction sent to treasury" },
  dismiss_transfer: { button: "Not a payment: close it", hint: "The transfer stays on file with its evidence; it just stops counting against the invoice.", placeholder: "Why, e.g. counterfeit token; customer told" },
  assign_transfer: { button: "Assign to this request", hint: "Only with proof beyond the amount (remittance advice, sender address on file).", placeholder: "Your evidence, e.g. remittance advice received" },
  count_transfer: { button: "Count it toward this request", hint: "For a payment made before the request existed (a prepayment).", placeholder: "Your evidence, e.g. customer prepaid on our instruction" },
  accept_other_network: { button: "Count it: it's in our wallet", hint: "Only after treasury confirms the money is in your wallet on that network. Marks the invoice paid.", placeholder: "e.g. Treasury confirmed it arrived in the old Tron wallet" },
};

/** null on success with nothing to say; otherwise { ok, text } so a success message never looks like an error, or the reverse. */
async function call(id: string, actor: string, action: object): Promise<{ ok: boolean; text?: string }> {
  try {
    const r = await fetch(`/api/requests/${encodeURIComponent(id)}/action`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, action }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, text: j.message } : { ok: false, text: j.error ?? `Failed (${r.status}).` };
  } catch {
    return { ok: false, text: "The server didn't answer. Nothing changed." };
  }
}
async function post(id: string, actor: string, action: object): Promise<string | null> {
  const r = await call(id, actor, action);
  return r.ok ? null : r.text ?? "Failed.";
}

export function DecisionPanel({ requestId, allowed, flagged, ambiguous, suggestedNote }: {
  requestId: string; allowed: DecisionKind[]; flagged: TransferOption[]; ambiguous: TransferOption[]; suggestedNote?: string;
}) {
  const actor = useActor();
  const router = useRouter();
  const [note, setNote] = useState(suggestedNote ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<string>("");
  if (!allowed.length) return null;
  const needsTransfer = allowed.some((k) => k === "dismiss_transfer" || k === "count_transfer" || k === "accept_other_network") ? flagged : allowed.includes("assign_transfer") ? ambiguous : [];
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
          <button key={k} className={`btn ${i === 0 ? "btn-primary" : ""}`} disabled={busy || !actor || (needsNote && !note.trim())} onClick={() => go(k)} data-testid={`decide-${k}`}>
            {COPY[k].button}
          </button>
        ))}
      </div>
      <div className="field-hint">{allowed.map((k) => <span key={k} style={{ display: "block" }}><strong>{COPY[k].button}:</strong> {COPY[k].hint}</span>)}</div>
      {needsNote && !note.trim() && <div className="field-hint">A note is required: it is kept with the decision in the activity log.</div>}
      {msg && <div className="bar bar-red" role="alert">{msg}</div>}
    </div>
  );
}

/** A person confirms an unidentified payment's match. */
export function ConfirmMatch({ obsKey, requestId, label, suggestedNote }: { obsKey: string; requestId: string; label: string; suggestedNote: string }) {
  const actor = useActor();
  const router = useRouter();
  const [note, setNote] = useState(suggestedNote);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!actor && <ActingAs />}
      <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} aria-label="Why this match" />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" disabled={busy || !actor || !note.trim()} data-testid="confirm-match" onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            const r = await fetch("/api/requests/payments/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, key: obsKey, requestId, note }) });
            if (!r.ok) { setMsg((await r.json().catch(() => ({}))).error ?? `Failed (${r.status}).`); setBusy(false); return; }
            router.push(`/requests/${requestId}`);
            router.refresh();
          } catch { setMsg("The server didn't answer. Nothing changed."); setBusy(false); }
        }}>{busy ? "Confirming…" : label}</button>
        <span className="faint" style={{ fontSize: 12 }}>Your note is kept with the match. The system&apos;s &ldquo;unidentified&rdquo; stays in the history.</span>
      </div>
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
      const res = await call(requestId, actor, { kind: "attach_hash", hash });
      setBusy(false);
      setMsg(res.text ? { ok: res.ok, text: res.text } : null);
      if (res.ok) { setHash(""); router.refresh(); }
    }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input mono" style={{ flex: 1, minWidth: 0 }} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x… transaction hash" aria-label="Transaction hash" />
        <button className="btn btn-sm" type="submit" disabled={busy || !actor || hash.trim().length < 64}>{busy ? "Looking up…" : "Look up"}</button>
      </div>
      <div className="field-hint">Real Ethereum, read-only. Records the transfer only if it pays this request&apos;s address. Look the same hash up again to update its confirmations.</div>
      {msg && <div className={`bar ${msg.ok ? "bar-info" : "bar-red"}`} role="status">{msg.text}</div>}
    </form>
  );
}
