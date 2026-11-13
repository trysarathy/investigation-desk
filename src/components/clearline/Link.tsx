"use client";
/**
 * next/link with prefetch off, plus a safety net so a click is never swallowed.
 *
 * Every console route is dynamic. With prefetch on, about 1 in 10 clicks in a production build
 * (`next start`) fetched the route but never committed the navigation (measured with Playwright,
 * 2026-11-13). With prefetch off it became rare but not impossible (1 failure in a full suite run
 * of ~60 navigations, 2026-11-13). So: if a plain left-click on an internal link has not changed the
 * URL within NAV_FALLBACK_MS, the browser is sent to the same URL with a full page load. Nothing is
 * lost: the workspace is saved to browser storage on every change.
 */
import NextLink from "next/link";
import type { ComponentProps, MouseEvent } from "react";

const NAV_FALLBACK_MS = 2500;
let pending = 0;

function target(href: ComponentProps<typeof NextLink>["href"]): URL | null {
  if (typeof window === "undefined") return null;
  const raw = typeof href === "string" ? href : `${href.pathname ?? ""}${href.search ?? ""}${href.hash ?? ""}`;
  try {
    const u = new URL(raw, window.location.href);
    return u.origin === window.location.origin ? u : null;
  } catch {
    return null;
  }
}

/**
 * Safety net for any client navigation (Link click, router.push/replace): if the URL has not changed
 * within NAV_FALLBACK_MS, load the target in full. One pending fallback at a time; Back/Forward cancels it.
 */
export function ensureNavigation(href: string) {
  if (typeof window === "undefined") return;
  const to = new URL(href, window.location.href);
  const from = window.location.pathname + window.location.search;
  if (to.origin !== window.location.origin || to.pathname + to.search === from) return;
  if (pending) window.clearTimeout(pending);
  const cancel = () => { if (pending) window.clearTimeout(pending); pending = 0; };
  window.addEventListener("popstate", cancel, { once: true });
  pending = window.setTimeout(() => {
    pending = 0;
    window.removeEventListener("popstate", cancel);
    if (window.location.pathname + window.location.search === from) window.location.assign(to.href);
  }, NAV_FALLBACK_MS);
}

/** router.push / router.replace with the same safety net. */
export function navigate(router: { push: (h: string) => void; replace: (h: string) => void }, href: string, mode: "push" | "replace" = "push") {
  ensureNavigation(href);
  router[mode](href);
}

export default function Link({ onClick, ...props }: ComponentProps<typeof NextLink>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // next/link prevents default only after this handler; here defaultPrevented means a caller cancelled the click.
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || props.target === "_blank") return;
    const to = target(props.href);
    if (!to) return;
    const from = window.location.pathname + window.location.search;
    const dest = to.pathname + to.search;
    if (dest === from) return; // same page (e.g. a #fragment link): nothing to commit
    ensureNavigation(to.href);
  };
  return <NextLink prefetch={false} {...props} onClick={handle} />;
}
