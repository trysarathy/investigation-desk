"use client";

// The demo's simulated provider, as buttons. Each one writes simulated transfer events through the
// same ingestion, matching and auto-mark rule the app uses for real ones; the pages then re-read
// those records. Nothing here touches a real chain.

import { useRouter } from "next/navigation";
import { refreshAfterChange } from "./AutoRefresh";
import { useState } from "react";

async function demo(body: object): Promise<string | null> {
  try {
    const r = await fetch("/api/requests/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.ok ? null : (await r.json().catch(() => ({}))).error ?? `Failed (${r.status}).`;
  } catch {
    return "The server didn't answer. Nothing changed.";
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Case (a): Acme's payment arrives, confirms and is marked paid, in about four seconds, through the real logic. */
export function PlayPayment({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const play = async () => {
    setError(null);
    const steps: [string, object][] = [
      ["Payment sent…", { kind: "send", scenario: "a" }],
      ["In a block…", { kind: "mine" }],
      ["Confirming…", { kind: "advance", blocks: 6 }],
      ["Confirmed", { kind: "advance", blocks: 6 }],
    ];
    for (const [label, body] of steps) {
      setStep(label);
      const e = await demo(body);
      refreshAfterChange(router);
      if (e) { setError(e); break; }
      await pause(1000);
    }
    setStep(null);
    refreshAfterChange(router);
  };
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn btn-primary" disabled={disabled || !!step} onClick={play} data-testid="play-payment">
        {step ?? "▶ Play Acme's payment"}
      </button>
      <span className="faint" style={{ fontSize: 12 }}>Simulated transfer, through the real matching logic. About 4 seconds.</span>
      {error && <div className="bar bar-red" role="alert">{error}</div>}
    </div>
  );
}

/** Reload the demo day: rebuilds the same fictional records. Two clicks, no browser dialog. */
export function ReloadDemo({ label = "Reload demo day" }: { label?: string }) {
  const router = useRouter();
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-sm" disabled={busy} data-testid="reload-demo"
      title="Rebuilds the demo week exactly as it starts. Only demo data is removed."
      onClick={async () => {
        if (!arm) { setArm(true); setTimeout(() => setArm(false), 4000); return; }
        setBusy(true);
        await demo({ kind: "reset" });
        setArm(false); setBusy(false);
        if (window.location.pathname === "/requests") refreshAfterChange(router); else window.location.assign("/requests");
      }}>
      {busy ? "Reloading…" : arm ? "Click again to reload" : label}
    </button>
  );
}

/** For the sceptic: deliver the last simulated event again. It must count once. */
export function RedeliverButton({ requestId }: { requestId?: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button className="btn btn-sm" onClick={async () => { const e = await demo({ kind: "redeliver", requestId }); setMsg(e ?? "Delivered again: see Activity. It still counts once."); refreshAfterChange(router); }}>
        Deliver the last event again
      </button>
      {msg && <span className="faint" style={{ fontSize: 12 }} role="status">{msg}</span>}
    </span>
  );
}

export function LoadDemoButton({ label = "Load the demo day" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-primary" disabled={busy} data-testid="load-demo" onClick={async () => {
      setBusy(true);
      await demo({ kind: "reset" });
      setBusy(false);
      refreshAfterChange(router);
    }}>{busy ? "Loading…" : label}</button>
  );
}
