"use client";
/**
 * Navigation safety net (code review v2 L1).
 *
 * Every console route is dynamic and prefetch is off, so a click starts a fetch of the target's
 * server payload and commits when it arrives. Rarely, a click was swallowed: nothing committed and
 * nothing was in flight. The v2 net reloaded the target in full after 2.5 s whatever was happening,
 * so on a slow server a navigation that was still loading was replaced by a second, full load.
 *
 * Now the net asks the router first. Links (next/link `useLinkStatus`) and router pushes
 * (`useTransition`) report whether their navigation is in flight:
 *   - URL changed → done.
 *   - after NAV_CHECK_MS, nothing in flight and the URL unchanged → the click was swallowed: full load.
 *   - still in flight → a pending state is shown and we keep waiting; only a navigation still in
 *     flight after NAV_STALL_MS counts as failed and is loaded in full.
 * At most one watch runs at a time; Back/Forward cancels it. When a full load would lose work in this
 * tab (storage unavailable, or the unreadable-copy notice is open), the person is asked instead.
 */
import { useSyncExternalStore } from "react";

export const NAV_CHECK_MS = 2500;
export const NAV_STALL_MS = 10_000;
/** A pending state is only shown once a navigation takes longer than this (no flash on fast loads). */
export const NAV_PENDING_VISIBLE_MS = 400;
const POLL_MS = 200;

/** A full load that would lose unsaved work is never done silently: the person is asked instead. */
export type Stuck = { href: string; reason: string };
type Snapshot = { pending: boolean; stuck: Stuck | null };
let snapshot: Snapshot = { pending: false, stuck: null };
const listeners = new Set<() => void>();
function update(next: Partial<Snapshot>) {
  const merged = { ...snapshot, ...next };
  if (merged.pending === snapshot.pending && merged.stuck === snapshot.stuck) return;
  snapshot = merged;
  listeners.forEach((l) => l());
}
const set = (pending: boolean) => update(pending ? { pending } : { pending, stuck: null });

/**
 * Returns why a full page load would lose work in this tab (browser storage unavailable, or an
 * unreadable saved copy waiting for a decision so nothing is being saved), or null when it is safe.
 * Registered by the workspace provider (review rc3 m1).
 */
let guard: () => string | null = () => null;
export function setFullLoadGuard(fn: () => string | null) { guard = fn; }

/** The person chose to load the page in full after being told what would be lost. */
export function loadFully() {
  const s = snapshot.stuck;
  if (!s) return;
  stop();
  window.location.assign(s.href);
}

/** Number of navigations the router reports as in flight (links + router pushes). */
let inFlight = 0;
export function reportInFlight(on: boolean) {
  inFlight = Math.max(0, inFlight + (on ? 1 : -1));
}

let timer = 0;
let onPop: (() => void) | null = null;
function stop() {
  if (timer) window.clearInterval(timer);
  timer = 0;
  if (onPop) window.removeEventListener("popstate", onPop);
  onPop = null;
}

/** Watches one client navigation to `href` and falls back to a full load only on a real failure. */
export function watchNavigation(href: string) {
  if (typeof window === "undefined") return;
  let to: URL;
  try { to = new URL(href, window.location.href); } catch { return; }
  const from = window.location.pathname + window.location.search;
  if (to.origin !== window.location.origin || to.pathname + to.search === from) return;
  stop();
  update({ stuck: null });
  const started = Date.now();
  onPop = () => { stop(); set(false); };
  window.addEventListener("popstate", onPop, { once: true });
  let asked = false;
  timer = window.setInterval(() => {
    if (window.location.pathname + window.location.search !== from) { stop(); set(false); return; }
    if (asked) return; // waiting for the person; a late commit above still clears it
    const elapsed = Date.now() - started;
    if (elapsed >= NAV_PENDING_VISIBLE_MS) set(true);
    const swallowed = elapsed >= NAV_CHECK_MS && inFlight === 0;
    const stalled = elapsed >= NAV_STALL_MS;
    if (swallowed || stalled) {
      const why = guard();
      if (why) { asked = true; update({ stuck: { href: to.href, reason: why } }); return; }
      stop();
      window.location.assign(to.href);
    }
  }, POLL_MS);
}

/** True while a watched navigation has been loading for longer than NAV_PENDING_VISIBLE_MS. */
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useNavPending(): boolean {
  return useSyncExternalStore(subscribe, () => snapshot.pending, () => false);
}
/** Set when a full load is needed but would lose unsaved work; the shell asks the person. */
export function useNavStuck(): Stuck | null {
  return useSyncExternalStore(subscribe, () => snapshot.stuck, () => null);
}
