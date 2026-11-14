"use client";
import Link from "./Link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ActorSelect } from "./ActorSelect";
import { useWorkspace } from "./workspace";
import { download } from "./download";
import { CONTACT_MAILTO, FUNDING_DESK_HREF, MARKETING_URL, PRIMARY, SECONDARY, crumbsFor, isActive } from "./nav";
import { loadFully, useNavPending, useNavStuck } from "./navguard";
import s from "./ui.module.css";

function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { return v; }
}

/**
 * A saved workspace that cannot be read is never replaced silently (review m6): the sample is shown,
 * nothing is saved over the old copy, and the person chooses what happens to it.
 */
function DiscardedNotice() {
  const { discarded, replaceDiscarded } = useWorkspace();
  const [failure, setFailure] = useState<string | null>(null);
  if (!discarded) return null;
  return (
    <div className={s.notice} role="alert" data-testid="workspace-discarded">
      <p style={{ margin: "0 0 6px" }}><strong>Your saved workspace could not be read.</strong> You are seeing the sample workspace instead. The saved copy has not been changed, and nothing you do now is saved until you choose below.</p>
      <p style={{ margin: "0 0 8px" }}>Reason: {discarded.reason}</p>
      <div className={s.actions}>
        <button type="button" className={`${s.btn} ${s.small}`} onClick={() => download("clearline-workspace-unreadable.json", discarded.raw, "application/json")}>Download the unreadable copy</button>
        <button type="button" className={`${s.btn} ${s.small} ${s.primary}`} onClick={() => { const r = replaceDiscarded(); setFailure(r.ok ? null : r.reason); }}>Replace it with the sample (keeps a backup in this browser)</button>
      </div>
      {failure && (
        <div style={{ marginTop: 8 }} data-testid="replace-failed">
          <p className={`${s.status} ${s.statusErr}`}>{failure}</p>
          <button type="button" className={`${s.btn} ${s.small}`} onClick={() => replaceDiscarded({ withoutBackup: true })}>Replace without a backup (the unreadable copy is deleted)</button>
        </div>
      )}
    </div>
  );
}

/** Shown only while a page change takes longer than usual; announced politely to screen readers. */
function NavPending() {
  const pending = useNavPending();
  return (
    <p className={s.navPending} role="status" data-testid="nav-pending" data-pending={pending ? "true" : "false"}>
      {pending ? "Loading page…" : ""}
    </p>
  );
}

/**
 * A workspace saved by an earlier version was updated by this version's engine on load (loadWorkspace
 * migrations). Each change is listed in the engine's words, with links; the person dismisses it.
 */
function MigrationNotice() {
  const { migrations, dismissMigrations } = useWorkspace();
  if (!migrations) return null;
  return (
    <div className={`${s.notice} ${s.noticeInfo}`} role="status" data-testid="workspace-migrated">
      <p style={{ margin: "0 0 6px" }}><strong>Your saved workspace was updated by this version.</strong>{" "}
        {migrations.saved ? "The copy as it was is kept as a backup in Settings." : "The update could not be saved in this browser, so the saved copy is unchanged and it will be updated again next time."}</p>
      <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
        {migrations.items.map((m) => (
          <li key={m.auditId}>
            Your saved workspace was updated by this version: {m.text}{" "}
            <Link href={`/clearline/payments/${m.intentId}`}>Open payment {m.internalReference}</Link>
            {m.exceptionId && <> · <Link href={`/clearline/exceptions?view=all&intent=${m.intentId}#${m.exceptionId}`}>exception {m.exceptionId}</Link></>}
          </li>
        ))}
      </ul>
      <button type="button" className={`${s.btn} ${s.small}`} onClick={dismissMigrations}>Dismiss</button>
    </div>
  );
}

/** A page change stalled while a full load would lose unsaved work: ask, never reload silently. */
function NavStuck() {
  const stuck = useNavStuck();
  if (!stuck) return null;
  return (
    <div className={s.notice} role="alert" data-testid="nav-stuck">
      <p style={{ margin: "0 0 8px" }}><strong>This page is taking long to load.</strong> Loading it in full would discard what you did in this tab: {stuck.reason}</p>
      <button type="button" className={`${s.btn} ${s.small}`} onClick={loadFully}>Load the page fully (unsaved changes in this tab are lost)</button>
    </div>
  );
}

/** Until the saved workspace has been read, nothing from the sample is shown as if it were yours. */
function Hydrated({ children }: { children: ReactNode }) {
  const { hydrated } = useWorkspace();
  if (!hydrated) return <p className={s.empty} role="status" data-testid="workspace-loading">Loading your test workspace…</p>;
  return <>{children}</>;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pending = useNavPending();
  const pathname = usePathname() ?? "/clearline";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const segs = pathname.split("/");
  const detail = segs.length > 3 && segs[2] === "payments" ? safeDecode(segs[3]) : undefined;
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
          <div className={s.sidebarInner}>
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
            {([["Operations", PRIMARY, ""], ["Set-up and reference", SECONDARY, s.navSecondary]] as const).map(([title, items, cls]) => (
              <div key={title} className={`${s.navGroup} ${cls}`}>
                <p className={s.navTitle} id={`nav-${cls ? "secondary" : "primary"}`}>{title}</p>
                <ul className={s.navList} aria-labelledby={`nav-${cls ? "secondary" : "primary"}`}>
                  {items.map((i) => (
                    <li key={i.href}>
                      <Link href={i.href} className={s.navLink} aria-current={isActive(pathname, i) ? "page" : undefined}>
                        {i.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className={s.navFoot}>
              <Link href="/clearline/trial">Guided trial (5 cases)</Link>
              <Link href={FUNDING_DESK_HREF}>Funding Desk (specialist workflow)</Link>
              <a href={MARKETING_URL}>Clearline website</a>
              <a href={CONTACT_MAILTO}>Contact / feedback</a>
            </div>
          </nav>
          </div>
        </aside>
        <main id="cl-main" className={s.main} tabIndex={-1} aria-busy={pending ? true : undefined}>
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
          <NavPending />
          <ActorSelect id="cl-actor-global" />
          </div>
          <NavStuck />
          <DiscardedNotice />
          <MigrationNotice />
          <Hydrated>{children}</Hydrated>
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
