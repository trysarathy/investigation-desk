"use client";

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

/** The rc5 Control pages keep full page loads (plain links): a client navigation here could stop half-way on the pilot build (Control journey, design-fluid). The merchant workspace menu uses client navigation with its own skeleton. */
export function ControlNav() {
  const path = usePathname() ?? "";
  const current = (href: string) => (href === "/control" ? path === "/control" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className={s.nav} aria-label="Clearline Control">
      <ul className={s.navList}>
        {ITEMS.map((i) => (
          <li key={i.href}><a href={i.href} aria-current={current(i.href) ? "page" : undefined}>{i.label}</a></li>
        ))}
      </ul>
    </nav>
  );
}
