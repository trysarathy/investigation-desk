"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import s from "./control.module.css";

const ITEMS = [
  { href: "/control", label: "Overview" },
  { href: "/control/payments", label: "Payments" },
  { href: "/control/investigations", label: "Investigations" },
  { href: "/control/reconciliation", label: "Reconciliation" },
  { href: "/control/accounting", label: "Accounting" },
  { href: "/control/audit", label: "Audit" },
  { href: "/control/settings", label: "Settings" },
];

/** v1 design-fluid: next/link (prefetched on hover or focus: layout and loading state only, never stale data) for the menu routes; every Control page is still rendered on the server for each request. */
export function ControlNav() {
  const path = usePathname() ?? "";
  const router = useRouter();
  // prefetch on intent (hover or focus): the layout and loading skeleton of a dynamic page, never its data, and only
  // for the link the person is about to use (not every menu route on every page view)
  const intent = (href: string) => () => router.prefetch(href);
  const current = (href: string) => (href === "/control" ? path === "/control" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={s.nav} aria-label="Clearline Control">
      <ul className={s.navList}>
        {ITEMS.map((i) => (
          <li key={i.href}><Link href={i.href} prefetch={false} onMouseEnter={intent(i.href)} onFocus={intent(i.href)} aria-current={current(i.href) ? "page" : undefined}>{i.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
