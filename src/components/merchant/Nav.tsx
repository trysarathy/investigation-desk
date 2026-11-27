"use client";

import { usePathname } from "next/navigation";
import m from "./merchant.module.css";

export interface NavItem { href: string; label: string }

/**
 * v1 design-fluid: plain links (a full, server-rendered page load), as the Control menu. Measured on the production build:
 * a full load of a menu page is a steady ~400-500 ms; a client navigation of these dynamic pages streamed the new page in
 * at ~400 ms or ~880 ms (median 853 ms over 10 clicks), so it was slower for the person clicking.
 */
export function MerchantNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname() ?? "";
  // an item whose path is the prefix of another item's (the daily report under /control/merchant) is current only on its own page
  const isRoot = (href: string) => items.some((i) => i.href !== href && i.href.startsWith(`${href}/`));
  const current = (href: string) => (isRoot(href) ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={m.mnav} aria-label={label}>
      <ul className={m.mnavList}>
        {items.map((i) => <li key={i.href}><a href={i.href} aria-current={current(i.href) ? "page" : undefined}>{i.label}</a></li>)}
      </ul>
    </nav>
  );
}
