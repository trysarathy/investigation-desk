"use client";

import Link from "next/link";

/** Requests couldn't be read (e.g. the store is unreadable). No raw error text on screen. */
export default function RequestsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <section className="panel" role="alert" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>These requests couldn&apos;t load</h1>
        <p className="muted" style={{ margin: 0 }}>Your data hasn&apos;t changed and no payment status was updated. Try again, or go to At a glance.</p>
        <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" onClick={reset}>Try again</button><Link className="btn" href="/requests">At a glance</Link></div>
      </section>
    </div>
  );
}
