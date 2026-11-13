"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Shared";
import { TRIAL_URL } from "@/lib/site";

const NAV = [
  { href: "/platform", label: "Platform" },
  { href: "/connect", label: "Connect" },
  { href: "/control", label: "Control" },
  { href: "/use-cases", label: "Use cases" },
  { href: "/developers", label: "Developers" },
  { href: "/trial", label: "Customer trial" },
  { href: "/about", label: "About" },
];

export default function Header() {
  const pathname = usePathname() || "/";
  const current = (href: string) => (pathname === href || pathname === href + "/" ? { "aria-current": "page" as const } : {});
  return (
    <header className="site-header">
      <div className="container header-row">
        <Logo />
        <nav className="nav-desktop" aria-label="Main">
          {NAV.map(n => <Link key={n.href} href={n.href} {...current(n.href)}>{n.label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link className="header-contact" href="/contact" {...current("/contact")}>Contact</Link>
          <a className="btn btn-primary btn-sm" href={TRIAL_URL} target="_blank" rel="noopener noreferrer">
            Explore Clearline<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span>
          </a>
        </div>
        {/* key resets the open state after client-side navigation */}
        <details className="nav-mobile" key={pathname}>
          <summary aria-label="Menu">Menu</summary>
          <nav className="nav-mobile-panel" aria-label="Mobile">
            {NAV.map(n => <Link key={n.href} href={n.href} {...current(n.href)}>{n.label}</Link>)}
            <Link href="/onchain" {...current("/onchain")}>Onchain</Link>
            <Link href="/contact" {...current("/contact")}>Contact</Link>
            <a href={TRIAL_URL} target="_blank" rel="noopener noreferrer">Explore Clearline<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span></a>
          </nav>
        </details>
      </div>
    </header>
  );
}
