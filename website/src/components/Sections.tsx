import { DemoVideo } from "./DemoVideo";
import { Eyebrow, PrimaryButton, Reveal, SectionTitle } from "./ui";

export function Demo() {
  return (
    <section id="demo" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-24">
      <Reveal className="mx-auto max-w-2xl text-center">
        <Eyebrow>Demo</Eyebrow>
        <SectionTitle>See it in 60 seconds.</SectionTitle>
        <p className="mt-5 text-[17px] leading-relaxed text-muted">The real product, running on a fictional company. Captions are built in.</p>
      </Reveal>
      <Reveal delay={0.1} className="mx-auto mt-12 max-w-4xl">
        <DemoVideo />
        <p className="mt-3 text-center text-[13px] text-faint">Film shows steps 1–3; step 4 coming in the next cut.</p>
        <p className="mt-2 text-center text-[13px]">
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
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-24 md:grid-cols-2 md:gap-16">
        <Reveal>
          <Eyebrow>Built for</Eyebrow>
          <SectionTitle>Finance and operations teams that get paid in stablecoins directly.</SectionTitle>
        </Reveal>
        <Reveal delay={0.1} className="space-y-6 text-[17px] leading-relaxed text-muted">
          <p>
            If your customers send USDC or USDT straight to your company's address (Web3 firms, agencies, service companies, exporters), you match those payments by hand. That's the job Clearline does.
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
  { title: "Never touches money", body: "Clearline reads public blockchain records and your invoices. It never holds or moves money, and never asks for wallet keys. The only thing it writes is a posting to your books, and only when a person approves." },
  { title: "Shows its evidence", body: "Every verdict lists what it checked: amount, token contract, address, confirmations. Inferences are labelled as inferences." },
  { title: "A person decides", body: "It can block an obvious mistake, like counting a counterfeit as paid. Replies are drafts: you edit and send them yourself." },
  { title: "Your data, your call", body: "Today's demo runs on fictional data. Design-partner pilots use only what you choose to share, only for the pilot, deleted when you ask." },
];

export function Trust() {
  return (
    <section id="trust" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-24">
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
          <span className="font-semibold text-fg">52 of 52.</span> In our own test, Clearline's checks (real token, right network, right address) gave the right answer on 52 real public USDC and USDT transfers we hadn't used while building the rules. The right answers were confirmed on block explorers. Automatic matching hasn't been tested on real data yet.
        </p>
        <p className="mt-3 flex-none text-[12.5px] text-faint sm:mt-0">Our own small test, not a customer result.</p>
      </Reveal>
    </section>
  );
}

const faqs = [
  { q: "What are stablecoins?", a: "Digital dollars. A stablecoin like USDC (issued by Circle) or USDT (issued by Tether) is meant to be worth one US dollar each, and moves between accounts on a blockchain in seconds, any day of the week." },
  { q: "Does Clearline hold my money?", a: "No. Clearline reads public blockchain records and your invoice list, and never holds, moves or has access to funds or wallet keys. The one thing it writes is a payment posted to your books, and only after a person approves it." },
  { q: "Which networks and tokens?", a: "Payment pages: USDC on Ethereum today. Checking a transfer someone reports: USDC and USDT on Ethereum, Tron and BNB Chain, including spotting payments sent on Polygon, Base, Arbitrum or Optimism instead. Design partners will shape what comes next." },
  { q: "Is it AI?", a: "The verdict (paid, short, counterfeit, wrong network) comes from fixed, written rules, and every verdict shows the evidence it used. An AI-written explanation is being built, but it hasn't been tested on real data, so nothing on this page relies on it." },
  { q: "How do my invoices get in?", a: "Today you create a payment request in Clearline for each invoice, or import open invoices from Xero (built; first live test next). Once a payment is approved, Clearline posts it back to the invoice in your accounting system (see the next question)." },
  { q: "Which accounting tools?", a: "Xero first. The connection is built and checked in automated tests; posting rules tested in demo mode with a fictional company; first live test with Xero's demo company is next. QuickBooks Online comes next, and NetSuite is on the roadmap. Before connecting anything, we'll ask which one you use." },
  { q: "Don't other tools already do this?", a: "Some do parts of it. Crypto accounting tools such as Bitwave and Request Finance already sync crypto payments and bills to accounting systems. Clearline focuses on businesses paid straight into their own wallet, and on the payments that arrive wrong (short, wrong network, counterfeit, no reference) and getting those into the books correctly. Whether that's where the pain is, we're testing with design partners." },
  { q: "Is it live?", a: "Not yet. It's a working demo running on fictional data, with no customers yet. We're now looking for a small number of design partners to try it on their own payments." },
  { q: "How much does it cost?", a: "Free for design partners during the pilot. Pricing comes later, and we'll agree it with you before anything changes." },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-24">
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
