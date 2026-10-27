import { PrimaryButton, SecondaryButton } from "./ui";
import { site } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="drift pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(110,125,240,0.32),transparent)] blur-2xl" />

      <div className="relative mx-auto max-w-6xl px-5 pt-16 sm:px-8 sm:pt-24">
        <div className="rise flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-white/[0.03] px-3.5 py-1.5 text-[13px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
            Working demo · early access
          </span>
        </div>

        <h1 style={{ ["--d" as string]: "0.05s" }} className="rise mx-auto mt-7 max-w-4xl text-balance text-center text-[clamp(40px,7.4vw,84px)] font-semibold leading-[0.98] tracking-[-0.045em]"
        >
          Get paid in digital dollars <span className="bg-gradient-to-r from-[#c3ccff] via-accent to-[#7f92ff] bg-clip-text text-transparent">without the detective work.</span>
        </h1>

        <p style={{ ["--d" as string]: "0.12s" }} className="rise mx-auto mt-7 max-w-2xl text-pretty text-center text-[clamp(17px,2vw,20px)] leading-relaxed text-muted"
        >
          {site.subline}
        </p>

        <div style={{ ["--d" as string]: "0.18s" }} className="rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <PrimaryButton className="w-full sm:w-auto" />
          <SecondaryButton href="#demo" className="w-full sm:w-auto">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>
            Watch the 60-second demo
          </SecondaryButton>
        </div>
        <p className="mt-5 text-center text-[13px] text-faint">Stablecoins are digital dollars, such as USDC and USDT.</p>

        <div style={{ ["--d" as string]: "0.25s" }} className="rise relative mx-auto mt-14 max-w-5xl sm:mt-20"
        >
          <div aria-hidden="true" className="pointer-events-none absolute -top-px left-0 right-0 z-10 h-px overflow-hidden">
            <div className="streak h-px w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
          {/* Phones get the customer's payment page (legible at that size); larger screens get the finance team's view. One image downloads either way. */}
          <div className="mx-auto max-w-[300px] overflow-hidden rounded-[28px] border border-line-strong bg-panel shadow-[0_40px_120px_-30px_rgba(110,125,240,0.45)] sm:max-w-none sm:rounded-2xl">
            <div className="hidden items-center gap-2 border-b border-line px-4 py-3 sm:flex">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="ml-3 truncate text-[12px] text-faint">app.clearline · demo data</span>
            </div>
            <picture>
              <source media="(max-width: 639px)" srcSet="/img/phone-pay-390.webp 390w, /img/phone-pay-780.webp 780w" sizes="300px" width={780} height={1300} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/hero-1440.webp"
                srcSet="/img/hero-1440.webp 1440w, /img/hero-2880.webp 2880w"
                sizes="(min-width: 1080px) 1024px, 100vw"
                width={2880}
                height={1800}
                fetchPriority="high"
                decoding="async"
                alt="Clearline running on a fictional company. The finance view shows 11 of 16 payments matched automatically and 5 needing attention, each with the problem named; the customer's payment page shows exactly what to send, on which network, to which address."
                className="block h-auto w-full"
              />
            </picture>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-1 h-40 bg-gradient-to-t from-ink to-transparent" />
        </div>
      </div>
    </section>
  );
}
