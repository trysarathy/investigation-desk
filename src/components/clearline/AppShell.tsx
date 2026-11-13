"use client";
import Link from "./Link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ActorSelect } from "./ActorSelect";
import { CONTACT_MAILTO, MARKETING_URL, NAV, crumbsFor, isActive } from "./nav";
import s from "./ui.module.css";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/clearline";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const segs = pathname.split("/");
  const detail = segs.length > 3 && segs[2] === "payments" ? decodeURIComponent(segs[3]) : undefined;
  const crumbs = crumbsFor(pathname, detail);

  return (
    <>
      <a className={s.skip} href="#cl-main">Skip to content</a>
      <div className={s.banner} role="region" aria-label="Test mode notice">
        <span className={s.marker} data-testid="test-mode-marker">TEST MODE · FICTIONAL DATA</span>
        <span>Simulated providers, quotes and statements. Clearline does not move or hold funds.</span>
        <span className={s.bannerLinks}>
          <Link href="/clearline/trial">Guided trial</Link>
          <a href={MARKETING_URL}>Clearline website</a>
          <a href={CONTACT_MAILTO}>Feedback</a>
        </span>
      </div>
      <div className={s.frame}>
        <aside className={s.sidebar}>
          <div className={s.sidebarTop}>
            <Link href="/clearline" className={s.brand} aria-label="Clearline console overview">
              <span className={s.brandMark} aria-hidden="true">C</span>
              <span className={s.brandWord}>clearline<span>.</span></span>
            </Link>
            <button type="button" className={`${s.btn} ${s.small} ${s.menuBtn}`} aria-expanded={open}
              aria-controls="cl-nav" onClick={() => setOpen((o) => !o)}>
              {open ? "Close menu" : "Menu"}
            </button>
          </div>
          <nav id="cl-nav" aria-label="Console" className={s.navWrap} data-open={open ? "true" : "false"}>
            {NAV.map((g) => (
              <div key={g.title} className={s.navGroup}>
                <p className={s.navTitle}>{g.title}</p>
                <ul className={s.navList}>
                  {g.items.map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className={s.navLink} aria-current={isActive(pathname, i.href) ? "page" : undefined}>
                        {i.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className={s.navFoot}>
              <Link href="/clearline/trial">Guided trial (5 cases)</Link>
              <Link href="/mentor-demo">Funding Desk prototype</Link>
              <a href={MARKETING_URL}>← clearline-marketing.vercel.app</a>
              <a href={CONTACT_MAILTO}>Contact / feedback</a>
            </div>
          </nav>
        </aside>
        <main id="cl-main" className={s.main} tabIndex={-1}>
          <div className={s.topRow}>
          <nav aria-label="Breadcrumb" className={s.crumbs}>
            <ol>
              {crumbs.map((c, i) => (
                <li key={i}>
                  {i === crumbs.length - 1 ? <span aria-current="page">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
                </li>
              ))}
            </ol>
          </nav>
          <ActorSelect id="cl-actor-global" />
          </div>
          {children}
          <footer className={s.footer}>
            Clearline test-mode console. All organisations, providers, quotes, balances and statements are fictional.
            No custody, payout execution, lending or compliance decisions. <a href={MARKETING_URL}>Website</a> ·{" "}
            <a href={CONTACT_MAILTO}>aashmiin.k.2025@accountancy.smu.edu.sg</a>
          </footer>
        </main>
      </div>
    </>
  );
}
