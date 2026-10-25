"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

declare global { interface Window { __deskQuietUntil?: number } }

/**
 * After a change, re-read the page a few times. Background auto-refreshes pause meanwhile, so an older
 * refresh that started before the change can't land last and show stale data.
 */
export function refreshAfterChange(router: { refresh: () => void }) {
  window.__deskQuietUntil = Date.now() + 2500;
  router.refresh();
  for (const ms of [500, 1200, 2200]) setTimeout(() => router.refresh(), ms);
}

/** Re-reads the page's server data every `ms` while the tab is visible, so status changes appear by themselves. */
export function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() > (window.__deskQuietUntil ?? 0)) router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [router, ms]);
  return null;
}
