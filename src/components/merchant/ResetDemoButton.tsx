"use client";

import { useState } from "react";
import m from "./merchant.module.css";

/**
 * Demo build only: the "Reset demo" button. The layout renders it only in a demo build for a demo organisation
 * (Demo · fictional data); the route it calls answers 404 anywhere else. After the reset every demo login signs in
 * again (the seeded state has no sessions).
 */
export function ResetDemoButton() {
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  async function reset() {
    if (!window.confirm("Reset the demo to its seeded state? Everything done since (uploads, approvals, runs) is discarded. Demo · fictional data.")) return;
    setState({ busy: true, message: "Resetting the demo…" });
    try {
      const res = await fetch("/api/control/demo/reset", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => null)) as { ms?: number; next?: string; error?: { message?: string } } | null;
      if (res.ok) {
        setState({ busy: false, message: `Demo reset in ${((body?.ms ?? 0) / 1000).toFixed(1)} s. Sign in again.` });
        window.setTimeout(() => window.location.assign(body?.next ?? "/control/sign-in"), 1200);
        return;
      }
      setState({ busy: false, message: body?.error?.message ?? `The reset was refused (HTTP ${res.status}).` });
    } catch { setState({ busy: false, message: "The server could not be reached." }); }
  }
  return (
    <span className={m.demoReset} data-testid="demo-reset">
      <button type="button" onClick={() => void reset()} disabled={state.busy} data-testid="demo-reset-button">Reset demo</button>
      {state.message ? <span role="status"> {state.message}</span> : null}
    </span>
  );
}
