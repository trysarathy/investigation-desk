import { DemoVideo } from "./DemoVideo";
import { Eyebrow, PrimaryButton, Reveal, SectionTitle } from "./ui";

export function Demo() {
  return (
    <section id="demo" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="mx-auto max-w-2xl text-center">
        <Eyebrow>Demo</Eyebrow>
        <SectionTitle>See it in 60 seconds.</SectionTitle>
        <p className="mt-5 text-[17px] leading-relaxed text-muted">The real product, running on a fictional company. Captions are built in.</p>
      </Reveal>
      <Reveal delay={0.1} className="mx-auto mt-12 max-w-4xl">
        <DemoVideo />
        <p className="mt-4 text-center text-[13px]">
          <a href="/demo/" className="text-accent hover:underline">Open the demo page</a>
          <span className="text-faint"> · full screen, plus screenshots</span>
        </p>
      </Reveal>
    </section>
  );
}

export function BuiltFor() {
  return (
    <section id="built-for" className="border-y border-line bg-panel/40">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:px-8 sm:py-28 md:grid-cols-2 md:gap-16">
        <Reveal>
          <Eyebrow>Built for</Eyebrow>
          <SectionTitle>Finance and operations teams that get paid in stablecoins directly.</SectionTitle>
        </Reveal>
        <Reveal delay={0.1} className="space-y-6 text-[17px] leading-relaxed text-muted">
          <p>
            If your customers send USDC or USDT straight to your company's address (Web3 firms, agencies, service companies, exporters), nobody matches those payments for you. That's the job Clearline does.
          </p>
          <p className="rounded-2xl border border-line bg-panel p-6 text-[15.5px]">
            <span className="font-semibold text-fg">Alongside your existing tools.</span> Checkout pages and payment gateways usually handle payments made through them, and your wallet or custodian holds the funds. Clearline doesn't replace either. It reads the transfers that land directly with you, and explains them.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

const trust = [
  { title: "Read-only", body: "Clearline reads public blockchain records and your invoices. It never holds, moves or touches money, and never asks for wallet keys." },
  { title: "Shows its evidence", body: "Every verdict lists what it checked: amount, token contract, address, confirmations. Inferences are labelled as inferences." },
  { title: "A person decides", body: "It can block an obvious mistake, like counting a counterfeit as paid. Replies are drafts: you edit and send them yourself." },
  { title: "Your data, your call", body: "Today's demo runs on fictional data. Design-partner pilots use only what you choose to share, only for the pilot, deleted when you ask." },
];

export function Trust() {
  return (
    <section id="trust" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="max-w-2xl">
        <Eyebrow>Trust and safety</Eyebrow>
        <SectionTitle>Careful with money, by design.</SectionTitle>
      </Reveal>
      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {trust.map((t, i) => (
          <Reveal key={t.title} delay={0.06 * i} className="rounded-2xl border border-line bg-panel/60 p-7">
            <h3 className="text-[18px] font-semibold tracking-tight">{t.title}</h3>
            <p className="mt-2 text-[15.5px] leading-relaxed text-muted">{t.body}</p>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1} className="mt-6 rounded-2xl border border-line p-6 text-[14.5px] leading-relaxed text-muted sm:flex sm:items-center sm:justify-between sm:gap-8">
        <p>
          <span className="font-semibold text-fg">52 of 52.</span> In our own tests on 52 real past transactions the rules hadn't been tuned on, Clearline gave the right verdict every time.
        </p>
        <p className="mt-3 flex-none text-[12.5px] text-faint sm:mt-0">Our own demo test, not a customer result.</p>
      </Reveal>
    </section>
  );
}

const faqs = [
  { q: "What are stablecoins?", a: "Digital dollars. A stablecoin like USDC (issued by Circle) or USDT (issued by Tether) is meant to be worth one US dollar each, and moves between accounts on a blockchain in seconds, any day of the week." },
  { q: "Does Clearline hold my money?", a: "No. Clearline is read-only. It reads public blockchain records and your invoice list, and never holds, moves or has access to funds or wallet keys." },
  { q: "Which networks and tokens?", a: "Today the demo checks USDC and USDT on Ethereum, Tron and BNB Chain, and recognises payments sent on Polygon, Base, Arbitrum or Optimism instead. Design partners will shape what comes next." },
  { q: "Is it live?", a: "Not yet. It's a working demo running on fictional data. We're now looking for a small number of design partners to try it on their own payments." },
  { q: "How much does it cost?", a: "Free for design partners during the pilot. Pricing comes later, and we'll agree it with you before anything changes." },
  { q: "Who's behind it?", a: "Clearline is built by Aashmiin Kaur, an accountancy student at Singapore Management University, as an independent pre-launch project." },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32">
      <Reveal>
        <Eyebrow>FAQ</Eyebrow>
        <SectionTitle>Questions, answered plainly.</SectionTitle>
      </Reveal>
      <div className="mt-12 divide-y divide-line border-y border-line">
        {faqs.map((f) => (
          <details key={f.q} className="group py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
              {f.q}
              <span aria-hidden="true" className="grid h-7 w-7 flex-none place-items-center rounded-full border border-line-strong text-muted transition group-open:rotate-45">+</span>
            </summary>
            <p className="pb-5 pr-12 text-[15.5px] leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(110,125,240,0.22),transparent)] blur-2xl" />
      <Reveal className="relative mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 sm:py-28">
        <SectionTitle>Fifteen minutes on how you get paid today.</SectionTitle>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-muted">No pitch. We'd like to hear how stablecoin payments reach your team, and what happens when one goes wrong.</p>
        <div className="mt-9 flex justify-center">
          <PrimaryButton />
        </div>
      </Reveal>
    </section>
  );
}
