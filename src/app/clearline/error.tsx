"use client";
/**
 * Error boundary for the console. It never resets anything on its own: the person chooses, and the
 * page says exactly what a reset discards.
 */
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/clearline/workspace";
import { ui } from "@/components/clearline/ui";

export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { reset: resetWorkspace } = useWorkspace();
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { console.error("Clearline console error", error.digest ?? error.message); }, [error]);
  return (
    <section className={ui.panel} aria-labelledby="cl-error-h" role="alert">
      <div className={ui.panelHead}><h1 id="cl-error-h" style={{ fontSize: 18, margin: 0 }}>This page could not be shown</h1></div>
      <div className={ui.panelBody}>
        <p style={{ marginTop: 0 }}>Something in this page failed while reading your test workspace. Nothing has been changed or reset.{error.digest ? <> Reference <code>{error.digest}</code>.</> : null}</p>
        <p>You can try again. If it keeps failing, reset to the sample workspace: <strong>this discards every payment, case, note and statement line you added in this browser</strong> and restores the five fictional scenarios. Nothing else is affected; no real data exists here.</p>
        {done && <p className={ui.status} role="status">Workspace reset to the sample. Your own test data in this browser was discarded. Select “Try again”.</p>}
        {failure && <p className={`${ui.status} ${ui.statusErr}`} role="status">{failure}</p>}
        <div className={ui.actions}>
          <button type="button" className={`${ui.btn} ${ui.primary}`} onClick={reset}>Try again</button>
          <button type="button" className={ui.btn} disabled={done} onClick={() => { const r = resetWorkspace("sample"); if (r.ok) setDone(true); else setFailure(r.reason); }}>Reset to sample (discards your test data)</button>
          <a href="/clearline">Go to Overview</a>
        </div>
      </div>
    </section>
  );
}
