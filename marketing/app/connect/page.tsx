import Link from "next/link";
import { ButtonLink, ContactBand, PageHero, Section, Stage } from "@/components/Shared";
import { QuotesTable } from "@/components/Tables";
import { SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Connect",
  "Clearline Connect: one payment-instruction model across providers. Idempotent intents, route quotes with eligibility reasons, maker-checker approval and one execution model. Test mode with fictional providers.",
  "/connect",
);

const steps = [
  ["Create an intent", "Amount in integer minor units, currency pair, beneficiary reference, destination country, requested date and your internal reference. An idempotency key is required: the same key and body returns the original intent; a different body is rejected."],
  ["Request quotes", "Every sandbox route is quoted, eligible or not. Each quote shows rate, provider and platform fees, estimated recipient amount and ETA, is labelled indicative and not executable, and expires after 15 minutes."],
  ["Choose and approve", "Choosing a route creates an instruction with the operator as maker. A different person must approve it as checker; self-approval is refused."],
  ["Submit and follow", "Provider events move execution through allowed states only. Duplicates are ignored, late events never move a payment backwards, bad signatures are rejected and contradictions raise an exception."],
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

      <Section tone="bluegrey" eyebrow="Boundaries" title="What Connect does not do today">
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
