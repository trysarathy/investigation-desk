import Link from "next/link";
import { ButtonLink, ContactBand, ExtLink, PageHero, Section, Stage } from "@/components/Shared";
import { LiquidityTable, ReconTable } from "@/components/Tables";
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
        intro={<p>Every event shows who reported it and what kind of evidence it is. The explanation and next action are written for the person who has to act.</p>}>
        <PaymentPreview />
      </Section>

      <Section eyebrow="Reconciliation" title="Match by reference. Never by amount alone."
        intro={<p>A settlement line is matched only when the reference, payment ID, currency and amount agree. Even then it is marked unverified until independent evidence exists. Anything else is an exception.</p>}>
        <ReconTable />
      </Section>

      <Section tone="white" eyebrow="Liquidity" title="Free balance, net of what is not yours to spend"
        intro={<p>Safeguarded funds, pending payouts and buffers are subtracted before anything is shown as free.</p>}>
        <LiquidityTable />
      </Section>

      <Section tone="bluegrey" eyebrow="Holds and funding exposure" title="Owners, not automated decisions">
        <div className="grid-2">
          <div className="panel">
            <h3 className="h3">Holds</h3>
            <p>When a provider holds a payout and asks for documents, Control records the request and names the owner. It does not clear holds or decide compliance questions.</p>
            <Stage kind="illustrative" />
          </div>
          <div className="panel">
            <h3 className="h3">Funding exposure</h3>
            <p>Some providers pay a supplier before their customer repays. The Funding Desk prototype prepares checks, records the treasury decision and tracks what is still owed. It is a separate module and is not yet linked to Connect payment IDs.</p>
            <div className="stage-row"><Stage kind="illustrative" /></div>
            <p><ExtLink href={FUNDING_DESK_URL}>Open the Funding Desk prototype</ExtLink></p>
          </div>
        </div>
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/use-cases">Worked examples for each workflow</Link></p>
      </Section>

      <ContactBand />
    </main>
  );
}
