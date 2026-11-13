import Link from "next/link";
import { ButtonLink, ContactBand, ExtLink, PageHero, Section, Stage } from "@/components/Shared";
import { ExceptionsTable, FundingTable, LiquidityTable, ReconTable } from "@/components/Tables";
import PaymentPreview from "@/components/PaymentPreview";
import { FUNDING_DESK_URL, SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Control",
  "Clearline Control: investigation, reconciliation, liquidity, holds and funding exposure on one payment record. Illustrative console on fictional data.",
  "/control",
);

export default function Control() {
  return (
    <main id="main">
      <PageHero eyebrow="Clearline Control" title={<>Understand what happened <em>after submission.</em></>}
        stages={["illustrative", "synthetic", "none"]}
        actions={<><ButtonLink href={SOFTWARE_URL} main>Open Control in test mode</ButtonLink><ButtonLink href="/use-cases" variant="secondary">See the use cases</ButtonLink></>}>
        <p>Control is the operations side: it follows each payment after it leaves, separates what was reported from what can be shown, and turns disagreements into exceptions with an owner.</p>
      </PageHero>

      <Section tone="white" eyebrow="Investigation" title="A timeline with sources, not a status badge"
        intro={<p>Every event shows its provenance and what the engine did with it. The investigation view separates what the provider reported from independent evidence, lists what is still unknown, and names who acts next.</p>}>
        <PaymentPreview />
      </Section>

      <Section eyebrow="Reconciliation" title="Match by reference. Never by amount alone."
        intro={<p>A statement line is allocated automatically only on a trusted reference (the provider payment id for payouts, the repayment reference for repayments) plus amount, currency and a value-date window. Amount-only, ambiguous, duplicate, currency-mismatched or out-of-window lines become exceptions with an explanation code. A full bank-statement match sets settlement verified (scope bank_statement); it shows the payout left the account, not that the beneficiary was credited. A provider-reported return makes reconciliation an exception at once. A matching return line on the statement confirms it (returnStatus confirmed_by_statement), but the exception stays open until a person resolves it, because the supplier is still unpaid.</p>}>
        <ReconTable />
        <h3 className="h3" style={{ margin: "40px 0 12px" }}>Exceptions, owners and due dates</h3>
        <ExceptionsTable />
      </Section>

      <Section tone="white" eyebrow="Liquidity" title="Usable balance, net of what is not yours to spend"
        intro={<p>Restricted and safeguarded amounts, committed payouts and a policy buffer are subtracted before anything is shown as usable. Stale snapshots are flagged and left out. The classifications follow an illustrative, provider-defined policy, not a regulatory one.</p>}>
        <LiquidityTable />
      </Section>

      <Section tone="bluegrey" eyebrow="Holds and funding exposure" title="Owners, not automated decisions">
        <div className="grid-2">
          <div className="panel">
            <h3 className="h3">Holds</h3>
            <p>When a provider holds a payout and asks for documents, Control records the request, assigns a compliance reviewer and records their decision. Holds are never released automatically, and Clearline makes no compliance decision.</p>
            <div className="stage-row"><Stage kind="synthetic" /></div>
          </div>
          <div className="panel">
            <h3 className="h3">Funding exposure</h3>
            <p>Some providers pay a supplier before their customer repays. In the sandbox engine, the supplier payout is linked through a tested projection to the advance, the treasury approval (maker ≠ checker), the repayment obligation and its allocations. It is a projection over the sandbox workspace, not a shared production ledger, and the provider makes every credit decision.</p>
            <div className="stage-row"><Stage kind="synthetic" /></div>
            <p><ExtLink href={FUNDING_DESK_URL}>Open the detailed Funding Desk prototype</ExtLink></p>
          </div>
        </div>
        <div style={{ marginTop: 32 }}><FundingTable /></div>
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/use-cases">Worked examples for each workflow</Link></p>
      </Section>

      <ContactBand />
    </main>
  );
}
