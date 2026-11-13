import Link from "next/link";
import type { ReactNode } from "react";
import { EMAIL, LINKEDIN, SOFTWARE_URL, TRIAL_URL, API_DOCS_URL, mailto } from "@/lib/site";
import { NOT_BUILT, OUT_OF_SCOPE, WORKING_TODAY } from "@/lib/disclosure";

export function Logo() {
  return (
    <Link href="/" className="brand" aria-label="Clearline home">
      <svg className="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
        <rect x="0.75" y="0.75" width="20.5" height="20.5" rx="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <rect x="5" y="10" width="12" height="2" rx="1" style={{ fill: "var(--cl-blue-on-midnight)" }} />
      </svg>
      <span className="brand-word">clearline</span>
    </Link>
  );
}

/** Button-styled link. `main` marks the page's primary call to action (used by keyboard tests). */
export function ButtonLink({ href, children, variant = "primary", external = false, main = false, onMidnight = false }: {
  href: string; children: ReactNode; variant?: "primary" | "secondary"; external?: boolean; main?: boolean; onMidnight?: boolean;
}) {
  const cls = "btn btn-" + variant + (onMidnight ? " btn-on-midnight" : "");
  const extra = main ? { "data-main-cta": "" } : {};
  if (external || href.startsWith("http") || href.startsWith("mailto:")) {
    const isHttp = href.startsWith("http");
    return (
      <a className={cls} href={href} {...(isHttp ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...extra}>
        {children}
        {isHttp && <span className="sr-only"> (opens in a new tab)</span>}
        <span aria-hidden="true">{isHttp ? "↗" : "→"}</span>
      </a>
    );
  }
  return <Link className={cls} href={href} {...extra}>{children}<span aria-hidden="true">→</span></Link>;
}

/** Inline external link with a screen-reader note. */
export function ExtLink({ href, children, className = "text-link" }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span></a>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export type StageKind = "synthetic" | "prototype" | "design" | "none";
const stageText: Record<StageKind, string> = {
  synthetic: "Working synthetic engine",
  prototype: "Interactive prototype",
  design: "Design only, not built",
  none: "No third-party integration",
};
/** Honest stage label. Always text, never colour alone. */
export function Stage({ kind }: { kind: StageKind }) {
  return <span className={"stage stage-" + kind}><span className="stage-dot" aria-hidden="true" />{stageText[kind]}</span>;
}

export function PageHero({ eyebrow, title, children, actions, stages }: {
  eyebrow: string; title: ReactNode; children?: ReactNode; actions?: ReactNode; stages?: StageKind[];
}) {
  return (
    <section className="page-hero on-midnight">
      <div className="container">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="h1">{title}</h1>
        {children && <div className="lede">{children}</div>}
        {stages && <div className="stage-row" aria-label="Stage">{stages.map(s => <Stage key={s} kind={s} />)}</div>}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </section>
  );
}

export function Section({ id, eyebrow, title, intro, children, tone = "canvas" }: {
  id?: string; eyebrow?: string; title?: ReactNode; intro?: ReactNode; children?: ReactNode; tone?: "canvas" | "white" | "midnight";
}) {
  return (
    <section id={id} className={"section section-" + tone}>
      <div className="container">
        {(eyebrow || title || intro) && (
          <div className="section-head">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h2 className="h2">{title}</h2>}
            {intro && <div className="section-intro">{intro}</div>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

/** The single working-today / not-built disclosure (lib/disclosure.ts). `headingId` must be unique on the page. */
export function Disclosure({ headingId = "disclosure-title", title = "What works today, and what does not" }: { headingId?: string; title?: string }) {
  return (
    <div className="disclosure" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="sr-only">{title}</h3>
      <div className="disclosure-col">
        <p className="disclosure-head"><Stage kind="synthetic" /> Works today in the sandbox</p>
        <ul>{WORKING_TODAY.map(i => <li key={i.text}><span className="disclosure-area">{i.area}</span>{i.text}</li>)}</ul>
      </div>
      <div className="disclosure-col">
        <p className="disclosure-head"><Stage kind="none" /> Not built yet</p>
        <ul>{NOT_BUILT.map(i => <li key={i.text}><span className="disclosure-area">{i.area}</span>{i.text}</li>)}</ul>
        <p className="disclosure-scope"><b>Out of scope.</b> {OUT_OF_SCOPE}</p>
      </div>
    </div>
  );
}

/** Closing band used on most pages: sandbox + founder contact. */
export function ContactBand({ title = "Bring one payment that was hard to explain." }: { title?: string }) {
  return (
    <section className="section section-midnight contact-band" aria-labelledby="contact-band-title">
      <div className="container contact-band-grid">
        <div>
          <p className="eyebrow">Next step</p>
          <h2 id="contact-band-title" className="h2">{title}</h2>
          <p className="on-midnight-muted">Start with the five fictional cases. If the workflow looks relevant, email the founder about your team&rsquo;s process. No payment records are needed for a first conversation.</p>
        </div>
        <div className="actions">
          <ButtonLink href={TRIAL_URL}>Explore Clearline</ButtonLink>
          <ButtonLink href={mailto("A payment problem")} variant="secondary" onMidnight>Talk about a payment problem</ButtonLink>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Logo />
            <p className="footer-note">Clearline connects payment instructions, provider events and financial evidence, so operations teams can understand what happened and what needs attention.</p>
            <p className="footer-stage">Early product. Sandbox uses fictional data. No payment execution, custody or lending.</p>
          </div>
          <nav className="footer-col" aria-label="Product">
            <p className="footer-label">Product</p>
            <Link href="/platform">Platform</Link>
            <Link href="/connect">Connect</Link>
            <Link href="/control">Control</Link>
            <Link href="/use-cases">Use cases</Link>
            <Link href="/onchain">Onchain (in development)</Link>
          </nav>
          <nav className="footer-col" aria-label="Try it">
            <p className="footer-label">Try it</p>
            <Link href="/trial">Customer trial</Link>
            <ExtLink href={TRIAL_URL} className="">Explore Clearline</ExtLink>
            <ExtLink href={SOFTWARE_URL} className="">Test-mode console</ExtLink>
            <Link href="/developers">Developers</Link>
            <ExtLink href={API_DOCS_URL} className="">API reference</ExtLink>
          </nav>
          <nav className="footer-col" aria-label="Company">
            <p className="footer-label">Company</p>
            <Link href="/about">About the founder</Link>
            <Link href="/contact">Contact</Link>
            <a href={"mailto:" + EMAIL}>Email</a>
            <ExtLink href={LINKEDIN} className="">LinkedIn</ExtLink>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
        <div className="footer-base">
          <span>© {new Date().getUTCFullYear()} Clearline · Singapore</span>
          <span>Clearline does not hold funds, lend, execute payouts or make compliance decisions.</span>
        </div>
      </div>
    </footer>
  );
}
