import Link from "next/link";
import InvestigationView from "@/components/InvestigationView";
import { ButtonLink, Disclosure, ExtLink, Stage } from "@/components/Shared";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";
import { SAMPLE_EXCEPTIONS, SAMPLE_PAYMENTS } from "@/lib/sample";
import { TRIAL_CASES, TRY_CONNECT } from "@/lib/cases";
import { BOOKING_URL, EMAIL, FUNDING_DESK_URL, TRIAL_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Every payment. One clear answer.",
  "Clearline connects payment instructions, provider events and financial evidence, so operations teams can understand what happened and what needs attention. Explore five fictional cases in the sandbox.",
  "/",
);

const returned = SAMPLE_PAYMENTS.find(p => p.scenario === "s2_returned")!;
const returnedException = SAMPLE_EXCEPTIONS.find(e => e.reference === returned.reference)!;

/** What each message in the returned-payout story tells the team, and what it leaves open. */
const storyGaps = [
  ["The provider has the instruction.", "Not that any money has moved."],
  ["The provider says it is on its way.", "Not where it is, or when it will arrive."],
  ["The provider says it came back. Clearline makes reconciliation an exception at once, with an owner and a due date.", "Why it came back, and whether the money is really back."],
  ["The bank statement shows the return credit, allocated by its trusted reference: returnStatus confirmed_by_statement.", "Nothing about the supplier: they are still unpaid, so the exception stays open."],
];

