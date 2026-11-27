"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

/** v1 design-fluid: next/link with prefetch for the menu routes; every Control page is still rendered on the server for each request. */
export function ControlNav() {
  const path = usePathname() ?? "";
  const current = (href: string) => (href === "/control" ? path === "/control" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={s.nav} aria-label="Clearline Control">
      <ul className={s.navList}>
        {ITEMS.map((i) => (
          <li key={i.href}><Link href={i.href} prefetch aria-current={current(i.href) ? "page" : undefined}>{i.label}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
