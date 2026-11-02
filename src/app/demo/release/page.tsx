// S1 + demo watcher (DEMO ONLY): "Paid / not yet / problem" for a person deciding whether to release goods.

import Link from "next/link";
import { notFound } from "next/navigation";
import { NotificationPreview, QuietNote } from "@/components/demo-slices/NotificationPreview";
import { ReleaseCard } from "@/components/demo-slices/ReleaseCard";
import { Watcher } from "@/components/demo-slices/Watcher";
import { demoSlicesOn } from "@/lib/demo-slices/gate";
import { card, DEMO_WATCH_ID, DEMO_WATCH_LABEL, notificationFor, watchTimeline } from "@/lib/demo-slices/release";
import { scenario, scenarios, scenariosForHash } from "@/lib/demo-slices/replay";
import { DemoHead } from "../DemoHead";

export const dynamic = "force-dynamic";

type Params = { hash?: string; s?: string; at?: string; paused?: string };

export default async function ReleaseDemo({ searchParams }: { searchParams: Promise<Params> }) {
  if (!demoSlicesOn()) notFound();
  const q = await searchParams;
  const steps = await watchTimeline(DEMO_WATCH_ID);
  const hash = q.hash?.trim();
  const fromHash = hash ? scenariosForHash(hash) : [];
  const ids = q.s && scenario(q.s) ? [q.s] : fromHash.map((s) => s.id);
  const cards = await Promise.all(ids.map((id) => card(id)));
  const badHash = hash && !/^(0x)?[0-9a-fA-F]{64}$/.test(hash);
  return (
    <div className="page demo-page">
      <DemoHead title="Release check" current="/demo/release" />
      {cards.length > 0 && (
        <section aria-label="Result" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cards.map((c) => {
            const n = notificationFor(c);
            return (
              <div key={c.scenarioId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ReleaseCard card={c} />
                {n ? <NotificationPreview preview={n} /> : <QuietNote />}
                {c.result.tone === "paid" && <Link href={`/demo/entry?s=${c.scenarioId}`}>See it matched to its invoice and the proposed Xero entry</Link>}
              </div>
            );
          })}
        </section>
      )}
      {!q.s && <Watcher steps={steps} label={DEMO_WATCH_LABEL} initial={Number(q.at) || 1} autoplay={q.paused !== "1"} />}
      <section className="panel" aria-labelledby="paste-h">
        <div className="panel-h"><h2 id="paste-h" style={{ margin: 0, fontSize: 15 }}>Or paste a transaction hash</h2></div>
        <form className="panel-b" method="get" action="/demo/release">
          <label htmlFor="hash" className="muted" style={{ fontSize: 13 }}>This demo knows only the 20 recorded transfers. A hash it doesn&apos;t know is not looked up.</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="hash" name="hash" className="input mono" defaultValue={hash ?? ""} placeholder="0x…" autoComplete="off" spellCheck={false} style={{ flex: "1 1 240px", minWidth: 0 }} />
            <button className="btn btn-primary" type="submit">Check</button>
          </div>
          {badHash && <p role="alert" className="bar bar-red" style={{ margin: 0 }}>That isn&apos;t a transaction hash (64 letters and numbers, optionally starting 0x). Nothing was looked up.</p>}
          {hash && !badHash && !fromHash.length && <p role="alert" className="bar bar-amber" style={{ margin: 0 }}>This demo doesn&apos;t have that transfer recorded, so nothing was looked up. Pick one of the sample transfers below.</p>}
        </form>
      </section>
      <section className="panel" aria-labelledby="samples-h">
        <div className="panel-h"><h2 id="samples-h" style={{ margin: 0, fontSize: 15 }}>The 20 sample transfers</h2></div>
        <ul className="panel-b sample-list">
          {scenarios().map((s) => <li key={s.id}><Link href={`/demo/release?s=${s.id}`}>{s.id}</Link> <span className="muted">· {s.title}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
