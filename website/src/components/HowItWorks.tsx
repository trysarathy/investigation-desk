import { BrowserFrame, Eyebrow, Reveal, SectionTitle, Shot } from "./ui";

function Step({ n, title, body, points, children, flip = false }: { n: string; title: string; body: string; points: string[]; children: React.ReactNode; flip?: boolean }) {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <Reveal className={flip ? "md:order-2" : ""}>
        <p className="font-mono text-[13px] text-accent">{n}</p>
        <h3 className="mt-3 text-balance text-[clamp(26px,3.2vw,36px)] font-semibold leading-[1.1] tracking-[-0.025em]">{title}</h3>
        <p className="mt-4 text-[17px] leading-relaxed text-muted">{body}</p>
        <ul className="mt-6 space-y-3 text-[15px]">
          {points.map((p) => (
            <li key={p} className="flex gap-3">
              <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 flex-none text-good" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="text-fg/90">{p}</span>
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.12} className={flip ? "md:order-1" : ""}>
        {children}
      </Reveal>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative scroll-mt-24 border-y border-line bg-panel/40">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <Reveal className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <SectionTitle>Every payment explains itself.</SectionTitle>
          <p className="mt-6 text-[17px] leading-relaxed text-muted">Three moments, from the customer's screen to your finance team's.</p>
        </Reveal>

        <div className="mt-20 space-y-28">
          <Step
            n="01 · Before anyone pays"
            title="Your customer sees exactly how to pay."
            body="Each invoice gets its own payment page: the exact amount, the token, the network, and an address split into groups that are easy to check."
            points={["Exact amount and network, no guesswork", "A unique address per invoice, so the payment says which invoice it pays", "The page updates itself as the payment arrives"]}
          >
            <BrowserFrame label="pay.clearline · customer's view · demo data" className="mx-auto max-w-md">
              <Shot name="request" w={1036} h={1252} small={518} sizes="(min-width: 768px) 448px, 90vw" alt="A customer payment page for a fictional invoice: send exactly 860.00 USDC, using the Ethereum network, to an address shown in groups, with a reminder to copy it from this page and never from wallet history." className="block h-auto w-full" />
            </BrowserFrame>
          </Step>

          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-bad/30 bg-gradient-to-br from-bad/[0.10] via-transparent to-transparent p-6 sm:p-10">
              <div className="grid items-center gap-8 md:grid-cols-[1fr_1.15fr]">
                <div>
                  <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-bad">Scam stopped before it starts</p>
                  <h3 className="mt-3 text-balance text-[clamp(24px,2.8vw,32px)] font-semibold leading-[1.1] tracking-[-0.02em]">It catches look-alike addresses while the customer can still stop.</h3>
                  <p className="mt-4 text-[16px] leading-relaxed text-muted">
                    Scammers plant addresses that start and end like yours. If a customer pastes one, Clearline says so before any money moves. Like your bank warning you before you pay a stranger.
                  </p>
                </div>
                <Shot name="lookalike-stop" w={888} h={242} small={888} sizes="(min-width: 768px) 520px, 90vw" alt="A red warning on the payment page: Stop, don't send to this address. It starts and ends like ours but it's a different address. Nothing has been sent." className="block h-auto w-full rounded-xl border border-bad/30" />
              </div>
            </div>
          </Reveal>

          <Step
            flip
            n="02 · When it's right"
            title="Correct payments tick themselves off."
            body="Right amount, genuine USDC or USDT, right address, enough confirmations: the invoice is marked paid, with the reasons written down. Nobody has to touch it."
            points={["Checks the token is the real one, from the issuer's own contract", "Waits for confirmations before calling it paid", "Every decision keeps its evidence"]}
          >
            <BrowserFrame label="app.clearline · demo data">
              <Shot name="auto-paid" w={1680} h={570} small={840} sizes="(min-width: 768px) 520px, 90vw" alt="A fictional invoice marked paid automatically: exactly 1,250.00 USDC from Circle's USDC contract arrived at the invoice's own address and reached 12 confirmations." className="block h-auto w-full" />
            </BrowserFrame>
          </Step>

          <Step
            n="03 · When something's wrong"
            title="Problems explained in plain English, the reply already drafted."
            body="Short, wrong network, counterfeit or unlabelled: Clearline says what happened, what's likely behind it, and drafts a polite reply for your customer. A counterfeit can't be marked paid by mistake."
            points={["Plain-English explanation, with the evidence underneath", "Guesses are labelled as guesses", "A reply you can copy, edit and send yourself"]}
          >
            <div className="space-y-4">
              <BrowserFrame label="app.clearline · demo data">
                <Shot name="fake-explained" w={1680} h={1006} small={840} sizes="(min-width: 768px) 520px, 90vw" alt="A fictional case: 'This isn't real USDT'. 7,500 USDT arrived from a contract Tether doesn't control, so it can't pay the invoice, and Mark paid is blocked." className="block h-auto w-full" />
              </BrowserFrame>
              <BrowserFrame label="Drafted reply · demo data" className="ml-auto max-w-[92%]">
                <Shot name="fake-reply" w={1632} h={880} small={816} sizes="(min-width: 768px) 480px, 85vw" alt="A drafted reply to the fictional customer explaining that the tokens weren't real USDT and how to pay with genuine USDT." className="block h-auto w-full" />
              </BrowserFrame>
            </div>
          </Step>
        </div>
      </div>
    </section>
  );
}
