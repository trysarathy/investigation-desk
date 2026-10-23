"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActor } from "./ActingAs";

export function PaymentActions({ disabled, preview }: { disabled: boolean; preview: boolean }) {
  const router = useRouter();
  const actor = useActor();
  const [busy, setBusy] = useState<string | undefined>();
  const post = async (path: string, what: string) => {
    setBusy(what);
    try {
      await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor }) });
      router.refresh();
    } finally { setBusy(undefined); }
  };
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn btn-sm" disabled={disabled || !!busy} onClick={() => post("/api/payments/match", "match")}>
        {busy === "match" ? "Matching…" : "Re-run matching"}
      </button>
      {!preview && (
        <button className="btn btn-sm" disabled={disabled || !!busy || !actor} title={actor ? undefined : "Set Acting as first: clearing is audit-logged."}
          onClick={() => { if (confirm("Remove every imported payment record? Saved mappings stay.")) void post("/api/payments/clear", "clear"); }}>
          Clear records
        </button>
      )}
    </div>
  );
}
