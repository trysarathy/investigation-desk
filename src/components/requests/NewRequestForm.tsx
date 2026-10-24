"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActingAs, useActor } from "@/components/ActingAs";

const FIELDS = [
  { k: "customerRef", label: "Customer", placeholder: "e.g. Acme Logistics or C-10422", hint: "A name or reference. No emails or ID numbers." },
  { k: "invoiceRef", label: "Invoice", placeholder: "e.g. INV-2045", hint: "Shown to the sender, so they know what they're paying." },
  { k: "amount", label: "Amount (USDC)", placeholder: "1250.00", hint: "Exact. Digits and one point, up to 6 decimal places." },
  { k: "receivingAddress", label: "Receiving address", placeholder: "0x…", hint: "Your Ethereum address for this payment. A separate address per request lets us match by address, not amount." },
] as const;

export function NewRequestForm() {
  const actor = useActor();
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    try {
      const r = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, ...v }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { router.push(`/requests/${j.id}?created=1`); return; }
      if (j.errors) setErrors(j.errors); else setError(j.error ?? `Failed (${r.status}).`);
    } catch {
      setError("The server didn't answer. Nothing was created.");
    }
    setBusy(false);
  };
  return (
    <>
    {!actor && <div className="bar bar-info"><ActingAs /></div>}
    <form onSubmit={submit} className="panel" noValidate>
      <div className="form-grid">
        {FIELDS.map((f) => (
          <div key={f.k} style={{ display: "contents" }}>
            <label htmlFor={f.k}>{f.label}</label>
            <div>
              <input id={f.k} className={`input${f.k === "amount" || f.k === "receivingAddress" ? " mono" : ""}`} style={{ width: "100%" }}
                value={v[f.k] ?? ""} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} placeholder={f.placeholder}
                inputMode={f.k === "amount" ? "decimal" : undefined} autoComplete="off" aria-invalid={!!errors[f.k]} aria-describedby={`${f.k}-hint`} />
              {errors[f.k] ? <div className="field-err" role="alert">{errors[f.k]}</div> : <div className="field-hint" id={`${f.k}-hint`}>{f.hint}</div>}
            </div>
          </div>
        ))}
        <span className="muted">Token and network</span>
        <div><strong>USDC on Ethereum</strong> <span className="faint">· Circle&apos;s contract 0xA0b8…eB48. The only option in this version.</span></div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !actor}>{busy ? "Creating…" : "Create request"}</button>
        {actor ? <span className="faint" style={{ fontSize: 12 }}>Created by {actor}.</span> : <span className="faint" style={{ fontSize: 12 }}>Say who you are (Acting as, above) first.</span>}
        {error && <div className="bar bar-red" role="alert">{error}</div>}
      </div>
    </form>
    </>
  );
}
