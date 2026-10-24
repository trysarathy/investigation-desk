"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatTime } from "@/lib/format";
import type { ExceptionSettings } from "@/lib/payments/settings";
import { useActor } from "./ActingAs";

/** Route settings as JSON: deadline, grace, expected legs and fee rule per route. Saved as a new version. */
export function RoutesEditor({ settings }: { settings: ExceptionSettings }) {
  const router = useRouter();
  const actor = useActor();
  const [text, setText] = useState(JSON.stringify(settings.routes, null, 2));
  const [msg, setMsg] = useState<{ error: boolean; text: string } | undefined>();
  const save = async () => {
    let routes: unknown;
    try { routes = JSON.parse(text); } catch { setMsg({ error: true, text: "Not valid JSON." }); return; }
    const res = await fetch("/api/inbox/routes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, routes }) });
    const json = await res.json();
    if (json.errors?.length) setMsg({ error: true, text: json.errors.join(" ") });
    else { setMsg({ error: false, text: "Saved as a new version. Exceptions were recomputed." }); router.refresh(); }
  };
  return (
    <details className="panel" style={{ padding: 16 }}>
      <summary><strong>Routes and deadlines</strong> <span className="faint">v{settings.version} · {settings.updatedBy} · {settings.updatedAt ? formatTime(settings.updatedAt) : "never changed"}</span></summary>
      <p className="muted" style={{ margin: "8px 0" }}>
        First route whose provider, chain and token match wins; the last must match anything. <span className="mono">deadlineMinutes</span> applies unless the instruction
        has its own <span className="mono">due_by</span>. <span className="mono">graceMinutes</span>: how long a missing leg may lag its previous stage.
        <span className="mono"> fee</span>: <span className="mono">{`{"kind":"none"}`}</span>, <span className="mono">{`{"kind":"fixed","amount":"1.00"}`}</span> or <span className="mono">{`{"kind":"percent_bps","bps":50}`}</span>.
        Only a fee record or this rule can explain an amount difference.
      </p>
      <textarea className="mono" value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(30, text.split("\n").length + 1)} style={{ width: "100%" }} aria-label="Routes JSON" />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={() => void save()} disabled={!actor}>Save routes</button>
        {!actor && <span className="faint">Set Acting as first.</span>}
      </div>
      {msg && <div className={`bar ${msg.error ? "bar-red" : "bar-info"}`} style={{ marginTop: 8 }} role={msg.error ? "alert" : "status"}>{msg.text}</div>}
    </details>
  );
}
