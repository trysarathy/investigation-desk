"use client";

// Who is acting, for the audit log. Self-declared until sign-in lands (week 5); remembered in this
// browser only. Every inbox change, review decision and export sends it.

import { useEffect, useState } from "react";

const KEY = "desk.actor";
const EVENT = "desk-actor";

export function useActor(): string {
  const [actor, setActor] = useState("");
  useEffect(() => {
    // In demo mode the layout names a default (the fictional finance-ops lead), so the demo never stops to ask.
    const fallback = () => document.documentElement.dataset.demoActor ?? "";
    const read = () => { try { setActor(localStorage.getItem(KEY) || fallback()); } catch { setActor(fallback()); } };
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  return actor;
}

export function ActingAs() {
  const actor = useActor();
  const [draft, setDraft] = useState<string | undefined>();
  const value = draft ?? actor;
  const save = () => {
    try { localStorage.setItem(KEY, value.trim()); } catch { /* ignore */ }
    setDraft(undefined);
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <label className="muted" htmlFor="acting-as">Acting as</label>
      <input id="acting-as" value={value} onChange={(e) => setDraft(e.target.value)} placeholder="Your name" maxLength={60} style={{ width: 160 }} />
      {draft !== undefined && draft.trim() !== actor && <button className="btn btn-sm" type="submit">Save</button>}
      <span className="faint" style={{ fontSize: 12 }}>Recorded on every change. No sign-in yet (week 5).</span>
    </form>
  );
}

export function ActorLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const actor = useActor();
  if (!actor) return <span className="faint" title="Say who you are (Acting as) before exporting: downloads are audit-logged.">{children} (set Acting as)</span>;
  const sep = href.includes("?") ? "&" : "?";
  return <a className={className} href={`${href}${sep}actor=${encodeURIComponent(actor)}`}>{children}</a>;
}
