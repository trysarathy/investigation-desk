import Link from "next/link";
import { ButtonLink, ContactBand, PageHero, Section, Stage } from "@/components/Shared";
import { QuotesTable } from "@/components/Tables";
import { SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Connect",
  "Clearline Connect: one payment-instruction model across providers. Idempotent intents, route quotes with eligibility reasons, maker-checker approval, one execution model, and a provider adapter framework that treats every provider status as a claim. Test mode with fictional providers.",
  "/connect",
);

const steps = [
  ["Create an intent", "Amount in integer minor units, currency pair, beneficiary reference, destination country, requested date and your internal reference. An idempotency key is required: the same key and body returns the original intent; a different body is rejected."],
  ["Request quotes", "Every sandbox route is quoted, eligible or not. Each quote shows rate, provider and platform fees, estimated recipient amount and ETA, is labelled indicative and not executable, and expires after 15 minutes."],
  ["Choose and approve", "Choosing a route creates an instruction with the operator as maker. A different person must approve it as checker; self-approval is refused."],
  ["Submit and follow", "Provider events move execution through allowed states only. Duplicates are ignored, late events never move a payment backwards, bad signatures are rejected and contradictions raise an exception."],
];

/** CONNECT_ADAPTERS.md on rc4/clearline-app @ a132340. Engine and tests only; three fictional providers. */
const ADAPTER_RULES: [string, string][] = [
  ["Raw status kept verbatim", "Each provider event stores the provider's own status, sub-status and reason exactly as sent, beside the normalised claim. An unmapped status is refused, never guessed."],
  ["A provider's \"done\" is a claim", "Provider statuses and settlement reports are classed as claims. They change execution only and never count as independent evidence of settlement."],
  ["Reversals become contradictions", "A provider moving backwards, such as paid then failed, raises a contradiction exception that a person owns. The earlier claim stays visible."],
  ["Order by the provider, not by arrival", "Events are ordered by the provider's own object version or declared status rank, never by arrival time. For the fictional providers with object versions, the tests run every arrival order of each scenario without a hold and get the same outcome."],
  ["Pluggable webhook verification", "Each provider declares its signing scheme. Several keys can be active during a rotation, and a delivery outside a 300-second replay window is rejected. A delivery that cannot be verified is not applied: the provider's status is polled instead."],
  ["Polling when webhooks are lost", "Every adapter can be polled for a payout's latest status or a feed of changes, so a lost webhook does not lose the outcome."],
  ["One idempotency key per instruction", "Retries reuse the same provider key. Past the provider's key lifetime, the status is polled before any retry."],
];

export default function Connect() {
  return (
    <main id="main">
      <PageHero eyebrow="Clearline Connect" title={<>One way to instruct <em>many payment routes.</em></>}
        stages={["synthetic", "none"]}
        actions={<><ButtonLink href={SOFTWARE_URL} main>Try Connect in test mode</ButtonLink><ButtonLink href="/developers" variant="secondary">Developer quickstart</ButtonLink></>}>
        <p>Connect gives payment teams one instruction model across providers: the same intent, quote, approval and status fields whichever route is used. Today it runs against fictional sandbox providers only.</p>
      </PageHero>

      <Section tone="white" eyebrow="Workflow" title="From instruction to status">
        <ol className="list-rows">
          {steps.map(([t, d], i) => <li key={t}><span className="idx">{String(i + 1).padStart(2, "0")}</span><div><h3 className="h3">{t}</h3><p>{d}</p></div></li>)}
        </ol>
      </Section>

      <Section eyebrow="Route comparison" title="Quotes keep the excluded route and its reason"
        intro={<p>Operators need to see why a route was not offered, not just the routes that were. This is the engine&rsquo;s actual output for the sample request.</p>}>
        <QuotesTable />
      </Section>

      <Section id="adapters" tone="white" eyebrow="Provider adapters" title={<>Every provider speaks differently. <em>Each one is declared, not guessed.</em></>}
        intro={<p>Payment providers document statuses that can later reverse, webhooks that may arrive out of order or not at all, and different signing schemes. Connect&rsquo;s adapter framework gives each provider a reviewable declaration of how its events are trusted, mapped, ordered and polled, and feeds them all into one event path.</p>}>
        <ol className="list-rows">
          {ADAPTER_RULES.map(([t, d], i) => <li key={t}><span className="idx">{String(i + 1).padStart(2, "0")}</span><div><h3 className="h3">{t}</h3><p>{d}</p></div></li>)}
        </ol>
        <p className="note" style={{ marginTop: 24 }}>Built in the engine and covered by its tests, with three fictional providers. It is not yet in the console or the sample workspace, and no real provider is connected: that needs founder approval, a security review and a review of the provider&rsquo;s own documentation first.</p>
        <div className="stage-row"><Stage kind="synthetic" /><Stage kind="none" /></div>
      </Section>

      <Section tone="canvas" eyebrow="Boundaries" title="What Connect does not do today">
        <div className="grid-2">
          <ul className="bullets">
            <li>No licensed provider, bank or wallet is connected. Providers named in the sandbox are fictional.</li>
            <li>No real payment instruction leaves the system. Rates, fees and ETAs are fixed illustrations.</li>
            <li>The test API is stateless: the caller passes its workspace back with each request, or starts from the sample. Nothing is persisted.</li>
          </ul>
          <ul className="bullets">
            <li>Provider webhooks are signed sandbox events with public example secrets. There is no real outbound delivery, endpoint registration or retry queue.</li>
            <li>Clearline does not hold funds or signing keys, and does not make compliance decisions.</li>
            <li>Execution with real partners would need authorised partners and legal and security review first.</li>
          </ul>
        </div>
        <div className="stage-row"><Stage kind="synthetic" /><Stage kind="none" /></div>
        <p style={{ marginTop: 16 }}><Link className="text-link" href="/control">Next: what Control does after submission</Link></p>
      </Section>

      <ContactBand />
    </main>
  );
}
