// Matching as a background job. An import (or Clear, or "Re-run matching") saves its records and
// returns at once; this job then looks up transactions on chain, matches, and brings the inbox up
// to date, with progress the page can show. One job at a time: a request while it runs makes it
// run once more afterwards, so every change is matched. Like bulk runs, progress is kept in
// memory (on globalThis, shared by every route) and a job doesn't survive a server restart.

import "server-only";
import { refreshInbox, rematchData, paymentsStore } from "./live";
import { rematchInto } from "./workflow";

export type MatchStep = "chain" | "match" | "inbox";

export interface MatchJobState {
  status: "idle" | "queued" | "running";
  /** What it is doing now, in words. */
  step?: string;
  /** Chain lookups done / to do, while on that step. */
  done?: number;
  total?: number;
  /** Why it last ran (the latest request), and when it last finished. */
  reason?: string;
  startedAt?: string;
  finishedAt?: string;
  /** The last run's failure, if it failed. The next request runs it again. */
  error?: string;
  runs: number;
}

const STEPS: Record<MatchStep, string> = {
  chain: "Looking up transactions on chain",
  match: "Matching payments",
  inbox: "Updating the inbox",
};

type Runner = { state: MatchJobState; again: boolean; current?: Promise<void> };
const g = globalThis as { __deskMatchJob?: Runner };
const runner: Runner = (g.__deskMatchJob ??= { state: { status: "idle", runs: 0 }, again: false });

export const matchJobState = (): MatchJobState => ({ ...runner.state });

// Lets the event loop turn between the long synchronous steps, so other requests keep answering.
const breathe = () => new Promise<void>((r) => setImmediate(r));

async function runOnce() {
  const progress = (step: MatchStep, done?: number, total?: number) => {
    runner.state = { ...runner.state, status: "running", step: STEPS[step], done, total };
  };
  progress("chain");
  await rematchInto(paymentsStore(), async (data) => {
    const next = await rematchData(data, {
      onLookup: (done, total) => progress("chain", done, total),
      beforeMatch: async () => { progress("match"); await breathe(); },
    });
    await breathe();
    return next;
  });
  progress("inbox");
  await breathe();
  await refreshInbox();
}

/** Ask for a match. Returns the job's state; the job runs in the background. */
export function requestMatch(reason: string): MatchJobState {
  runner.state = { ...runner.state, reason };
  if (runner.current) {
    runner.again = true;
    return matchJobState();
  }
  runner.state = { ...runner.state, status: "queued", step: undefined, done: undefined, total: undefined };
  runner.current = (async () => {
    // Start after the response has gone out.
    await breathe();
    do {
      runner.again = false;
      runner.state = { ...runner.state, status: "running", startedAt: new Date().toISOString(), error: undefined };
      try {
        await runOnce();
      } catch (e) {
        runner.state = { ...runner.state, error: e instanceof Error ? e.message : String(e) };
      }
      runner.state = { ...runner.state, runs: runner.state.runs + 1, finishedAt: new Date().toISOString() };
    } while (runner.again);
    runner.state = { ...runner.state, status: "idle", step: undefined, done: undefined, total: undefined };
    runner.current = undefined;
  })();
  return matchJobState();
}

/** Resolves when no match is running or waiting (tests, scripts). */
export async function matchIdle(): Promise<void> {
  while (runner.current) await runner.current;
}
