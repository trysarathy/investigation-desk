"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PageSkeleton } from "./Skeleton";

/**
 * v1 design-fluid: while a menu link's client navigation is on its way, the old page is replaced by a skeleton at once
 * (so nobody acts on the page they are leaving), until the new page arrives. The new page is always rendered on the
 * server for the request; nothing stale is shown.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();
const set = (v: string | null) => { pending = v; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Call from a link's onClick: marks a navigation to `href` as pending (ignored for modified clicks and the current URL). */
export function startNavigation(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number; defaultPrevented: boolean }, href: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (typeof location !== "undefined" && `${location.pathname}${location.search}` === href) return;
  set(href);
}

/** Wraps the page content: shows the skeleton while a navigation is pending. */
export function NavPendingFrame({ children }: { children: ReactNode }) {
  const p = useSyncExternalStore(subscribe, () => pending, () => null);
  const path = usePathname();
  const search = useSearchParams();
  const [, force] = useState(0);
  // the new page has arrived (or the URL changed some other way): show it
  useEffect(() => { if (pending) set(null); force((n) => n + 1); }, [path, search]);
  // never hide a page for long if a navigation fails
  useEffect(() => { if (!p) return; const t = setTimeout(() => set(null), 15_000); return () => clearTimeout(t); }, [p]);
  return (
    <>
      {p ? <PageSkeleton label="Loading the page…" /> : null}
      <div style={{ display: p ? "none" : "contents" }}>{children}</div>
    </>
  );
}
