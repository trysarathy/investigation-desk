"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { bookHref, site } from "@/lib/site";

/** The Clearline mark: a flat line that turns into a tick (a payment that explains itself). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9c4ff" />
          <stop offset="1" stopColor="#7f92ff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#lm)" />
      <path d="M7 16.5h5.2l2.6 3.2L25 9.5" fill="none" stroke="#0a0c11" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-fg" aria-label="Clearline home">
      <LogoMark />
      <span className="text-[17px]">Clearline</span>
    </Link>
  );
}

export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string; y?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} data-reveal className={className} style={{ ["--d" as string]: `${delay}s` }}>
      {children}
    </div>
  );
}

export function Motion({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function PrimaryButton({ children = "Book a 15-minute call", className = "" }: { children?: React.ReactNode; className?: string }) {
  const href = bookHref();
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-full bg-fg px-6 text-[15px] font-semibold text-ink transition hover:bg-white active:scale-[0.98] ${className}`}
    >
      {children}
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </a>
  );
}

export function SecondaryButton({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} className={`inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line-strong px-6 text-[15px] font-medium text-fg transition hover:border-white/30 hover:bg-white/[0.04] ${className}`}>
      {children}
    </a>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">{children}</p>;
}

export function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-balance text-[clamp(30px,4.6vw,52px)] font-semibold leading-[1.05] tracking-[-0.03em] ${className}`}>{children}</h2>;
}

/** A real product screenshot, served as WebP at 1x and 2x. */
export function Shot({ name, w, h, alt, sizes, small, className = "", priority = false }: { name: string; w: number; h: number; alt: string; sizes: string; small: number; className?: string; priority?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/img/${name}-${small}.webp`}
      srcSet={`/img/${name}-${small}.webp ${small}w, /img/${name}-${w}.webp ${w}w`}
      sizes={sizes}
      width={w}
      height={h}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={className}
    />
  );
}

export function BrowserFrame({ children, label = "app.clearline · demo data", className = "" }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_40px_120px_-30px_rgba(110,125,240,0.45)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-3 truncate text-[12px] text-faint">{label}</span>
      </div>
      {children}
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-8 text-[14px] text-muted md:flex">
          <a href="/#how-it-works" className="hover:text-fg">How it works</a>
          <a href="/#demo" className="hover:text-fg">Demo</a>
          <a href="/#trust" className="hover:text-fg">Safety</a>
          <a href="/#design-partners" className="hover:text-fg">Design partners</a>
          <a href="/#faq" className="hover:text-fg">FAQ</a>
        </nav>
        <a href={bookHref().startsWith("#") ? "/" + bookHref() : bookHref()} className="inline-flex h-9 items-center rounded-full bg-fg px-4 text-[13.5px] font-semibold text-ink transition hover:bg-white">
          Book a call
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-muted">
            A smart cashier for stablecoin payments. Working demo, seeking design partners.
          </p>
          <p className="mt-4 text-[13px] text-faint">Built by {site.founder}, SMU.</p>
        </div>
        <div className="text-[14px]">
          <p className="mb-3 font-medium text-fg">Product</p>
          <ul className="space-y-2 text-muted">
            <li><a className="hover:text-fg" href="/#how-it-works">How it works</a></li>
            <li><a className="hover:text-fg" href="/demo/">Demo</a></li>
            <li><a className="hover:text-fg" href="/#design-partners">Design partners</a></li>
          </ul>
        </div>
        <div className="text-[14px]">
          <p className="mb-3 font-medium text-fg">Contact</p>
          <ul className="space-y-2 text-muted">
            {site.contactEmail && <li><a className="hover:text-fg" href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a></li>}
            <li><a className="hover:text-fg" href={site.linkedin} target="_blank" rel="noopener">LinkedIn</a></li>
            <li><a className="hover:text-fg" href="/privacy/">Privacy notice</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-5 py-6 text-[12.5px] text-faint sm:px-8">
          © 2026 {site.legalName}. Screenshots and the demo film use fictional companies and amounts.
        </p>
      </div>
    </footer>
  );
}
