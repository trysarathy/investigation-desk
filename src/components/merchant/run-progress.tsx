"use client";

import { useEffect, useState } from "react";
import { Result, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";
import g from "./screens-g2.module.css";

/**
 * "Run reconciliation" with an honest progress state. The request runs the whole reconciliation before it answers, so
 * the browser cannot know which step the server is on: the button shows that it is working and for how long, and the
 * steps are listed in the order the engine runs them (the engine's own step list, passed from the server), with no
 * step marked as current and no percentage. The request, its body and its confirmation text are the same as the
 * shared RunReconciliation form; the result is the server's answer, shown after the reload.
 */

const API = "/api/control/merchant";
export const RUN_STEP_WORDS: Record<string, string> = {
  chain_verify: "Verifying chain transfers", load: "Reading the stored rows", engine: "Matching", write: "Writing the results", done: "Done",
};

export function RunReconciliationLive({ entityId, entityName, steps }: { entityId: string; entityName: string; steps: readonly string[] }) {
  const x = useMutation(`reconcile:${entityId}`);
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!x.busy || started === null) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [x.busy, started]);
  const secs = started !== null && x.busy ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const work = steps.filter((st) => st !== "done");
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      const t0 = Date.now();
      setStarted(t0); setNow(t0);
      void x.run("POST", `${API}/reconcile`, { entityId }, (d) => d?.changed
        ? `Reconciled ${String(d.records ?? "?")} payments for ${entityName}: ${String(d.exceptions ?? 0)} exceptions, ${String(d.journals ?? 0)} journal proposals pending sign-off. The run is on the Runs page.`
        : `Nothing changed for ${entityName}: the same data was already reconciled (input sha256 ${String(d?.inputSha256 ?? "").slice(0, 12)}…).`);
    }}>
      <button type="submit" className={`${s.button} ${s.buttonSecondary}`} disabled={x.busy} aria-disabled={x.busy}>
        {x.busy ? <span className={g.spin} aria-hidden="true" /> : null}Run reconciliation for {entityId}
      </button>
      {x.busy && started !== null ? (
        <div className={g.runBusy} role="status" aria-live="polite" data-testid={`reconcile-progress-${entityId}`}>
          <p style={{ margin: 0 }}><strong>Reconciling {entityId}</strong>: reading the files, verifying the chain transfers, matching and writing the result; running for {secs} s.</p>
          <ol className={g.stepper} aria-label="Steps, in the order the engine runs them">
            {work.map((st) => <li key={st}>{RUN_STEP_WORDS[st] ?? st}</li>)}
          </ol>
          <p className={s.small} style={{ margin: 0 }}>This request does every step before it answers, so no step is marked and no percentage is shown. To follow a run step by step, run it in the background.</p>
        </div>
      ) : null}
      <Result outcome={x.outcome} />
    </form>
  );
}

/** A job's progress through the engine's steps: which step, and the share of steps finished (never a guess about time). */
export function stepProgress(stage: string | null, status: string, steps: readonly string[]): { step: number; of: number; pct: number; word: string } | null {
  const work = steps.filter((st) => st !== "done");
  if (!work.length) return null;
  if (status === "done") return { step: work.length, of: work.length, pct: 100, word: "Done" };
  if (status === "queued") return { step: 0, of: work.length, pct: 0, word: "Waiting for the worker" };
  if (status !== "running") return null;
  const i = stage ? work.indexOf(stage) : -1;
  if (i < 0) return { step: 0, of: work.length, pct: 0, word: "Starting" };
  return { step: i + 1, of: work.length, pct: Math.floor((i * 100) / work.length), word: RUN_STEP_WORDS[stage!] ?? stage! };
}
