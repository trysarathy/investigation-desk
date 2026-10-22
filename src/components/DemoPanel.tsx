"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DEMO_STEPS } from "@/lib/demo/files";
import { Mono } from "./Mono";
import { Status } from "./Status";

/** Loads or resets the demo workspace, and lists the demo hashes in demo-script order. */
export function DemoPanel({ active, preview, steps }: { active: boolean; preview: boolean; steps: typeof DEMO_STEPS }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const reset = async () => {
    setBusy(true);
    setDone(false);
    const res = await fetch("/api/demo/reset", { method: "POST" }).catch(() => undefined);
    setBusy(false);
    if (res?.ok) {
      setDone(true);
      router.refresh();
    }
  };

  return (
    <section className="panel" aria-label="Demo workspace">
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h2>Demo workspace</h2>
        {active ? <Status status="pass" label="In use" /> : <span className="faint">Not in use</span>}
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0 }}>
          Sample company Files A and B built around real, recorded public transfers. No customer data.
          {preview ? " This preview runs on it only; uploads are off." : " Loading it replaces any uploaded files."}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" onClick={reset} disabled={busy}>
            {busy ? "Resetting…" : active ? "Reset demo workspace" : "Load demo workspace"}
          </button>
          <a className="btn" href="/api/demo/bulk.csv">Download demo bulk file</a>
          {done && <span role="status"><Status status="pass" label="Reset: sample files loaded; demo cases and bulk runs cleared" /></span>}
        </div>
      </div>
      {active && (
        <div className="table-wrap" style={{ borderTop: "1px solid var(--border)" }}>
          <table className="table" aria-label="Demo hashes">
            <thead><tr><th>Shows</th><th>Hash</th><th>Reporting customer</th><th>Expect</th><th /></tr></thead>
            <tbody>
              {steps.map((s, i) => {
                const q = new URLSearchParams({ q: s.hash, ...(s.customer ? { customer: s.customer } : {}) });
                return (
                  <tr key={i} style={{ cursor: "default" }}>
                    <td style={{ whiteSpace: "normal" }}>{s.note}</td>
                    <td><Mono value={s.hash} head={8} tail={6} /></td>
                    <td className="mono">{s.customer ?? <span className="faint">—</span>}</td>
                    <td className="code">{s.expect}</td>
                    <td><Link href={`/investigate?${q}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="faint" style={{ margin: 0, padding: "8px 16px" }}>
            Demo step 5 (wrong address with a look-alike finding) is sample case CS-1048 in the queue.
          </p>
        </div>
      )}
    </section>
  );
}
