import Link from "next/link";
import { ButtonLink, ContactBand, ExtLink, PageHero, Section, Stage } from "@/components/Shared";
import { AmountDifferenceTable, ExceptionsTable, FundingTable, LiquidityTable, ReconTable } from "@/components/Tables";
import InvestigationView from "@/components/InvestigationView";
import { FUNDING_DESK_URL, SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Control",
  "Clearline Control: investigation, reconciliation, exceptions, liquidity, holds and the Funding Desk workflow on one payment record. Test-mode console on fictional data.",
  "/control",
);

export default function Control() {
  return (
    <main id="main">
      <PageHero eyebrow="Clearline Control" title={<>Understand what happened <em>after submission.</em></>}
        stages={["synthetic", "none"]}
        actions={<><ButtonLink href={SOFTWARE_URL} main>Open Control in test mode</ButtonLink><ButtonLink href="/use-cases" variant="secondary">See the use cases</ButtonLink></>}>
        <p>Control is the operations side: it follows each payment after it leaves, separates what was reported from what can be shown, and turns disagreements into exceptions with an owner.</p>
      </PageHero>

      <Section tone="white" eyebrow="Investigation" title="A timeline with sources, not a status badge"
        intro={<p>Every event shows its provenance and what the engine did with it. The investigation view separates what the provider reported from independent evidence, lists what is still unknown, and names who acts next.</p>}>
        <InvestigationView initial="s3_hold" />
      </Section>

      <Section eyebrow="Reconciliation" title="Match by reference. Never by amount alone."
        intro={<p>A statement line is allocated automatically only on a trusted reference (the provider payment id for payouts, the repayment reference for repayments) plus amount, currency and a value-date window. Amount-only, ambiguous, duplicate, currency-mismatched or out-of-window lines become exceptions with an explanation code. A full bank-statement match sets settlement verified (scope bank_statement); it shows the payout left the account, not that the beneficiary was credited. A provider-reported return makes reconciliation an exception at once. A matching return line on the statement confirms it (returnStatus confirmed_by_statement), but the exception stays open until a person resolves it, because the supplier is still unpaid. While the return is open, any bank debit for the payout is contradicted settlement evidence. The investigation also states the return position, keeping two facts apart: net movement is zero only when the outgoing debit and an equal return credit are both on the statement, and the beneficiary is never treated as paid. In the sample return both legs are on the statement: &ldquo;The debit and the return credit (USD 12,784.90 each) net to zero on the statement. The beneficiary was not paid.&rdquo; A case cannot be closed while the payment is not yet evidenced or an advance repayment is still outstanding.</p>}>
        <ReconTable />
        <h3 className="h3" style={{ margin: "40px 0 12px" }} id="amount-differences">Short amounts and reports that contradict the payout</h3>
        <div className="prose" style={{ marginBottom: 16 }}>
          <p>A bank line with the trusted reference but less than the amount is allocated as partial: reconciliation is partially matched, settlement stays observed, and the remainder stays outstanding (<code className="inline">RC_PARTIAL_AMOUNT</code>).</p>
          <p>A provider settlement report below the payout amount is not treated as settlement in full. It raises an <code className="inline">unmatched_reconciliation</code> exception (<code className="inline">RC_UNDER_AMOUNT_REPORT</code>), reconciliation becomes an exception, and settlement is not upgraded. Both cases carry a structured difference: expected, reported, difference, currency, source and the required next action.</p>
          <p>A provider settlement report on a payout that is failed, cancelled, expired or returned is a contradiction, not evidence. It raises <code className="inline">contradictory_evidence</code> (<code className="inline">RC_REPORT_ON_TERMINAL_PAYOUT</code>), reconciliation becomes an exception, and settlement is left unchanged.</p>
        </div>
        <AmountDifferenceTable />
        <h3 className="h3" style={{ margin: "40px 0 12px" }}>Exceptions, owners and due dates</h3>
        <ExceptionsTable />
      </Section>

      <Section tone="white" eyebrow="Liquidity" title="Usable balance, net of what is not yours to spend"
        intro={<p>Restricted and safeguarded amounts, committed payouts and a policy buffer are subtracted before anything is shown as usable. Stale snapshots are flagged and left out. The classifications follow an illustrative, provider-defined policy, not a regulatory one.</p>}>
        <LiquidityTable />
      </Section>

      <Section tone="canvas" eyebrow="Compliance holds" title="Owners, not automated decisions">
        <div className="prose">
          <p>When a provider holds a payout and asks for documents, Control records the request, assigns a compliance reviewer and records their decision. No provider event moves a held payout on its own: it is released only after the partner reports the release and the assigned reviewer records a release decision, or it ends when the reviewer rejects. Clearline makes no compliance decision.</p>
          <div className="stage-row"><Stage kind="synthetic" /></div>
        </div>
      </Section>

      <Section id="funding-desk" tone="white" eyebrow="Funding Desk · a specialist workflow in Control" title={<>When a provider pays before <em>its customer repays.</em></>}
        intro={<p>Some providers pay a supplier before their customer repays them. The Funding Desk is Control&rsquo;s workflow for that exposure, not a separate product: the advance, a treasury decision by a second person (maker &ne; checker), the repayment obligation and its allocations, tied to the supplier payout that Connect sent.</p>}>
        <div className="grid-2">
          <div className="prose">
            <p className="label">In the sandbox engine</p>
            <p>The supplier payout is linked to the advance, treasury approval and repayment through a tested projection. It is a projection over the sandbox workspace, not a shared production ledger. Repayments are allocated only by repayment reference; an unreferenced receipt stays an exception even when the amount matches.</p>
            <div className="stage-row"><Stage kind="synthetic" /></div>
          </div>
          <div className="prose">
            <p className="label">In the interactive demo</p>
            <p>The Funding Desk demo walks a fictional advance through review, treasury approval, supplier payout and a repayment exception. It is a separate, interactive prototype; the provider makes every credit decision, and Clearline does not lend or supply capital.</p>
            <div className="stage-row"><Stage kind="prototype" /></div>
            <p><ExtLink href={FUNDING_DESK_URL}>Open the Funding Desk demo</ExtLink></p>
          </div>
        </div>
        <div style={{ marginTop: 32 }}><FundingTable /></div>
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/use-cases#funding">Worked funding example</Link></p>
      </Section>

      <ContactBand />
    </main>
  );
}
