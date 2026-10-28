"use client";

// On the sender's page: paste the address your wallet is about to send to, before you confirm.
// Catches the address-poisoning scam (a look-alike address planted in the wallet's history), which
// a glance at the first and last characters misses. The check is also recorded for the business.

import { useRouter } from "next/navigation";
import { refreshAfterChange } from "./AutoRefresh";
import { useEffect, useRef, useState } from "react";

type Result = "match" | "lookalike" | "different" | "invalid";

const TEXT: Record<Result, { tone: string; title: string; body: string }> = {
  match: { tone: "ok", title: "✓ That's the right address", body: "It matches this invoice exactly. Check the network is Ethereum and the amount, then send." },
  lookalike: { tone: "stop", title: "Stop: don't send to this address", body: "It starts and ends like ours but it's a different address. This is how address-poisoning scams work: a scammer plants a look-alike address in your wallet's history. Copy the address from this page instead. Nothing has been sent." },
  different: { tone: "stop", title: "That isn't the address for this payment", body: "Copy the address from this page and paste it into your wallet." },
  invalid: { tone: "warn", title: "That isn't an Ethereum address", body: "An Ethereum address is 0x followed by 40 characters." },
};

export function AddressChecker({ publicId, demoLookalike }: { publicId: string; demoLookalike?: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const out = useRef<HTMLDivElement>(null);
  // Make sure the verdict is seen, even on a short screen.
  useEffect(() => { if (result) out.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [result]);
  const check = async (address: string) => {
    if (!address.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/pay/${encodeURIComponent(publicId)}/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const j = await r.json().catch(() => ({}));
      setResult(r.ok ? j.result : "invalid");
      refreshAfterChange(router, { reload: false });
    } catch { setResult(null); }
    setBusy(false);
  };
  const t = result ? TEXT[result] : null;
  return (
    <section className="pay-check" aria-labelledby="check-h">
      <div id="check-h" className="pay-k" style={{ fontWeight: 600, color: "var(--text)" }}>Before you confirm: check the address in your wallet</div>
      <div className="muted" style={{ fontSize: 13 }}>Paste the address your wallet is about to send to. We&apos;ll tell you if it&apos;s ours.</div>
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); void check(value); }}>
        <input className="input mono" style={{ flex: 1, minWidth: 0 }} value={value} onChange={(e) => { setValue(e.target.value); setResult(null); }}
          placeholder="0x… paste from your wallet" aria-label="Address from your wallet" autoComplete="off" spellCheck={false} data-testid="check-input" />
        <button className="btn" type="submit" disabled={busy || !value.trim()} data-testid="check-address">{busy ? "Checking…" : "Check"}</button>
      </form>
      {demoLookalike && (
        <button type="button" className="linkish" data-testid="demo-paste-lookalike"
          onClick={() => { setValue(demoLookalike); void check(demoLookalike); }}>
          Demo: paste the address from Fernhill&apos;s wallet history
        </button>
      )}
      {t && (
        <div ref={out} className={`check-result check-${t.tone}`} role="alert" data-testid="check-result">
          <strong>{t.title}</strong>
          <span>{t.body}</span>
        </div>
      )}
    </section>
  );
}
