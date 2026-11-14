import Link from "next/link";
import InvestigationView from "@/components/InvestigationView";
import { ButtonLink, Disclosure, ExtLink } from "@/components/Shared";
import { SAMPLE_PAYMENTS } from "@/lib/sample";
import { TRIAL_CASES } from "@/lib/cases";
import { BOOKING_URL, EMAIL, TRIAL_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Every payment. One clear answer.",
  "Clearline connects payment instructions, provider events and financial evidence, so operations teams can understand what happened and what needs attention. Explore five fictional cases in the sandbox.",
  "/",
);

const returned = SAMPLE_PAYMENTS.find(p => p.scenario === "s2_returned")!;

export default function Home() {
  return (
    <main id="main">
      <section className="home-hero quiet-hero" aria-labelledby="hero-title">
        <div className="container quiet-hero-content">
          <p className="eyebrow">Cross-border payment operations</p>
          <h1 id="hero-title" className="h1">Every payment. <em>One clear answer.</em></h1>
          <p className="lede">Clearline connects payment instructions, provider events and financial evidence&mdash;so operations teams can understand what happened and what needs attention.</p>
          <div className="actions">
            <ButtonLink href={TRIAL_URL} main>Explore Clearline</ButtonLink>
            <ButtonLink href={BOOKING_URL ?? mailto("A payment problem")} variant="secondary" onMidnight>Talk about a payment problem</ButtonLink>
          </div>
          <p className="quiet-hero-footnote">An early, fictional-data product. No real provider connected.</p>
        </div>
      </section>

      <section className="iv-band quiet-product" aria-labelledby="iv-title">
        <div className="container">
          <div className="quiet-section-intro">
            <p className="eyebrow">See the product</p>
            <h2 id="iv-title" className="h2">A status is not the whole story.</h2>
            <p>One payment. Three independent questions: what the provider reported, what the evidence proves, and whether the records match.</p>
          </div>
          <InvestigationView />
          <p className="iv-caption">Real Clearline sandbox interface with fictional records. <ExtLink href={TRIAL_URL}>Open the interactive walkthrough</ExtLink>.</p>
        </div>
      </section>

      <section className="section section-white quiet-story" aria-labelledby="story-title">
        <div className="container quiet-story-grid">
          <div>
            <p className="eyebrow">Why it matters</p>
            <h2 id="story-title" className="h2">The money returned. <em>The supplier wasn't paid.</em></h2>
          </div>
          <div className="quiet-story-detail">
            <p className="quiet-story-kicker">One payout. Five messages.</p>
            <p>The provider reported a return. The bank recorded the debit and return credit for <strong>{returned.amount}</strong>. Net movement ended at zero. The beneficiary was still unpaid.</p>
            <p>Clearline keeps the instruction, evidence and unresolved exception together, so the next action has an owner.</p>
            <Link className="text-link" href="/use-cases">See the full payment story</Link>
          </div>
        </div>
      </section>

      <section className="section section-canvas quiet-platform" aria-labelledby="products-title">
        <div className="container">
          <p className="eyebrow">The platform</p>
          <h2 id="products-title" className="h2">Coordinate the instruction. <em>Explain the outcome.</em></h2>
          <div className="quiet-product-pair">
            <div>
              <p className="label">01 / Connect</p>
              <h3>Coordinate payment instructions</h3>
              <p>Intents, indicative route quotes, approvals and provider-reported events in one consistent test-mode model.</p>
              <Link className="text-link" href="/connect">Explore Connect</Link>
            </div>
            <div>
              <p className="label">02 / Control</p>
              <h3>Understand the financial outcome</h3>
              <p>Reconciliation, investigations, exceptions, liquidity and funding exposure with source-attributed evidence.</p>
              <Link className="text-link" href="/control">Explore Control</Link>
            </div>
          </div>
          <p id="together" className="quiet-platform-footer">Both reference the same payment record. Clearline does not move, lend or hold customer funds.</p>
        </div>
      </section>

      <section className="section section-white quiet-trial" aria-labelledby="cases-title">
        <div className="container quiet-trial-row">
          <div>
            <p className="eyebrow">Try the software</p>
            <h2 id="cases-title" className="h2">Five real workflows. <em>Fictional data.</em></h2>
            <p className="section-intro">Follow a payment from instruction to evidence in a guided 15–20 minute walkthrough. No sign-up required.</p>
            <div className="actions"><ExtLink href={TRIAL_URL}>Open the guided trial</ExtLink><Link className="text-link" href="/trial">About the customer trial</Link></div>
          </div>
          <ol className="quiet-case-list" aria-label="Five sample scenarios">
            {TRIAL_CASES.map(c => <li key={c.n}><span className="mono">{c.n}</span><span>{c.title}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="section section-canvas quiet-stage" aria-labelledby="stage-title">
        <div className="container">
          <details>
            <summary id="stage-title"><strong>What works today, and what is still in development</strong><span>View product boundaries +</span></summary>
            <div className="quiet-stage-body"><Disclosure headingId="home-disclosure" /></div>
          </details>
        </div>
      </section>

      <section className="section section-white quiet-founder" aria-labelledby="founder-title">
        <div className="container quiet-founder-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="founder-photo" src="/founder.jpg" alt="Aashmiin Kaur" width={120} height={150} />
          <div>
            <p className="eyebrow">Built in Singapore</p>
            <h2 id="founder-title" className="h2">Built by Aashmiin Kaur.</h2>
            <p>19, in her second year of Accountancy at Singapore Management University, with a second major in Finance. <Link className="text-link" href="/about">Meet the founder</Link>.</p>
          </div>
        </div>
      </section>

      <section className="section section-midnight contact-band quiet-contact" aria-labelledby="contact-title">
        <div className="container quiet-contact-row">
          <div><p className="eyebrow">A useful conversation starts with one case</p><h2 id="contact-title" className="h2">Tell me about a payment that was hard to explain.</h2><p>Start with the workflow, not confidential records. Email <a className="text-link" href={mailto("A payment problem")}>{EMAIL}</a>.</p></div>
          <div className="actions"><ButtonLink href={TRIAL_URL}>Explore Clearline</ButtonLink><ButtonLink href="/contact" variant="secondary" onMidnight>Get in touch</ButtonLink></div>
        </div>
      </section>
    </main>
  );
}
