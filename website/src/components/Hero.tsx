import { PrimaryButton, SecondaryButton } from "./ui";
import { site } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="drift pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(110,125,240,0.32),transparent)] blur-2xl" />

      <div className="relative mx-auto max-w-6xl px-5 pt-14 sm:px-8 sm:pt-16">
        <div className="rise flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-white/[0.03] px-3.5 py-1.5 text-[13px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
            Working demo · early access
          </span>
        </div>

        <h1 style={{ ["--d" as string]: "0.05s" }} className="rise mx-auto mt-6 max-w-4xl text-balance text-center text-[clamp(38px,6.2vw,68px)] font-semibold leading-[1.0] tracking-[-0.04em]">
          Stablecoin payments, matched, explained <span className="bg-gradient-to-r from-[#c3ccff] via-accent to-[#7f92ff] bg-clip-text text-transparent">and in your books.</span>
        </h1>

        <p style={{ ["--d" as string]: "0.12s" }} className="rise mx-auto mt-6 max-w-2xl text-pretty text-center text-[clamp(16.5px,1.9vw,19px)] leading-relaxed text-muted">
          {site.subline}
        </p>

        <div style={{ ["--d" as string]: "0.18s" }} className="rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <PrimaryButton className="w-full sm:w-auto" />
          <SecondaryButton href="#demo" className="w-full sm:w-auto">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>
            Watch the 60-second demo
          </SecondaryButton>
        </div>
        <p className="mx-auto mt-5 max-w-xl text-balance text-center text-[13.5px] text-faint">
          For finance teams paid in stablecoins (digital dollars such as USDC): payments matched to their invoices, wrong ones explained, nothing posted to your books until a person approves.
        </p>

        <div style={{ ["--d" as string]: "0.25s" }} className="rise relative mx-auto mt-10 max-w-5xl sm:mt-12">
          <div aria-hidden="true" className="pointer-events-none absolute -top-px left-0 right-0 z-10 h-px overflow-hidden">
            <div className="streak h-px w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_40px_120px_-30px_rgba(110,125,240,0.45)]">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-3 truncate text-[12px] text-faint">Clearline · at a glance · demo data</span>
            </div>
            {/* Phones get the "Needs attention" list cropped large; wider screens get the whole view. One image downloads either way. */}
            <picture>
              <source media="(max-width: 639px)" srcSet="/img/attention-phone-390.webp 390w, /img/attention-phone-780.webp 780w" sizes="calc(100vw - 40px)" width={780} height={1041} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/hero-1000.webp"
                srcSet="/img/hero-1000.webp 1000w, /img/hero-2000.webp 2000w"
                sizes="(min-width: 1080px) 1024px, 100vw"
                width={2000}
                height={898}
                fetchPriority="high"
                decoding="async"
                alt="Clearline's at-a-glance view for a fictional company: in the demo, 11 of 16 payments that arrived were matched and marked paid automatically, and 5 need attention, each with the problem named: not real USDT, no reference, short by 50 USDC, wrong network, paid twice."
                className="block h-auto w-full"
              />
            </picture>
          </div>
        </div>
      </div>
    </section>
  );
}
