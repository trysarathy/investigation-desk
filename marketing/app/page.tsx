import Link from "next/link";
import type { ReactNode } from "react";
import InvestigationView from "@/components/InvestigationView";
import { ButtonLink, ExtLink, Stage, type StageKind } from "@/components/Shared";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";
import { SAMPLE_EXCEPTIONS, SAMPLE_PAYMENTS } from "@/lib/sample";
import { TRIAL_CASES } from "@/lib/cases";
import { BOOKING_URL, EMAIL, TRIAL_URL, mailto } from "@/lib/site";
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

const principles: [string, ReactNode][] = [
  ["A provider report is a claim.", <>&ldquo;Completed&rdquo; is recorded as <code>provider_reported_completed</code>. On its own it never sets settlement <code>verified</code> or reconciliation <code>matched</code>, and a provider report on a failed or returned payout is a contradiction (<code>RC_REPORT_ON_TERMINAL_PAYOUT</code>).</>],
  ["Match by reference, never by amount alone.", <>A statement line is allocated only on a trusted reference plus amount, currency and a value-date window. A line that agrees only on amount becomes an exception (<code>RC_AMOUNT_ONLY_CANDIDATES</code>).</>],
  ["Evidence carries its scope.", <>A matched bank-statement debit is <code>verified</code> with scope <code>bank_statement</code>: the payout left the account. The beneficiary&rsquo;s credit can still be unknown, and the record says so.</>],
  ["Observation is not finality.", <>A synthetic testnet transfer counts as verified only past the finality threshold (12 confirmations on the Base Sepolia route), and never proves a supplier&rsquo;s bank credit.</>],
  ["Short is never settled.", <>A bank line with a trusted reference but only part of the amount is <code>partially_matched</code>; the remainder stays outstanding (<code>RC_PARTIAL_AMOUNT</code>). A provider report below the payout needs review (<code>RC_UNDER_AMOUNT_REPORT</code>), with expected, reported and difference stated.</>],
  ["A return is an exception until a person resolves it.", <>A statement line can confirm the return (<code>confirmed_by_statement</code>). The exception stays open, with its owner and due date, because the supplier is still unpaid.</>],
];

const roles = [
  ["Payment operations", "Where is this payout, and who acts next?", "One record per payment with a sourced timeline, the owner of each exception and the next action, across providers."],
  ["Finance and reconciliation", "Does this tie to the statement, by reference?", "Statement lines allocated on trusted references, explanation codes for everything that is not, and partial amounts kept visible."],
  ["Treasury", "What can we actually use, and what is still owed?", "Usable balance net of restricted, safeguarded and committed amounts, and funding exposure from supplier payout to repayment."],
];

const stages: [StageKind, string][] = [
  ["synthetic", "The engine runs and is tested: idempotent intents, quotes, maker-checker approval, provider events, reconciliation by reference, exceptions, liquidity and a funding projection. Fictional data only."],
  ["illustrative", "Console views for investigation, reconciliation, liquidity, holds and funding exposure, on fictional data, plus the detailed Funding Desk prototype."],
  ["development", "Onchain verification on testnet (Base Sepolia). Not available for real transfers."],
  ["none", "No licensed provider, bank or wallet is connected. No real payment has been executed. No customers yet."],
];

