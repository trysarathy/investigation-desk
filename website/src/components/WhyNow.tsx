import { Eyebrow, Reveal, SectionTitle } from "./ui";

// Every fact here is in website/SOURCES.md, with the quoted line from its source.
const facts = [
  {
    figure: "~$400B",
    body: "of real-economy stablecoin payments in 2025, about 60% of them business-to-business (the B2B share is Bessemer's estimate).",
    source: "Bessemer Venture Partners, Apr 2026",
    href: "https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure",
  },
  {
    figure: "$350–550B",
    body: "of the $28–62T in stablecoin transfers in 2025 were real payments. The rest was trading and moving funds between wallets and exchanges.",
    source: "Reap, Aug 2026, citing BIS, BCG × Allium and McKinsey",
    href: "https://reap.global/blog/stablecoin-statistics-2026",
  },
  {
    figure: "62% · 53%",
    body: "Businesses' top uses: paying suppliers cross-border (62%) and accepting cross-border payments (53%).",
    source: "EY-Parthenon 2025 survey of 350 decision-makers, via Reap",
    href: "https://reap.global/blog/stablecoin-statistics-2026",
  },
  {
    figure: "One-stop shops",
    body: "Stripe, Circle and Coinbase are using their reach to become one-stop shops. Bessemer expects the most promising early startups to build outside their paths.",
    source: "Bessemer Venture Partners, Apr 2026",
    href: "https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure",
  },
];

export function WhyNow() {
  return (
    <section id="why-now" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-24">
      <Reveal className="max-w-2xl">
        <Eyebrow>Why now</Eyebrow>
        <SectionTitle>Real business payments: a small, growing slice.</SectionTitle>
        <p className="mt-6 text-[17px] leading-relaxed text-muted">
          Most stablecoin volume is still trading. The part that is real payments is growing, and much of it is between businesses.
        </p>
      </Reveal>
      <ul className="mt-14 grid gap-4 sm:grid-cols-2">
        {facts.map((f, i) => (
          <li key={f.figure}>
            <Reveal delay={0.06 * i} className="flex h-full flex-col rounded-2xl border border-line bg-panel/60 p-7">
              <p className="text-[clamp(28px,3.4vw,38px)] font-semibold leading-none tracking-[-0.03em] text-fg">{f.figure}</p>
              <p className="mt-4 flex-1 text-[15.5px] leading-relaxed text-muted">{f.body}</p>
              <p className="mt-5 text-[12.5px] text-faint">
                Source:{" "}
                <a href={f.href} target="_blank" rel="noopener" className="underline decoration-line-strong underline-offset-2 hover:text-fg">
                  {f.source}
                </a>
              </p>
            </Reveal>
          </li>
        ))}
      </ul>
      <Reveal delay={0.1}>
        <p className="mt-6 text-[12.5px] text-faint">Third-party figures, quoted as published. The EY-Parthenon survey is from mid-2025 and is a directional snapshot.</p>
      </Reveal>
    </section>
  );
}
