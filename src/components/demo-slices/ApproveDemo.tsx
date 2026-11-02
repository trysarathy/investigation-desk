"use client";
// S2 (DEMO ONLY): the Approve step. It changes what this page shows and nothing else: no request
// to the server, to Xero or anywhere. The message says so.

import { useRef, useState } from "react";

export function ApproveDemo({ message, approver }: { message: string; approver: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  return done ? (
    <p ref={ref} tabIndex={-1} role="status" className="bar bar-info" data-testid="approve-result" style={{ margin: 0 }}>
      Approved by {approver}. {message} Nothing was sent to Xero or anywhere else.
    </p>
  ) : (
    <button type="button" className="btn btn-primary" data-testid="approve-demo"
      onClick={() => { setDone(true); requestAnimationFrame(() => ref.current?.focus()); }}>
      Approve
    </button>
  );
}
