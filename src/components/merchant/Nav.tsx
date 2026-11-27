"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import m from "./merchant.module.css";

export interface NavItem { href: string; label: string }

/**
 * v1 design-fluid: client navigation with prefetch (next/link) for the menu routes. Every page is still rendered on the
 * server from the database for each request; only the navigation between them is faster.
 */
export function MerchantNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname() ?? "";
  // an item whose path is the prefix of another item's (the daily report under /control/merchant) is current only on its own page
  const isRoot = (href: string) => items.some((i) => i.href !== href && i.href.startsWith(`${href}/`));
  const current = (href: string) => (isRoot(href) ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={m.mnav} aria-label={label}>
      <ul className={m.mnavList}>
        {items.map((i) => <li key={i.href}><Link href={i.href} prefetch aria-current={current(i.href) ? "page" : undefined}>{i.label}</Link></li>)}
      </ul>
    </nav>
  );
}
