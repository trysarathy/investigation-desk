"use client";

import { useId, useState } from "react";
import m from "./merchant.module.css";

/**
 * Demo build only: the role switcher. The layout imports it only inside the demo-build branch and renders it only for
 * a signed-in member of demo organisations (Demo · fictional data). Switching signs out and signs in as the chosen
 * seeded demo user (a real session for that user, src/server/demo-switch.ts): what that user then does is recorded as
 * that user, and every rule (a preparer never approves) still applies.
 */
export function DemoSwitcher({ users, current }: { users: { email: string; label: string; note: string }[]; current: string }) {
  const id = useId();
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });
  const others = users.filter((u) => u.email !== current);
  async function go(email: string) {
    setState({ busy: true, message: `Signing in as ${email}…` });
    try {
      const res = await fetch("/api/control/demo/switch", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const body = (await res.json().catch(() => null)) as { next?: string; error?: { message?: string } } | null;
      if (res.ok) { window.location.assign(body?.next ?? "/control/merchant"); return; }
      setState({ busy: false, message: body?.error?.message ?? `The switch was refused (HTTP ${res.status}).` });
    } catch { setState({ busy: false, message: "The server could not be reached. Nothing changed." }); }
  }
  if (others.length === 0) return null;
  return (
    <form className={m.demoSwitch} data-testid="demo-switcher" data-demo-build="clearline-demo-switcher[demo-build-only]" aria-label="Demo role switcher" onSubmit={(ev) => { ev.preventDefault(); void go(String(new FormData(ev.currentTarget).get("email") ?? "")); }}>
      <label htmlFor={id}>Sign in as</label>
      <select id={id} name="email" defaultValue={others[0].email} disabled={state.busy}>
        {others.map((u) => <option key={u.email} value={u.email}>{u.label} ({u.email})</option>)}
      </select>
      <button type="submit" disabled={state.busy} data-testid="demo-switch-button">Switch</button>
      {state.message ? <span role="status"> {state.message}</span> : null}
    </form>
  );
}
