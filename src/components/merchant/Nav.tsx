"use client";

import { usePathname } from "next/navigation";
import m from "./merchant.module.css";

export interface NavItem { href: string; label: string }

/** Plain links (full page loads): every page is rendered on the server from the database for each request. */
export function MerchantNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname() ?? "";
  const root = items[0]?.href;
  const current = (href: string) => (href === root ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={m.mnav} aria-label={label}>
      <ul className={m.mnavList}>
        {items.map((i) => <li key={i.href}><a href={i.href} aria-current={current(i.href) ? "page" : undefined}>{i.label}</a></li>)}
      </ul>
    </nav>
  );
}
