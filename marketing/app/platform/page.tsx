import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink, ContactBand, Disclosure, PageHero, Section, Stage } from "@/components/Shared";
import { PaymentsTable } from "@/components/Tables";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";
import { SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Platform",
  "How Clearline is structured: Connect sends instructions, Control follows the outcome, and both write to one shared payment record with separate execution, settlement and reconciliation statuses.",
  "/platform",
);

const rules: [string, ReactNode][] = [
  ["A provider report is a claim.", <>&ldquo;Completed&rdquo; is recorded as <code>provider_reported_completed</code>. On its own it never sets settlement <code>verified</code> or reconciliation <code>matched</code>, and a provider report on a failed or returned payout is a contradiction (<code>RC_REPORT_ON_TERMINAL_PAYOUT</code>).</>],
  ["Match by reference, never by amount alone.", <>A statement line is allocated only on a trusted reference plus amount, currency and a value-date window. A line that agrees only on amount becomes an exception (<code>RC_AMOUNT_ONLY_CANDIDATES</code>).</>],
  ["Evidence carries its scope.", <>A matched bank-statement debit is <code>verified</code> with scope <code>bank_statement</code>: the payout left the account. The beneficiary&rsquo;s credit can still be unknown, and the record says so.</>],
  ["Observation is not finality.", <>A synthetic testnet transfer counts as verified only past the finality threshold (12 confirmations on the Base Sepolia route), and never proves a supplier&rsquo;s bank credit.</>],
  ["Short is never settled.", <>A bank line with a trusted reference but only part of the amount is <code>partially_matched</code>; the remainder stays outstanding (<code>RC_PARTIAL_AMOUNT</code>). A provider report below the payout needs review (<code>RC_UNDER_AMOUNT_REPORT</code>), with expected, reported and difference stated.</>],
  ["A return is an exception until a person resolves it.", <>A statement line can confirm the return (<code>confirmed_by_statement</code>). The exception stays open, with its due date and the owner a person assigned, because the supplier is still unpaid.</>],
];

export default function Platform() {
  return (
    <main id="main">
      <PageHero eyebrow="Platform" title={<>Two products. <em>One payment record.</em></>}
        stages={["synthetic", "none"]}
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
            <div className="arch-box"><b>Statement lines</b><span className="caption">Bank statements or provider settlement reports (fictional inputs)</span><Stage kind="synthetic" /></div>
            <div className="arch-box"><b>Chain observations</b><span className="caption">Synthetic Base Sepolia transfers and confirmations. No real chain is read yet.</span><Stage kind="synthetic" /></div>
          </div>
          <div className="arch-arrow" aria-hidden="true">→</div>
          <div className="arch-core">
            <p className="label">Shared payment record</p>
            <dl>
              <div><dt>identity</dt><dd>payment id · reference · beneficiary · amount · corridor</dd></div>
              <div><dt>status.execution</dt><dd>from the Connect state machine and provider events</dd></div>
              <div><dt>status.settlement · settlementScope</dt><dd>none · observed · pending_finality · verified · contradicted, and what was evidenced</dd></div>
              <div><dt>status.reconciliation</dt><dd>not_started · pending · matched · partially_matched · exception</dd></div>
              <div><dt>timeline · audit</dt><dd>every event with its provenance and processing outcome; every action audited</dd></div>
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
            <div className="arch-box"><b>Funding Desk</b><span className="caption">Specialist funding workflow: payment ↔ advance ↔ repayment, through a tested projection</span></div>
          </div>
        </div>
        <p className="caption" style={{ marginTop: 16 }}>Stage labels describe today. In the sandbox engine a funded payout is linked to its advance, treasury approval and repayment obligation through a tested projection. That is a projection over the sandbox workspace, not a shared production ledger.</p>
      </Section>

      <Section eyebrow="Why three statuses" title="Reported, evidenced and matched are different facts"
        intro={<p>A single &ldquo;status&rdquo; column hides the question a CFO actually asks: do we know, or were we told? Clearline keeps three fields and gives each its own visual style.</p>}>
        <dl className="three-status">
          <div><dt><span className="label">execution</span><ExecStatus state="provider_reported_completed" /></dt><dd>What the payment&rsquo;s state machine says, driven by Connect and provider events. &ldquo;Completed&rdquo; is recorded as a provider claim.</dd></div>
          <div><dt><span className="label">settlement</span><SettlementStatus state="pending_finality" scope="onchain_transfer" /><SettlementStatus state="verified" scope="bank_statement" /></dt><dd>What independent evidence shows, and its scope. A matched bank debit proves the payout left; the beneficiary&rsquo;s credit can still be unknown.</dd></div>
          <div><dt><span className="label">reconciliation</span><ReconStatus state="matched" /><ReconStatus state="partially_matched" /><ReconStatus state="exception" /></dt><dd>Whether statement lines were allocated by trusted reference, amount, currency and date window.</dd></div>
        </dl>
      </Section>

      <Section tone="white" eyebrow="The seeded sandbox" title="Five scenarios, as the sandbox engine holds them"
        intro={<p>A provider &ldquo;completed&rdquo; report alone never sets settlement <code className="inline">verified</code>. In s1 and s5 a fictional bank-statement debit was matched, so settlement is <code className="inline">verified</code> with scope <code className="inline">bank_statement</code>. In s4 the testnet transfer has 6 of 12 confirmations, so it stays <code className="inline">pending_finality</code>.</p>}>
        <PaymentsTable />
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/developers#status-model">Full status model and transitions</Link></p>
      </Section>

      <section className="section section-midnight" aria-labelledby="rules-title" id="rules">
        <div className="container">
          <div className="section-head">
            <p className="eyebrow">Evidence and reconciliation</p>
            <h2 id="rules-title" className="h2">Six rules the engine enforces. <em>The interface only repeats them.</em></h2>
          </div>
          <ol className="principles">
            {rules.map(([t, d]) => <li key={t}><h3>{t}</h3><p>{d}</p></li>)}
          </ol>
        </div>
      </section>

      <Section id="stage" tone="white" eyebrow="The real stage" title="What works today, and what does not">
        <Disclosure headingId="platform-disclosure" />
      </Section>

      <ContactBand />
    </main>
  );
}
