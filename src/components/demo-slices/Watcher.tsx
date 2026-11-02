"use client";
// Demo watcher (DEMO ONLY): reveals a timeline the server already built by replaying recorded
// transfers. It takes no address and makes no request: the timer only moves through `steps`.

import { useEffect, useState } from "react";
import type { WatchStep } from "@/lib/demo-slices/release";
import { NotificationPreview, QuietNote } from "./NotificationPreview";
import { ReleaseCard } from "./ReleaseCard";

export function Watcher({ steps, label, initial = 1, autoplay = true, everyMs = 3000 }: { steps: WatchStep[]; label: string; initial?: number; autoplay?: boolean; everyMs?: number }) {
  const [shown, setShown] = useState(Math.min(Math.max(initial, 1), steps.length));
  const [playing, setPlaying] = useState(autoplay);
  const done = shown >= steps.length;
  useEffect(() => {
    if (!playing || done) return;
    const t = setTimeout(() => setShown((n) => n + 1), everyMs);
    return () => clearTimeout(t);
  }, [playing, done, shown, everyMs]);
  const now = steps[shown - 1];
  const seen = steps.slice(0, shown);
  const messages = seen.filter((s) => s.notify).length;
  return (
    <section className="panel" aria-labelledby="watch-h" data-testid="demo-watcher">
      <div className="panel-h">
        <h2 id="watch-h" style={{ margin: 0, fontSize: 15 }}>Watching one demo address</h2>
        <span className="demo-badge" data-testid="watch-label">{label}</span>
      </div>
      <div className="panel-b">
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Step {shown} of {steps.length}. {playing && !done ? "Next step in a few seconds." : done ? "Replay finished." : "Paused."}{" "}
          {messages} message{messages === 1 ? "" : "s"} previewed; {shown - messages} step{shown - messages === 1 ? "" : "s"} stayed quiet.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!done && <button type="button" className="btn btn-sm" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Resume"}</button>}
          {!done && <button type="button" className="btn btn-sm" onClick={() => setShown((n) => n + 1)}>Next step</button>}
          <button type="button" className="btn btn-sm" onClick={() => { setShown(1); setPlaying(true); }}>Replay from the start</button>
        </div>
        {now.replayedWait && <p className="muted" style={{ margin: 0, fontSize: 12 }}>This step replays the wait for blocks from the transfer&apos;s own block, faster than real time. The transfer itself is recorded.</p>}
        <ReleaseCard card={now.card} live />
        {now.notify ? <NotificationPreview preview={now.notify} /> : <QuietNote />}
        <h3 style={{ margin: "8px 0 0", fontSize: 14 }}>What the watcher saw</h3>
        <ol className="watch-log">
          {seen.map((s, i) => (
            <li key={i} data-tone={s.card.result.tone}>
              <span className="mono">{s.card.invoiceId}</span> · {s.card.result.headline}
              <span className="muted"> · {s.notify ? "message previewed" : "quiet"}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
