import Link from "next/link";
import { ButtonLink, ContactBand, PageHero, Section, Stage } from "@/components/Shared";
import { PaymentsTable } from "@/components/Tables";
import { ExecStatus, EvidenceStatus, ReconStatus } from "@/components/Status";
import { SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Platform",
  "How Clearline is structured: Connect sends instructions, Control follows the outcome, and both write to one shared payment record with separate execution, evidence and reconciliation statuses.",
  "/platform",
);

export default function Platform() {
  return (
    <main id="main">
      <PageHero eyebrow="Platform" title={<>Two products. <em>One payment record.</em></>}
        stages={["synthetic", "illustrative", "none"]}
        actions={<><ButtonLink href={SOFTWARE_URL} main>Open the test-mode console</ButtonLink><ButtonLink href="/developers" variant="secondary">Read the status model</ButtonLink></>}>
        <p>Connect handles the instruction side. Control handles everything after submission. Both read and write the same record, so an operator, a finance lead and an engineer look at one account of what happened.</p>
      </PageHero>

      <Section tone="white" eyebrow="Architecture" title="Sources in, one record, work out"
        intro={<p>Every entry on the record keeps its source and what kind of evidence it is. Nothing is upgraded from &ldquo;reported&rdquo; to &ldquo;verified&rdquo; without evidence.</p>}>
        <div className="arch" role="group" aria-label="Clearline architecture">
          <div className="arch-col">
            <p className="label">Sources</p>
            <div className="arch-box"><b>Payment instructions</b><span className="caption">Connect API: intents, quotes, approvals</span><Stage kind="synthetic" /></div>
            <div className="arch-box"><b>Provider status events</b><span className="caption">Submitted, in transit, completed, returned, on hold</span><Stage kind="synthetic" /></div>
            <div className="arch-box"><b>Statements and settlement exports</b><span className="caption">Bank or provider files</span><Stage kind="illustrative" /></div>
            <div className="arch-box"><b>Chain observations</b><span className="caption">Stablecoin transfers, finality</span><Stage kind="development" /></div>
          </div>
          <div className="arch-arrow" aria-hidden="true">→</div>
          <div className="arch-core">
            <p className="label">Shared payment record</p>
            <dl>
              <div><dt>identity</dt><dd>payment id · reference · beneficiary · amount · corridor</dd></div>
              <div><dt>execution status</dt><dd>from the Connect state machine</dd></div>
              <div><dt>evidence status</dt><dd>reported vs. verified, kept separate</dd></div>
              <div><dt>reconciliation status</dt><dd>matched by reference, or an exception</dd></div>
              <div><dt>timeline</dt><dd>every event with its source and evidence label</dd></div>
              <div><dt>owner · next action</dt><dd>who acts, and on what</dd></div>
            </dl>
          </div>
          <div className="arch-arrow" aria-hidden="true">→</div>
          <div className="arch-col">
            <p className="label">Control views</p>
            <div className="arch-box"><b>Investigation</b><span className="caption">Timeline, explanation, next action</span></div>
            <div className="arch-box"><b>Reconciliation</b><span className="caption">Matches and exceptions by reference</span></div>
            <div className="arch-box"><b>Liquidity</b><span className="caption">Free balance net of restricted amounts</span></div>
            <div className="arch-box"><b>Holds and exceptions</b><span className="caption">Owner and requested action</span></div>
            <div className="arch-box"><b>Funding exposure</b><span className="caption">Separate Funding Desk prototype</span></div>
          </div>
        </div>
        <p className="caption" style={{ marginTop: 16 }}>Stage labels describe today. The Funding Desk is a separate prototype and does not yet share persisted records with Connect.</p>
      </Section>

      <Section eyebrow="Why three statuses" title="Reported, evidenced and reconciled are different facts"
        intro={<p>A single &ldquo;status&rdquo; column hides the question a CFO actually asks: do we know, or were we told? Clearline keeps three fields and gives each its own visual style.</p>}>
        <div className="grid-3">
          <div className="card"><p className="label">Execution</p><p><ExecStatus state="completed" /></p><p>What the payment&rsquo;s state machine says, driven by Connect and provider events.</p></div>
          <div className="card"><p className="label">Evidence</p><p><EvidenceStatus state="provider_reported_completed" /> <EvidenceStatus state="settlement_evidence_verified" /></p><p>Whether completion is only reported, or supported by independent settlement evidence.</p></div>
          <div className="card"><p className="label">Reconciliation</p><p><ReconStatus state="matched" /> <ReconStatus state="exception" /> <ReconStatus state="reconciled" /></p><p>Whether the instruction, evidence and ledger agree by reference.</p></div>
        </div>
      </Section>

      <Section tone="white" eyebrow="The seeded sandbox" title="Five payments, as the test-mode engine holds them"
        intro={<p>No sample payment reaches <code className="inline">settlement_evidence_verified</code> or <code className="inline">reconciled</code>: the sandbox has no independent settlement evidence, so it does not claim any.</p>}>
        <PaymentsTable />
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/developers#status-model">Full status model and transitions</Link></p>
      </Section>

      <ContactBand />
    </main>
  );
}
