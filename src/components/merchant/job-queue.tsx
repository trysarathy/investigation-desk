"use client";

import { useEffect, useState } from "react";
import { Result, Submit, useMutation } from "@/components/control/forms";
import s from "@/components/control/control.module.css";
import g from "./screens-g2.module.css";
import { stepProgress } from "./run-progress";

/**
 * v1 phase 3: the job queue on the Runs page. "Run in the background" queues a reconciliation for the worker (the
 * server checks the session, organisation, Origin, Idempotency-Key and role); the queue below polls the server every
 * few seconds and shows each job's stage as the worker reports it. Nothing is shown as done before the worker has
 * recorded it.
 */

const API = "/api/control/merchant";
const KIND: Record<string, string> = { reconcile: "Reconciliation", revaluation: "Revaluation proposals", pickup: "File pickup", retention: "Retention" };
const TRIGGER: Record<string, string> = { manual: "Asked by a member", schedule: "Daily schedule", rule_change: "Rule change" };
const STAGE: Record<string, string> = {
  chain_verify: "Verifying chain transfers", load: "Reading the stored rows", engine: "Matching", write: "Writing the results", done: "Done",
  revaluation: "Proposing revaluations", pickup: "Picking up files", retention: "Removing expired uploads",
};
const STATUS: Record<string, string> = { queued: "Queued", running: "Running", done: "Done", dead: "Failed (dead-letter)", cancelled: "Cancelled" };

interface JobView {
  id: string; kind: string; trigger: string; entityId: string | null; status: string; stage: string | null; attempts: number; maxAttempts: number; recoveries: number;
  lastErrorCode: string | null; runId: string | null; createdAt: string; heartbeatAt: string | null; finishedAt: string | null;
  events: { at: string; event: string; stage: string | null; code: string | null; counts: Record<string, number> | null }[];
}

export function QueueRun({ entityId }: { entityId: string }) {
  const x = useMutation(`queue:${entityId}`);
  return (
    <form autoComplete="off" onSubmit={(ev) => {
      ev.preventDefault();
      void x.run("POST", `${API}/jobs`, { entityId, kind: "reconcile" }, () => `Queued a reconciliation of ${entityId} for the worker. Its progress is in the queue below.`);
    }}>
      <Submit busy={x.busy} variant="secondary">Run {entityId} in the background</Submit>
      <Result outcome={x.outcome} />
    </form>
  );
}

const secondsAgo = (iso: string | null, now: number) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);

/** `steps`: the engine's step list (from the server), so a running reconciliation shows its step and the share of steps done. */
export function JobQueue({ initial, steps = [] }: { initial: JobView[]; steps?: readonly string[] }) {
  const [jobs, setJobs] = useState<JobView[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API}/jobs?limit=20`, { headers: { accept: "application/json" }, cache: "no-store" });
        if (!r.ok) { setError(`The queue could not be read (HTTP ${r.status}).`); return; }
        const d = (await r.json()) as { jobs: JobView[] };
        if (!stop) { setJobs(d.jobs); setError(null); setNow(Date.now()); }
      } catch { setError("The server could not be reached."); }
    };
    const t = window.setInterval(() => void tick(), active ? 2_000 : 10_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [active]);
  if (!jobs.length) return <p className={s.small}>No jobs yet.</p>;
  return (
    <>
      {error ? <p role="alert" className={s.small}>{error}</p> : null}
      <div className={s.tableWrap} role="region" aria-label="Job queue" tabIndex={0}>
        <table className={s.table} data-testid="job-queue">
          <thead><tr>
            <th scope="col">Queued</th><th scope="col">Job</th><th scope="col">Entity</th><th scope="col">Why</th><th scope="col">Status</th><th scope="col">Stage</th><th scope="col">Progress</th>
            <th scope="col" className={s.num}>Attempt</th><th scope="col">Worker heartbeat</th><th scope="col">Steps</th>
          </tr></thead>
          <tbody aria-live="polite">{jobs.map((j) => {
            const beat = secondsAgo(j.heartbeatAt, now);
            return (
              <tr key={j.id} data-testid="job-row" data-status={j.status}>
                <td>{new Date(j.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</td>
                <td>{KIND[j.kind] ?? j.kind}</td><td className={s.mono}>{j.entityId ?? "(organisation)"}</td><td>{TRIGGER[j.trigger] ?? j.trigger}</td>
                <td data-testid="job-status">{STATUS[j.status] ?? j.status}{j.lastErrorCode ? <> · <span className={s.mono}>{j.lastErrorCode}</span></> : null}</td>
                <td data-testid="job-stage">{j.stage ? STAGE[j.stage] ?? j.stage : j.status === "queued" ? "Waiting for the worker" : "—"}</td>
                <td data-testid="job-progress">{(() => {
                  const p = j.kind === "reconcile" ? stepProgress(j.stage, j.status, steps) : null;
                  if (!p) return "—";
                  return (
                    <span className={g.jobProgress}>
                      <progress className={`${g.bar} ${g.barSm}`} max={100} value={p.pct} aria-label={`${KIND[j.kind] ?? j.kind} ${j.entityId ?? ""}: step ${p.step} of ${p.of}, ${p.pct}% of steps done`} />
                      <span>{p.step === 0 || p.pct === 100 ? `${p.pct}%` : `Step ${p.step} of ${p.of} · ${p.pct}% done`}</span>
                    </span>
                  );
                })()}</td>
                <td className={s.num}>{j.attempts}/{j.maxAttempts}{j.recoveries ? ` (taken back ${j.recoveries}×)` : ""}</td>
                <td>{j.status === "running" && beat !== null ? `${beat} s ago` : "—"}</td>
                <td className={s.small}>{j.events.filter((e) => e.event !== "heartbeat").map((e) => (e.event === "stage" ? STAGE[e.stage ?? ""] ?? e.stage : e.event)).join(" → ")}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}
