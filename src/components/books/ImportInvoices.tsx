"use client";

// Make payment requests from the open USD invoices in the connected accounting system.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActor } from "@/components/ActingAs";

export function ImportInvoices() {
  const actor = useActor();
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [token, setToken] = useState<"USDC" | "USDT">("USDC");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/accounting/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, receivingAddress: address, token }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? `Made ${j.created?.length ?? 0} payment request(s).${j.skipped?.length ? ` Skipped ${j.skipped.length}: ${j.skipped.slice(0, 3).join(" ")}` : ""}` : j.error ?? `Failed (${r.status}).`);
      router.refresh();
    } catch { setMsg("The server didn't answer."); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ethereum address customers pay to (0x…)" style={{ width: 380 }} aria-label="Receiving address" />
      <select value={token} onChange={(e) => setToken(e.target.value as "USDC" | "USDT")} aria-label="Token"><option>USDC</option><option>USDT</option></select>
      <button className="btn btn-primary" onClick={go} disabled={busy || !actor}>{busy ? "Importing…" : "Import open invoices"}</button>
      {msg && <span className="muted" role="status">{msg}</span>}
    </div>
  );
}
