"use client";

// Shows the background match while it runs (after an import or "Re-run matching") and refreshes
// the page when it finishes. Polls only while a match is queued or running.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MatchJobState } from "@/lib/payments/jobs";

export const MATCH_STARTED = "desk:match-started";

/** Tell the page a match was just requested, so it starts showing progress. */
export function announceMatch() {
  window.dispatchEvent(new Event(MATCH_STARTED));
}

export function MatchProgress() {
  const router = useRouter();
  const [state, setState] = useState<MatchJobState | undefined>();
  const [watching, setWatching] = useState(true);

  useEffect(() => {
    const start = () => setWatching(true);
    window.addEventListener(MATCH_STARTED, start);
    return () => window.removeEventListener(MATCH_STARTED, start);
  }, []);

  useEffect(() => {
    if (!watching) return;
    let stop = false;
    let wasBusy = false;
    const poll = async () => {
      while (!stop) {
        const s = (await fetch("/api/payments/match").then((r) => r.json()).catch(() => undefined)) as MatchJobState | undefined;
        if (stop) return;
        setState(s);
        const busy = !!s && s.status !== "idle";
        if (busy) wasBusy = true;
        if (!busy) {
          if (wasBusy) router.refresh();
          setWatching(false);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    void poll();
    return () => { stop = true; };
  }, [watching, router]);

  if (state?.status === "idle" && state.error) {
    return <div className="bar bar-red" role="alert">The last match failed: {state.error} Re-run matching to try again.</div>;
  }
  if (!state || state.status === "idle") return null;
  const counts = state.total ? ` (${state.done ?? 0} of ${state.total})` : "";
  return (
    <div className="bar bar-info" role="status" aria-live="polite">
      Matching in the background: {state.status === "queued" ? "starting" : `${(state.step ?? "working").toLowerCase()}${counts}`}. You can keep working; this page updates when it finishes.
    </div>
  );
}
