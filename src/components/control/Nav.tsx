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

/** Plain links (full page loads): every Control page is rendered on the server from the database for each request. */
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
