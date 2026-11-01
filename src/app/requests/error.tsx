"use client";

import Link from "next/link";

/** Requests couldn't be shown. The boundary only knows the render failed, so it claims nothing about payments. No raw error text. */
export default function RequestsError() {
  return (
    <div className="page">
      <section className="panel" role="alert" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>These requests couldn&apos;t be shown</h1>
        <p className="muted" style={{ margin: 0 }}>Something went wrong showing this page. Reload to see the latest status.</p>
        <div style={{ display: "flex", gap: 8 }}><button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button><Link className="btn" href="/requests">At a glance</Link></div>
      </section>
    </div>
  );
}
