"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startNavigation } from "@/components/ui/NavPending";
import m from "./merchant.module.css";

export interface NavItem { href: string; label: string }

/**
 * v1 design-fluid: client navigation with next/link for the menu routes, prefetched on hover or focus (for these
 * dynamic pages: the layout and the loading skeleton, never stale page data). Every page is still rendered on the server
 * from the database for each request; the old page gives way to a skeleton at once (NavPendingFrame).
 */
export function MerchantNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname() ?? "";
  const router = useRouter();
  // prefetch on intent (hover or focus): the layout and loading skeleton of a dynamic page, never its data, and only
  // for the link the person is about to use (not every menu route on every page view)
  const intent = (href: string) => () => router.prefetch(href);
  // an item whose path is the prefix of another item's (the daily report under /control/merchant) is current only on its own page
  const isRoot = (href: string) => items.some((i) => i.href !== href && i.href.startsWith(`${href}/`));
  const current = (href: string) => (isRoot(href) ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={m.mnav} aria-label={label}>
      <ul className={m.mnavList}>
        {items.map((i) => <li key={i.href}><Link href={i.href} prefetch={false} onMouseEnter={intent(i.href)} onFocus={intent(i.href)} onClick={(e) => startNavigation(e, i.href)} aria-current={current(i.href) ? "page" : undefined}>{i.label}</Link></li>)}
      </ul>
    </nav>
  );
}
