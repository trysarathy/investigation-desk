"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

declare global { interface Window { __deskQuietUntil?: number; __deskRender?: string } }

/**
 * Marks each server render of the page. The root layout renders it with a new value every time,
 * so a client can tell whether a refresh has actually landed.
 */
export function RenderStamp({ stamp }: { stamp: string }) {
  useEffect(() => { window.__deskRender = stamp; }, [stamp]);
  return null;
}

/**
 * After a change, re-read the page a few times. Background auto-refreshes pause meanwhile, so an older
 * refresh that started before the change can't land last and show stale data.
 *
 * Watchdog (QA, 29 Oct 2026): in about one change in four, Next's router.refresh() fetched the new
 * page but never showed it, so a decision looked ignored for 4 to 10+ seconds. If no refresh has
 * landed after 2.5 s, the page reloads. Pass { reload: false } where a reload would lose something
 * on screen (the sender's address-check result) or interrupt a sequence (the demo's payment playback).
 */
export function refreshAfterChange(router: { refresh: () => void }, { reload = true }: { reload?: boolean } = {}) {
  const before = window.__deskRender;
  window.__deskQuietUntil = Date.now() + 2500;
  router.refresh();
  for (const ms of [500, 1200, 2200]) setTimeout(() => router.refresh(), ms);
  if (reload && before !== undefined) setTimeout(() => { if (window.__deskRender === before) window.location.reload(); }, 2500);
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
