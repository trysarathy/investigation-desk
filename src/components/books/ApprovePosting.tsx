"use client";

// The one button that writes to the books: approve the plan shown, by its key. If the plan changed
// since the page loaded (a transfer arrived, a decision was made), the server refuses and the page
// shows the new plan to approve.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActor } from "@/components/ActingAs";
import { refreshAfterChange } from "@/components/requests/AutoRefresh";

export function ApprovePosting({ requestId, planKey, label }: { requestId: string; planKey: string; label: string }) {
  const actor = useActor();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/accounting/${encodeURIComponent(requestId)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, key: planKey }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: j.message ?? "Posted." } : { ok: false, text: j.error ?? `Failed (${r.status}).` });
      refreshAfterChange(router);
    } catch {
      setMsg({ ok: false, text: "The server didn't answer. Nothing was posted." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <button className="btn btn-primary" onClick={go} disabled={busy || !actor} data-testid="approve-posting">{busy ? "Posting…" : label}</button>
        <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>{actor ? `Approving as ${actor}. Recorded in the audit log.` : "Set \"Acting as\" first: every posting records who approved it."}</span>
      </div>
      {msg && <div className="muted" style={{ fontSize: 13, color: msg.ok ? undefined : "var(--red)" }} role="status">{msg.text}</div>}
    </div>
  );
}
