import { BrowserFrame, Eyebrow, Reveal, SectionTitle, Shot } from "./ui";

function Step({ n, title, body, points, children, flip = false, wide = false }: { n: string; title: string; body: string; points: string[]; children: React.ReactNode; flip?: boolean; wide?: boolean }) {
  return (
    <div className={`grid items-start gap-10 md:gap-14 ${wide ? (flip ? "md:grid-cols-[1.35fr_1fr]" : "md:grid-cols-[1fr_1.35fr]") : "md:grid-cols-2"}`}>
      <Reveal className={flip ? "md:order-2" : ""}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">{n}</p>
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
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <SectionTitle>When a payment is wrong, Clearline says why in plain English.</SectionTitle>
          <p className="mt-6 text-[17px] leading-relaxed text-muted">
            You create a payment request for each invoice in Clearline. From there, four moments, from your customer's screen to your books.
          </p>
        </Reveal>

        <div className="mt-16 space-y-20">
          <Step
            n="Step 1 · Before anyone pays"
            title="Your customer sees exactly how to pay."
            body="Each invoice gets its own payment page: the exact amount, the token, the network, and your receiving address split into groups that are easy to check."
            points={["Exact amount and network, no guesswork", "The address comes from your own wallet; Clearline only reads it", "In the demo, the page follows the payment from seen to confirmed to paid"]}
          >
            <BrowserFrame label="Customer's payment page · demo data" className="mx-auto max-w-md">
              <Shot name="request" w={1036} h={1252} small={518} sizes="(min-width: 768px) 448px, 90vw" alt="A customer payment page for a fictional invoice: send exactly 860.00 USDC, using the Ethereum network, to the address shown in groups, with a reminder to copy it from this page and never from wallet history." className="block h-auto w-full" />
            </BrowserFrame>
          </Step>

          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-bad/30 bg-gradient-to-br from-bad/[0.10] via-transparent to-transparent p-6 sm:p-10">
              <div className="grid items-center gap-8 md:grid-cols-[1fr_1.15fr]">
                <div>
                  <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-bad">Look-alike address check</p>
                  <h3 className="mt-3 text-balance text-[clamp(24px,2.8vw,32px)] font-semibold leading-[1.1] tracking-[-0.02em]">A warning before the money moves.</h3>
                  <p className="mt-4 text-[16px] leading-relaxed text-muted">
                    Scammers plant addresses that start and end like yours in people's wallet history. If your customer pastes the address they're about to send to, Clearline tells them when it's a look-alike. Like your bank warning you before you pay a stranger.
                  </p>
                </div>
                <Shot name="lookalike-stop" w={888} h={242} small={888} sizes="(min-width: 768px) 520px, 90vw" alt="A red warning on the payment page: Stop, don't send to this address. It starts and ends like ours but it's a different address. Nothing has been sent." className="block h-auto w-full rounded-xl border border-bad/30" />
              </div>
            </div>
          </Reveal>

          <Step
            flip
            n="Step 2 · When it's right"
            title="Correct payments are checked and ready to mark paid once you approve."
            body="Right amount, genuine USDC, right address, enough confirmations: the invoice is ready to mark paid in one click once you approve, with the reasons written down. Nobody has to chase it, and every decision can be reviewed."
            points={["Checks the token is the real one, from the issuer's own contract", "Waits for confirmations before calling it paid", "Every decision keeps its evidence"]}
          >
            <BrowserFrame label="Finance view · demo data">
              <Shot name="auto-paid" w={1504} h={582} small={752} sizes="(min-width: 768px) 540px, 92vw" alt="In the demo, a fictional invoice marked paid automatically: exactly 1,250.00 USDC from Circle's USDC contract arrived and reached 12 confirmations, so the matching rule marked it paid." className="block h-auto w-full" />
            </BrowserFrame>
          </Step>

          <Step
            n="Step 3 · When something's wrong"
            title="Problems explained in plain English, the reply already drafted."
            body="Short, wrong network, counterfeit or unlabelled: Clearline says what happened and what's likely behind it, and drafts a polite reply for your customer. A counterfeit can't be marked paid by mistake."
            points={["Plain-English explanation, with the evidence underneath", "Guesses are labelled as guesses", "A reply you can copy, edit and send yourself"]}
          >
            <div className="space-y-4">
              <BrowserFrame label="Finance view · demo data">
                <Shot name="fake-explained" w={1504} h={572} small={752} sizes="(min-width: 768px) 540px, 92vw" alt="A fictional case: 'This isn't real USDT'. 7,500 USDT arrived from a contract Tether doesn't control, so it can't pay the invoice." className="block h-auto w-full" />
              </BrowserFrame>
              <BrowserFrame label="Drafted reply · demo data">
                <Shot name="fake-reply" w={1456} h={922} small={728} sizes="(min-width: 768px) 540px, 92vw" alt="A drafted reply to the fictional customer explaining that the tokens weren't real USDT and how to pay with genuine USDT." className="block h-auto w-full" />
              </BrowserFrame>
            </div>
          </Step>

          <Step
            flip
            wide
            n="Step 4 · In your books"
            title="Approve once, and it's in your books."
            body="When a person approves, the payment posts to its invoice in your accounting system, with the transaction hash, token, network and USD value. Xero comes first; nothing has been posted to a real Xero organisation yet. A short payment posts as a partial payment with a note, unless you accept it as settled; otherwise the invoice stays open for the rest."
            points={["Counterfeit and wrong-network payments are never posted", "Nothing is written to your books until a person approves", "Every posting is kept in an audit log."]}
          >
            <figure>
              <div className="space-y-4">
                <BrowserFrame label="Clearline · In your books · demo data">
                  <Shot name="books-posted" w={1312} h={632} small={656} sizes="(min-width: 768px) 640px, 92vw" alt="Clearline's 'In your books' panel for a fictional invoice, INV-1041: paid exactly 1,250.00 USDC, one payment applied to the invoice, approved by a fictional finance person. The posted line shows 1,250.00 USD with the token, network, transaction hash and date." className="block h-auto w-full" />
                </BrowserFrame>
                <BrowserFrame label="Clearline · In your books · demo data">
                  <Shot name="books-partial" w={1312} h={762} small={656} sizes="(min-width: 768px) 640px, 92vw" alt="Clearline's 'In your books' panel for a fictional invoice, INV-1042: short by 50.00 USDC, so it will post as a partial payment of 4,950.00 with a note on the invoice, once a person presses 'Approve and post to the books'." className="block h-auto w-full" />
                </BrowserFrame>
              </div>
              <figcaption className="mt-4 text-[13px] leading-relaxed text-faint">
                Clearline&apos;s own posting screen in demo mode, for a fictional company (Northwind Pay). This is not Xero&apos;s screen. Xero connection built and checked in automated tests; posting rules tested in demo mode with a fictional company; first live test with Xero&apos;s demo company is next.
              </figcaption>
            </figure>
          </Step>
        </div>
      </div>
    </section>
  );
}
