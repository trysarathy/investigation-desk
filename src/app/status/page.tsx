import type { Metadata } from "next";
import { loadStatus, type ComponentState } from "@/server/ops/status";

// v1 phase 5.5: the public status page (src/server/ops/status.ts). Served past the deployment gates only with
// CLEARLINE_PUBLIC_STATUS=1 (src/middleware.ts). Shows component states and the operator's incident notes, nothing else.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clearline status", robots: { index: false } };

const LABEL: Record<ComponentState, string> = { operational: "Operational", degraded: "Degraded", outage: "Outage" };
const COLOUR: Record<ComponentState, string> = { operational: "#1f7a3d", degraded: "#9a6100", outage: "#b42318" };
const fmt = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function StatusPage() {
  const s = await loadStatus();
  const headline = s.overall === "operational" ? "All systems operational" : s.overall === "degraded" ? "Some systems are degraded" : "Some systems are down";
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 16px", fontFamily: "Inter, system-ui, sans-serif", color: "#1a1a1a", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Clearline status</h1>
      <p style={{ margin: "0 0 24px", fontWeight: 600, color: COLOUR[s.overall] }} data-testid="status-overall">{headline}</p>
      <section aria-labelledby="components">
        <h2 id="components" style={{ fontSize: 16 }}>Components</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, border: "1px solid #ddd", borderRadius: 8 }}>
          {s.components.map((c, i) => (
            <li key={c.id} data-testid={`status-${c.id}`} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderTop: i ? "1px solid #eee" : undefined }}>
              <span>{c.name}</span><span style={{ color: COLOUR[c.state], fontWeight: 600 }}>{LABEL[c.state]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="incidents" style={{ marginTop: 32 }}>
        <h2 id="incidents" style={{ fontSize: 16 }}>Incidents</h2>
        {!s.incidents.ok ? <p>Incident notes are unavailable right now.</p>
          : s.incidents.incidents.length === 0 ? <p>No incidents in the last 14 days.</p>
          : s.incidents.incidents.map((inc) => (
            <article key={inc.id} style={{ borderLeft: `3px solid ${inc.status === "resolved" ? "#999" : COLOUR[inc.impact === "major" ? "outage" : "degraded"]}`, padding: "4px 12px", margin: "0 0 20px" }}>
              <h3 style={{ fontSize: 15, margin: "0 0 2px" }}>{inc.title}</h3>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "#555" }}>
                {inc.status[0].toUpperCase() + inc.status.slice(1)} · started {fmt(inc.startedAt)}{inc.resolvedAt ? ` · resolved ${fmt(inc.resolvedAt)}` : ""}
              </p>
              {inc.updates.map((u, i) => <p key={i} style={{ margin: "0 0 6px", fontSize: 14 }}><strong>{fmt(u.at)}</strong> — {u.text}</p>)}
            </article>
          ))}
      </section>
      <p style={{ marginTop: 32, fontSize: 12, color: "#666" }}>Checked {fmt(s.checkedAt)}. This page shows whether the service is working; it says nothing about any customer&apos;s data.</p>
    </main>
  );
}
