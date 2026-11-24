"use client";

import { usePathname } from "next/navigation";
import m from "./merchant.module.css";

export interface NavItem { href: string; label: string }

/** Plain links (full page loads): every page is rendered on the server from the database for each request. */
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