export default function Home() {
  return (
    <main id="main">
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Payment operations · Singapore · Early product</p>
            <h1 id="hero-title" className="h1">Every payment. <em>One clear answer.</em></h1>
            <p className="lede">Clearline connects payment instructions, provider events and financial evidence&mdash;so operations teams can understand what happened and what needs attention.</p>
            <div className="actions">
              <ButtonLink href={TRIAL_URL} main>Explore Clearline</ButtonLink>
              <ButtonLink href={BOOKING_URL ?? mailto("A payment problem")} variant="secondary" onMidnight>Talk about a payment problem</ButtonLink>
            </div>
            <p className="cta-note">{BOOKING_URL ? "Book a time, or email " + EMAIL + "." : "Opens an email to the founder. Booking link pending."}</p>
          </div>
          <div className="hero-aside">
            <dl>
              <div><dt>For</dt><dd>Payment operations, finance and treasury teams that send or settle cross-border payouts.</dd></div>
              <div><dt>Today</dt><dd>A working synthetic engine with five fictional cases. No real provider, bank or wallet connected.</dd></div>
              <div><dt>Try it</dt><dd>15&ndash;20 minutes, no sign-up.</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="iv-band" aria-labelledby="iv-title">
        <div className="container iv-pull">
          <h2 id="iv-title" className="sr-only">A payment investigation, three separate truths</h2>
          <InvestigationView />
        </div>
      </section>

      <section className="section section-white" aria-labelledby="story-title">
        <div className="container story">
          <div className="story-lead">
            <p className="eyebrow">The problem, through one payment</p>
            <h2 id="story-title" className="h2">One payout. Four messages. <em>No single answer.</em></h2>
            <p className="section-intro">{returned.amount} to {returned.beneficiary} ({returned.reference}). Each message below is true. None of them alone tells operations whether the supplier was paid, whose job it is now, or what to do next.</p>
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
              <div className="stage-row"><Stage kind="illustrative" /><Stage kind="synthetic" /></div>
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
              <p className="eyebrow">Explore Clearline · fictional data</p>
              <h2 id="cases-title" className="h2">Five cases. <em>15&ndash;20 minutes.</em></h2>
            </div>
            <p className="section-intro" style={{ margin: 0 }}>No sign-up, bank login or integration. Providers, quotes, webhooks, balances and statements are all synthetic.</p>
          </div>
          <ol className="cases">
            {TRIAL_CASES.map(c => (
              <li key={c.n}><span className="idx">{c.n}</span><h3 className="h3">{c.title}</h3><p>{c.text}</p><span className="area">{c.area}</span></li>
            ))}
          </ol>
          <div className="actions">
            <ExtLink href={TRIAL_URL}>Open the guided trial</ExtLink>
            <Link className="text-link" href="/trial">How the trial works, including your own historical cases</Link>
          </div>
        </div>
      </section>

      <section className="section section-midnight" aria-labelledby="principles-title">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Evidence and reconciliation</p>
            <h2 id="principles-title" className="h2">Six rules the engine enforces. <em>The interface only repeats them.</em></h2>
          </div>
          <ol className="principles">
            {principles.map(([t, d]) => <li key={t}><h3>{t}</h3><p>{d}</p></li>)}
          </ol>
        </div>
      </section>

      <section className="section section-white" aria-labelledby="roles-title">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Who it is for</p>
            <h2 id="roles-title" className="h2">Teams who have to explain a payment, <em>not just send it.</em></h2>
          </div>
          <div className="roles">
            {roles.map(([r, q, d]) => <div className="card" key={r}><h3 className="h3">{r}</h3><p className="asks">&ldquo;{q}&rdquo;</p><p className="muted" style={{ marginTop: 12 }}>{d}</p></div>)}
          </div>
          <p className="note" style={{ marginTop: 48 }}>Clearline does not hold funds, execute payouts, lend or make compliance decisions.</p>
        </div>
      </section>

      <section className="section section-canvas" aria-labelledby="stage-title">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">The real stage</p>
            <h2 id="stage-title" className="h2">An early product. <em>No pretending otherwise.</em></h2>
          </div>
          <dl className="stages">
            {stages.map(([k, d]) => <div key={k}><dt><Stage kind={k} /></dt><dd>{d}</dd></div>)}
          </dl>
          <p style={{ marginTop: 20 }}><Link className="text-link" href="/onchain">Onchain work in development</Link></p>
        </div>
      </section>

      <section className="section section-white" aria-labelledby="founder-title">
        <div className="container founder">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="founder-photo" src="/founder.jpg" alt="Aashmiin Kaur" width={144} height={180} />
          <div className="prose">
            <p className="eyebrow">Who is building it</p>
            <h2 id="founder-title" className="h2">Aashmiin Kaur, founder</h2>
            <p className="section-intro">19, in her second year of Accountancy at Singapore Management University, with a second major in Finance. Building Clearline in Singapore.</p>
            <p style={{ marginTop: 16 }}>She is speaking with people who run payments, treasury and reconciliation to find where this approach is genuinely useful, and where it is not.</p>
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
