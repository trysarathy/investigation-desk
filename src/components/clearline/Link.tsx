"use client";
/**
 * next/link with prefetch off, plus a safety net so a click is never swallowed (navguard.ts).
 *
 * Every console route is dynamic. With prefetch on, about 1 in 10 clicks in a production build
 * (`next start`) fetched the route but never committed the navigation (measured with Playwright,
 * 2026-11-13). With prefetch off it became rare but not impossible. The net falls back to a full
 * page load only when the router reports no navigation in flight, or when one has stalled; a slow
 * server therefore never causes a second load of the same page (code review v2 L1).
 */
import NextLink, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useTransition, type ComponentProps, type MouseEvent } from "react";
import { reportInFlight, watchNavigation } from "./navguard";

function target(href: ComponentProps<typeof NextLink>["href"]): URL | null {
  if (typeof window === "undefined") return null;
  // An object href may carry `query` instead of `search` (review rc3 n6): keep it either way.
  const search = typeof href === "string" ? "" : href.search
    ?? (href.query && typeof href.query === "object"
      ? (() => { const q = new URLSearchParams(Object.entries(href.query).flatMap(([k, v]) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => [k, String(x)] as [string, string]))).toString(); return q ? `?${q}` : ""; })()
      : typeof href.query === "string" && href.query ? `?${href.query}` : "");
  const raw = typeof href === "string" ? href : `${href.pathname ?? ""}${search}${href.hash ?? ""}`;
  try {
    const u = new URL(raw, window.location.href);
    return u.origin === window.location.origin ? u : null;
  } catch {
    return null;
  }
}

/** Kept for callers of the v2 API: watches a navigation to `href`. */
export const ensureNavigation = watchNavigation;

/** Reports this link's navigation to the safety net while the router says it is in flight. */
function InFlightProbe() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    reportInFlight(true);
    return () => reportInFlight(false);
  }, [pending]);
  return null;
}

/**
 * router.push / router.replace inside a transition, so the safety net knows when the navigation is
 * still in flight. `scroll: false` keeps the position (used by filters that only change the query).
 */
export function useNavigate() {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!pending) return;
    reportInFlight(true);
    return () => reportInFlight(false);
  }, [pending]);
  return useCallback((href: string, mode: "push" | "replace" = "push", opts?: { scroll?: boolean }) => {
    watchNavigation(href);
    start(() => router[mode](href, opts?.scroll === false ? { scroll: false } : undefined));
  }, [router]);
}

export default function Link({ onClick, children, ...props }: ComponentProps<typeof NextLink>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // next/link prevents default only after this handler; here defaultPrevented means a caller cancelled the click.
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || props.target === "_blank") return;
    const to = target(props.href);
    if (!to) return;
    const from = window.location.pathname + window.location.search;
    if (to.pathname + to.search === from) return; // same page (e.g. a #fragment link): nothing to commit
    watchNavigation(to.href);
  };
  return <NextLink prefetch={false} {...props} onClick={handle}>{children}<InFlightProbe /></NextLink>;
}
