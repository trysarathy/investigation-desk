import { ButtonLink, ContactBand, PageHero, Section, Stage } from "@/components/Shared";
import { EvidenceStatus } from "@/components/Status";
import { SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Onchain",
  "Clearline's onchain direction: Safe payout proposals, evidence fingerprints on Base and stablecoin repayment checks. In development on testnet. No custody, no keys, no execution.",
  "/onchain",
);

const items = [
  ["01", "Safe payout proposals", "After a human treasury decision, prepare a proposed USDC transfer for the provider's own Safe. The provider's signers decide whether to approve and execute.", "Clearline does not hold or use signing keys."],
  ["02", "Evidence fingerprints on Base", "Hash a case's evidence bundle and anchor only the digest. Documents and customer data stay off-chain.", "A hash shows a record has not changed since; it cannot certify that the original facts were true."],
  ["03", "Stablecoin verification", "Check token contract, network and finality before attributing a transfer or repayment to a case by its exact reference.", "A matching amount or a similar token name is not proof."],
];

export default function Onchain() {
  return (
    <main id="main">
      <PageHero eyebrow="Onchain · in development" title={<>A payment can move onchain. <em>Control still matters.</em></>}
        stages={["development", "none"]}
        actions={<><ButtonLink href={SOFTWARE_URL} main>See the testnet delay case</ButtonLink><ButtonLink href="/contact" variant="secondary">Discuss the design</ButtonLink></>}>
        <p>Stablecoin transfers still need approvals, transaction checks and a record finance can explain. This work is in development on testnet (Base Sepolia). It is not available for real transfers.</p>
      </PageHero>

      <Section tone="white" eyebrow="Proposed design" title="Three capabilities. No custody.">
        <ol className="list-rows">
          {items.map(([n, t, d, limit]) => <li key={n}><span className="idx">{n}</span><div><h3 className="h3">{t}</h3><p>{d}</p><p className="caption" style={{ marginTop: 8 }}>{limit}</p></div></li>)}
        </ol>
        <div className="stage-row"><Stage kind="development" /></div>
      </Section>

      <Section eyebrow="Proposed flow" title="Treasury keeps the last word">
        <div className="grid-4">
          {[["01", "Clearline prepares", "Draft transaction, evidence and approval context."], ["02", "Treasury approves", "A named person checks the decision."], ["03", "Provider signs", "The provider's own Safe signers execute."], ["04", "Control follows", "Confirmation and finality recorded as evidence."]].map(([n, t, d]) => (
            <div className="card" key={n}><p className="label">{n}</p><h3 className="h3">{t}</h3><p>{d}</p></div>
          ))}
        </div>
      </Section>

      <Section tone="bluegrey" eyebrow="What exists today" title="Observed is not final">
        <div className="prose">
          <p>The sandbox includes one synthetic Base Sepolia case: USDC 6,427.83 to Stonebridge Exports, reported in transit and awaiting finality. Its evidence status stays <EvidenceStatus state="none" /> until finality is confirmed and checked.</p>
          <p>There is no Safe integration, key management or payout execution. Payment services, data protection and licensing obligations need a jurisdiction-specific professional assessment before any real operation.</p>
        </div>
      </Section>

      <ContactBand />
    </main>
  );
}
