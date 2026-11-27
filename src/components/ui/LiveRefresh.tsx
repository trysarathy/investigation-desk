"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { shouldPause, updatedAgo } from "./logic";
import { IconRefresh } from "./icons";
import u from "./ui.module.css";

/** Forms with input the person has not submitted yet (tracked document-wide, so every form on the page counts). */
const dirty = new Set<HTMLFormElement>();

function submitting(): boolean {
  // a form is submitting while it says so (aria-busy) or its submit button is disabled mid-request
  return !!document.querySelector('form[aria-busy="true"], form button[type="submit"]:disabled, form [aria-busy="true"]');
}

export interface LiveRefreshProps {
  /** How often to refresh while the tab is visible (default 12 s). */
  intervalMs?: number;
  className?: string;
}

/**
 * Keeps a server-rendered page current: router.refresh() every intervalMs while the tab is visible, paused while any
 * form on the page has unsaved input or is submitting, or a dialog is open. Shows "Updated Ns ago" (aria-live off: it
 * is not announced) and a manual refresh button.
 */
export function LiveRefresh({ intervalMs = 12_000, className }: LiveRefreshProps) {
  const router = useRouter();
  const path = usePathname();
  const [last, setLast] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [paused, setPaused] = useState(false);
  const lastRef = useRef(last);

  const refresh = useCallback(() => {
    router.refresh();
    const t = Date.now();
    lastRef.current = t;
    setLast(t);
  }, [router]);

  useEffect(() => {
    const mark = (e: Event) => { const f = (e.target as HTMLInputElement | null)?.form; if (f) dirty.add(f); };
    const clear = (e: Event) => { if (e.target instanceof HTMLFormElement) dirty.delete(e.target); };
    document.addEventListener("input", mark, true);
    document.addEventListener("change", mark, true);
    document.addEventListener("submit", clear, true);
    document.addEventListener("reset", clear, true);
    return () => {
      document.removeEventListener("input", mark, true);
      document.removeEventListener("change", mark, true);
      document.removeEventListener("submit", clear, true);
      document.removeEventListener("reset", clear, true);
    };
  }, []);

  // a new page starts clean
  useEffect(() => { dirty.clear(); const t = Date.now(); lastRef.current = t; setLast(t); }, [path]);

  useEffect(() => {
    const tick = () => {
      for (const f of dirty) if (!f.isConnected) dirty.delete(f);
      const p = shouldPause({ hidden: document.visibilityState !== "visible", dirtyForms: dirty.size, submitting: submitting(), dialogOpen: !!document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') });
      setPaused(p);
      setNow(Date.now());
      if (!p && Date.now() - lastRef.current >= intervalMs) refresh();
    };
    const id = setInterval(tick, 1000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [intervalMs, refresh]);

  return (
    <span className={[u.live, paused ? u.livePaused : "", className ?? ""].filter(Boolean).join(" ")} data-testid="live-refresh">
      <span className={u.liveDot} aria-hidden="true" />
      <span aria-live="off">{updatedAgo(now - last)}{paused ? " · paused" : ""}</span>
      <button type="button" className={u.iconButton} style={{ color: "inherit" }} aria-label="Refresh now" title="Refresh now" onClick={refresh}><IconRefresh /></button>
    </span>
  );
}
