import Link from "next/link";
import PaymentPreview from "@/components/PaymentPreview";
import { ButtonLink, ContactBand, ExtLink, Section, Stage } from "@/components/Shared";
import { EMAIL, TRIAL_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Money moves. Context gets lost.",
  "Clearline is building the coordination and financial operations layer for cross-border payments. One place to follow payment instructions, provider updates, reconciliation and exceptions. Try the fictional-data sandbox.",
  "/",
);

const useCases = [
  ["Payment investigation", "A payout was returned or held. Find what was reported, by whom, and who acts next."],
  ["Settlement reconciliation", "Tie provider reports and statements to payment references, not amounts alone."],
  ["Provider orchestration", "Compare eligible routes, record the approval, follow one status model across providers."],
  ["Funding exposure", "Track what is still owed after a supplier is paid before the customer repays."],
];

export default function Home() {
  return (
    <main id="main">
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="container home-hero-grid">
          <div>
            <p className="eyebrow">Cross-border payment operations · Singapore</p>
            <h1 id="hero-title" className="h1">Money moves. <em>Context gets lost.</em></h1>
            <p className="lede">Clearline is building the coordination and financial operations layer for cross-border payments. One place to follow payment instructions, provider updates, reconciliation and exceptions.</p>
            <p className="hero-sub">Built for payment-operations, finance and treasury teams. When a payout crosses several providers, the status sits in one portal, the statement in another and the explanation in an email thread. Clearline keeps them on one record.</p>
            <div className="actions">
              <ButtonLink href={TRIAL_URL} main>Explore the sandbox</ButtonLink>
              <ButtonLink href="/contact" variant="secondary">Talk to us about your workflow</ButtonLink>
            </div>
          </div>
          <aside className="glance" aria-label="Clearline at a glance">
            <div className="glance-head"><span className="label">At a glance</span><span className="label">Early product</span></div>
            <dl>
              <div><dt>For</dt><dd>Payment operations, finance and treasury teams that send or settle cross-border payouts.</dd></div>
              <div><dt>Problem</dt><dd>Provider status, settlement evidence and the books disagree, and no one holds the whole story.</dd></div>
              <div><dt>Connect</dt><dd>One instruction model across providers: intents, route quotes, approvals, status events.<br /><Stage kind="synthetic" /></dd></div>
              <div><dt>Control</dt><dd>What happened after: evidence, reconciliation, liquidity, holds and exceptions.<br /><Stage kind="illustrative" /></dd></div>
              <div><dt>Try today</dt><dd>A guided sandbox with five fictional cases and a test-mode API. No sign-up.</dd></div>
              <div><dt>Not yet</dt><dd>Provider integrations and onchain verification (testnet).<br /><Stage kind="none" /><Stage kind="development" /></dd></div>
              <div><dt>Contact</dt><dd>Aashmiin Kaur, founder. <a className="text-link" href={mailto("Clearline: our payment workflow")}>Email</a></dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <Section eyebrow="The problem" title={<>The payment has a status. <em>The business still needs an answer.</em></>}
        intro={<p>&ldquo;Completed&rdquo; is what a provider reported. It is not proof that money settled, and it is not the same as the books agreeing. Teams reconstruct the difference by hand.</p>}>
        <div className="grid-3">
          <div className="card"><p className="label">What the provider says</p><h3 className="h3">Status events</h3><p>Submitted, in transit, completed, returned, on hold. Each provider names them differently and sends them on its own schedule.</p></div>
          <div className="card"><p className="label">What can be shown</p><h3 className="h3">Settlement evidence</h3><p>A statement line, a settlement export or a confirmed transaction. Often arrives later, from a different system, under a different reference.</p></div>
          <div className="card"><p className="label">What finance needs</p><h3 className="h3">Reconciliation</h3><p>The instruction, the evidence and the ledger agree by reference. Anything that does not becomes an exception with an owner.</p></div>
        </div>
      </Section>

      <Section id="sandbox" tone="white" eyebrow="Try it here · fictional data" title="One payment record. Three separate statuses."
        intro={<><p>Pick a payment. execution, settlement and reconciliation are separate fields, so &ldquo;the provider said completed&rdquo; never reads as &ldquo;settled&rdquo;. These are the sandbox engine&rsquo;s five seeded scenarios.</p><p><ExtLink href={TRIAL_URL}>Open the full guided sandbox</ExtLink></p></>}>
        <PaymentPreview />
      </Section>

      <Section eyebrow="What we are building" title={<>Connect moves the instruction. <em>Control explains the outcome.</em></>}
        intro={<p>Clearline is software between the teams using payment rails and the partners operating them. It is not a bank, a payment provider or a wallet, and it does not hold funds.</p>}>
        <div className="grid-2">
          <div className="panel">
            <p className="label">Clearline Connect</p>
            <h3 className="h3">One instruction model across providers</h3>
            <ul className="bullets"><li>Payment intents with validated fields</li><li>Route quotes with eligibility reasons</li><li>Approvals before submission</li><li>One state model for provider events, with signed test webhooks</li></ul>
            <div className="stage-row"><Stage kind="synthetic" /><Stage kind="none" /></div>
            <p><Link className="text-link" href="/connect">How Connect works</Link></p>
          </div>
          <div className="panel">
            <p className="label">Clearline Control</p>
            <h3 className="h3">What happened after submission</h3>
            <ul className="bullets"><li>Payment investigation with sourced timelines</li><li>Reconciliation by reference, with exceptions</li><li>Liquidity net of restricted balances</li><li>Holds, owners and funding exposure</li></ul>
            <div className="stage-row"><Stage kind="illustrative" /><Stage kind="synthetic" /></div>
            <p><Link className="text-link" href="/control">How Control works</Link></p>
          </div>
        </div>
      </Section>

      <Section tone="bluegrey" eyebrow="Use cases" title="Four workflows we are testing" intro={<p>Worked through with fictional examples. These are not validated customer outcomes.</p>}>
        <div className="grid-4">
          {useCases.map(([t, d]) => <div className="card" key={t}><h3 className="h3">{t}</h3><p>{d}</p></div>)}
        </div>
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/use-cases">Read the four examples</Link></p>
      </Section>

      <Section eyebrow="The real stage" title={<>An early product. <em>No pretending otherwise.</em></>}>
        <div className="grid-4">
          <div className="card"><Stage kind="synthetic" /><p>Sandbox engine: idempotent intents, quotes, maker-checker approval, provider events, reconciliation by reference, exceptions, liquidity and a funding projection. Fictional data.</p></div>
          <div className="card"><Stage kind="illustrative" /><p>Console views for investigation, reconciliation, liquidity, holds and funding exposure, on fictional data, plus the detailed Funding Desk prototype.</p></div>
          <div className="card"><Stage kind="development" /><p>Onchain verification on testnet: Safe payout proposals, evidence fingerprints on Base, stablecoin repayment checks. <Link className="text-link" href="/onchain">Details</Link></p></div>
          <div className="card"><Stage kind="none" /><p>No licensed provider, bank or wallet is connected. No real payment has been executed. No customers yet.</p></div>
        </div>
      </Section>

      <Section tone="white" eyebrow="Who is building it">
        <div className="founder">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="founder-photo" src="/founder.jpg" alt="Aashmiin Kaur" width={120} height={150} />
          <div className="prose">
            <h2 className="h3">Aashmiin Kaur, founder</h2>
            <p className="muted">Accountancy student at Singapore Management University, second major in Finance. Building Clearline in Singapore.</p>
            <p>I am speaking with people who run payments, treasury and reconciliation to find where this approach is genuinely useful, and where it is not.</p>
            <p><Link className="text-link" href="/about">About Clearline and the founder</Link> · <a className="text-link" href={"mailto:" + EMAIL}>{EMAIL}</a></p>
          </div>
        </div>
      </Section>

      <ContactBand />
    </main>
  );
}
