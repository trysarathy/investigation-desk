"use client";

// The demo's simulated provider, as buttons. Each one writes simulated transfer events through the
// same ingestion and matching the app uses for real ones; the pages then re-read those records.

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ScenarioStatus {
  key: "routine" | "short" | "fake";
  id: string;
  title: string;
  blurb: string;
  sendLabel: string;
  sent: boolean;
}

export function DemoControls({ scenarios, waitingForBlock, inBlock, head, compact, only }: {
  scenarios: ScenarioStatus[]; waitingForBlock: number; inBlock: number; head?: number; compact?: boolean; only?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (label: string, body: object) => {
    setBusy(label); setError(null);
    try {
      const r = await fetch("/api/requests/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? `Failed (${r.status}).`);
      router.refresh();
      // A second read a moment later, in case a background refresh that started earlier lands last.
      setTimeout(() => router.refresh(), 1000);
    } catch {
      setError("The server didn't answer. Nothing changed.");
    } finally {
      setBusy(null);
    }
  };
  const shown = only ? scenarios.filter((s) => s.id === only) : scenarios;
  return (
    <section className="panel" aria-label="Demo controls">
      <div className="panel-h">
        <h2>Demo controls <span className="faint" style={{ fontWeight: 400 }}>· simulated transfers, no real chain</span></h2>
        {head !== undefined && <span className="faint mono">simulated block {head.toLocaleString("en-US")}</span>}
      </div>
      <div className="panel-b">
        {shown.map((s) => (
          <div key={s.key} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            {!compact && <div style={{ minWidth: 220, flex: "1 1 260px" }}><strong>{s.title}</strong> <span className="mono faint">{s.id}</span><div className="muted" style={{ fontSize: 12 }}>{s.blurb}</div></div>}
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run(s.key, { kind: "send", scenario: s.key })}>
              {busy === s.key ? "Sending…" : s.sendLabel}
            </button>
          </div>
        ))}
        {(!only || only === "REQ-1042") && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12, flex: "1 1 260px" }}>After a short payment: Brightline sends the remaining balance.</span>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("balance", { kind: "send_balance" })}>Brightline sends 1,000.00 USDC</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 2 }}>
          <button className="btn btn-sm btn-primary" disabled={!!busy || waitingForBlock === 0} onClick={() => run("mine", { kind: "mine" })}
            title="Puts every simulated transfer that is waiting into the next block">
            Include in a block{waitingForBlock ? ` (${waitingForBlock} waiting)` : ""}
          </button>
          <button className="btn btn-sm" disabled={!!busy || inBlock === 0} onClick={() => run("adv", { kind: "advance", blocks: 12 })}>Add 12 confirmations</button>
          <button className="btn btn-sm" disabled={!!busy || inBlock + waitingForBlock === 0} onClick={() => run("dup", { kind: "redeliver" })}
            title="Delivers the most recent simulated event again, unchanged. It must count once.">Deliver last event again</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" disabled={!!busy} onClick={() => { if (confirm("Reset the demo? Only demo records are removed; anything else stays.")) void run("reset", { kind: "reset" }); }}>
            Reset demo
          </button>
        </div>
        {error && <div className="bar bar-red" role="alert">{error}</div>}
      </div>
    </section>
  );
}

export function LoadDemoButton({ label = "Load the demo day" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-primary" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/requests/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "reset" }) }).catch(() => {});
      setBusy(false);
      router.refresh();
    }}>{busy ? "Loading…" : label}</button>
  );
}