export default function Home() {
  return (
    <main id="main">
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Payment operations software · Singapore · Early product</p>
            <h1 id="hero-title" className="h1">Every payment. <em>One clear answer.</em></h1>
            <p className="lede">Clearline connects payment instructions, provider events and financial evidence&mdash;so operations teams can understand what happened and what needs attention.</p>
            <div className="actions">
              <ButtonLink href={TRIAL_URL} main>Explore Clearline</ButtonLink>
              <ButtonLink href={BOOKING_URL ?? mailto("A payment problem")} variant="secondary" onMidnight>Talk about a payment problem</ButtonLink>
            </div>
            <p className="cta-note">{BOOKING_URL ? "Book a time, or email " + EMAIL + "." : "Opens an email to the founder. Booking link pending."}</p>
          </div>
          <div className="hero-aside">
            <p className="hero-aside-title">Clearline in 30 seconds</p>
            <dl>
              <div><dt>For</dt><dd>Payment operations, finance and treasury teams that send or settle cross-border payouts across more than one provider.</dd></div>
              <div><dt>Connect</dt><dd>Instructs payouts the same way on every route: intent, quotes, approval by a second person, one status model.</dd></div>
              <div><dt>Control</dt><dd>Shows what happened after submission: evidence, reconciliation by reference, exceptions with an owner.</dd></div>
              <div><dt>Try it</dt><dd>Five fictional cases, 15&ndash;20 minutes, no sign-up. No real provider, bank or wallet is connected.</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="iv-band" aria-labelledby="iv-title">
        <div className="container iv-pull">
          <h2 id="iv-title" className="sr-only">The Clearline console: a payment investigation with three separate truths</h2>
          <InvestigationView />
          <p className="iv-caption">The console&rsquo;s investigation page, rendered from the tested engine&rsquo;s fictional sample. Choose a payment above, or <ExtLink href={TRIAL_URL}>open the same cases in the console</ExtLink>.</p>
        </div>
      </section>

      <section className="section section-white" aria-labelledby="story-title">
        <div className="container story">
          <div className="story-lead">
            <p className="eyebrow">Why the coordination matters</p>
            <h2 id="story-title" className="h2">One payout. Four messages. <em>No single answer.</em></h2>
            <p className="section-intro">{returned.amount} to {returned.beneficiary} ({returned.reference}). Each message below is true. None of them alone tells operations whether the supplier was paid, whose job it is now, or what to do next. That answer needs the instruction from Connect and the evidence in Control on one record.</p>
          </div>
          <div>
            <ol className="story-steps">
              {returned.events.map((e, i) => (
                <li key={e.time}>
                  <span className="story-time">{e.time}</span>
                  <div>
                    <p className="story-event">{e.label}</p>
                    <p className="story-src">{e.source}</p>
                    <p className="story-said">{storyGaps[i][0]}</p>
                    <p className="story-gap"><b>Leaves open:</b> {storyGaps[i][1]}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="panel" style={{ marginTop: 32 }}>
              <p className="label">Clearline&rsquo;s answer</p>
              <div className="status-line"><ExecStatus state={returned.execution} /><SettlementStatus state={returned.settlement} /><ReconStatus state={returned.reconciliation} /></div>
              <p style={{ marginTop: 16 }}><b>{returned.nextAction}</b></p>
              <p className="caption" style={{ marginTop: 8 }}>Owner {returnedException.owner} · due <span className="num">{returnedException.dueDate}</span> · exception <span className="mono">{returnedException.category}</span>. Fictional data.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-canvas" aria-labelledby="products-title">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">What Clearline is</p>
            <h2 id="products-title" className="h2">Connect sends the instruction. <em>Control explains the outcome.</em></h2>
            <p className="section-intro">Software between the teams using payment rails and the partners operating them. Clearline is not a bank, a payment provider or a wallet, and it does not hold funds.</p>
          </div>
          <div className="duo">
            <div>
              <p className="label">Clearline Connect</p>
              <h3 className="product-name">One instruction model across providers</h3>
              <dl className="spec">
                <div><dt>Intent</dt><dd>Integer minor units and an idempotency key. The same key and body returns the original intent.</dd></div>
                <div><dt>Quotes</dt><dd>Every route, eligible or not, with the reason. Indicative, expiring after 15 minutes.</dd></div>
                <div><dt>Approval</dt><dd>Maker &ne; checker. Self-approval is refused.</dd></div>
                <div><dt>Provider events</dt><dd>One state model. Duplicates ignored, late events never move a payment backwards, bad signatures rejected.</dd></div>
              </dl>
              <div className="stage-row"><Stage kind="synthetic" /><Stage kind="none" /></div>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/connect">How Connect works</Link></p>
            </div>
            <div>
              <p className="label">Clearline Control</p>
              <h3 className="product-name">What happened after submission</h3>
              <dl className="spec">
                <div><dt>Investigation</dt><dd>A sourced timeline, what is still unknown, who acts and the next action.</dd></div>
                <div><dt>Reconciliation</dt><dd>Statement lines allocated by trusted reference. Amount alone is never attribution.</dd></div>
                <div><dt>Exceptions</dt><dd>Every disagreement gets an owner and a due date.</dd></div>
                <div><dt>Liquidity and holds</dt><dd>Usable balance net of what is not yours to spend. Holds owned by a named reviewer.</dd></div>
              </dl>
              <p className="duo-note"><b>Funding Desk</b> is Control&rsquo;s specialist workflow for providers that pay a supplier before their customer repays: the advance, a treasury decision by a second person, and the repayment, linked to the payout. <ExtLink href={FUNDING_DESK_URL}>Open the Funding Desk demo</ExtLink></p>
              <div className="stage-row"><Stage kind="synthetic" /><Stage kind="none" /></div>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/control">How Control works</Link></p>
            </div>
          </div>

          <h3 className="h3" style={{ marginTop: 96 }} id="together">How they work together</h3>
          <p className="muted" style={{ maxWidth: "66ch" }}>Both write to one payment record, so an operator, a finance lead and an engineer read the same account of what happened.</p>
          <ol className="flow" aria-labelledby="together">
            <li><span className="idx">01</span><div><span className="flow-owner">Connect</span><b>Instruct</b><p>Intent, quotes and an approval by a second person.</p></div></li>
            <li><span className="idx">02</span><div><span className="flow-owner">Connect</span><b>Follow</b><p>Provider events move execution, and only execution.</p></div></li>
            <li><span className="idx">03</span><div><span className="flow-owner">Control</span><b>Evidence</b><p>Statement lines or chain observations set settlement, with their scope.</p></div></li>
            <li><span className="idx">04</span><div><span className="flow-owner">Control</span><b>Reconcile</b><p>Allocation by trusted reference; partial amounts stay partly matched.</p></div></li>
            <li><span className="idx">05</span><div><span className="flow-owner">Control</span><b>Resolve</b><p>Whatever disagrees becomes an exception with an owner and a due date.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="section section-white" aria-labelledby="cases-title">
        <div className="container">
          <div className="section-head-split">
            <div className="section-head">
              <p className="eyebrow">What you can try today · fictional data</p>
              <h2 id="cases-title" className="h2">Five cases. <em>15&ndash;20 minutes.</em></h2>
            </div>
            <p className="section-intro" style={{ margin: 0 }}>No sign-up, bank login or integration. Providers, quotes, webhooks, balances and statements are all synthetic.</p>
          </div>
          <ol className="cases">
            {TRIAL_CASES.map(c => (
              <li key={c.n}><span className="idx">{c.n}</span><h3 className="h3">{c.title}</h3><p>{c.text}</p><span className="area">{c.product}</span></li>
            ))}
          </ol>
          <p className="muted" style={{ marginTop: 24, maxWidth: "70ch" }}>{TRY_CONNECT}</p>
          <div className="actions">
            <ExtLink href={TRIAL_URL}>Open the guided trial</ExtLink>
            <Link className="text-link" href="/trial">How the trial works, including your own historical cases</Link>
          </div>
        </div>
      </section>

      <section className="section section-canvas" aria-labelledby="stage-title">
        <div className="container">
          <div className="section-head-split">
            <div className="section-head">
              <p className="eyebrow">The real stage</p>
              <h2 id="stage-title" className="h2">What works today. <em>What does not.</em></h2>
            </div>
            <p className="section-intro" style={{ margin: 0 }}>Clearline is an early product with no customers. Everything below &ldquo;works today&rdquo; can be shown in the public sandbox on fictional data. Nothing else is claimed.</p>
          </div>
          <Disclosure headingId="home-disclosure" />
          <p style={{ marginTop: 24 }}><Link className="text-link" href="/platform#rules">The six evidence rules the engine enforces</Link> · <Link className="text-link" href="/onchain">Onchain design</Link></p>
        </div>
      </section>

      <section className="section section-white" aria-labelledby="founder-title">
        <div className="container founder">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="founder-photo" src="/founder.jpg" alt="Aashmiin Kaur" width={120} height={150} />
          <div className="prose">
            <p className="eyebrow">Who is building it</p>
            <h2 id="founder-title" className="h2">Aashmiin Kaur, founder</h2>
            <p className="section-intro">19, in her second year of Accountancy at Singapore Management University, with a second major in Finance. Building Clearline in Singapore.</p>
            <p style={{ marginTop: 16 }}>She builds and answers for Clearline herself. Email reaches her directly: <a className="text-link" href={mailto("A payment problem")}>{EMAIL}</a>.</p>
            <p><Link className="text-link" href="/about">About Clearline and the founder</Link></p>
          </div>
        </div>
      </section>

      <section className="section section-midnight contact-band" aria-labelledby="contact-title">
        <div className="container contact-band-grid">
          <div>
            <p className="eyebrow">Contact</p>
            <h2 id="contact-title" className="h2">Talk about a payment problem.</h2>
            <p className="on-midnight-muted">A few sentences are enough: which payments are hard to explain, who owns the exception, and what you use today. Please do not send payment records, beneficiary details or credentials.</p>
            <p style={{ marginTop: 16 }}><a className="text-link big-link" href={mailto("A payment problem")}>{EMAIL}</a></p>
            <p className="caption" style={{ marginTop: 8 }}>{BOOKING_URL ? <ExtLink href={BOOKING_URL}>Book a time</ExtLink> : "Booking link pending. Until it is set up, email to arrange a time."}</p>
          </div>
          <div className="actions">
            <ButtonLink href={TRIAL_URL}>Explore Clearline</ButtonLink>
            <ButtonLink href="/contact" variant="secondary" onMidnight>Contact options</ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
