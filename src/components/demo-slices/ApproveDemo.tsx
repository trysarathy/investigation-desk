"use client";
// S2 (DEMO ONLY): the Approve step. It changes what this page shows and nothing else: no request
// to the server, to Xero or anywhere. Disabled (with the reason in words) until the payment is final.

import { useRef, useState } from "react";
import { sgt } from "@/lib/demo-slices/present";

export function ApproveDemo({ message, approver, disabledReason }: { message: string; approver: string; disabledReason?: string }) {
  const [at, setAt] = useState<string | null>(null);
  const done = useRef<HTMLParagraphElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  if (disabledReason) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
        <p className="bar bar-amber" role="status" style={{ margin: 0 }} data-testid="approve-waiting">{disabledReason}</p>
        <button type="button" className="btn btn-primary" disabled aria-disabled="true" data-testid="approve-demo">Approve</button>
      </div>
    );
  }
  return at ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <p ref={done} tabIndex={-1} role="status" className="bar bar-info" data-testid="approve-result" style={{ margin: 0 }}>
        Approved by {approver}, {at}. {message}
      </p>
      <button type="button" className="btn btn-sm" data-testid="approve-undo" onClick={() => { setAt(null); requestAnimationFrame(() => btn.current?.focus()); }}>Undo</button>
    </div>
  ) : (
    <button ref={btn} type="button" className="btn btn-primary" data-testid="approve-demo"
      onClick={() => { setAt(sgt(new Date())); requestAnimationFrame(() => done.current?.focus()); }}>
      Approve
    </button>
  );
}
