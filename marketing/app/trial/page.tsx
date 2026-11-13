import { ButtonLink, ContactBand, ExtLink, PageHero, Section } from "@/components/Shared";
import { FUNDING_DESK_URL, SOFTWARE_URL, TRIAL_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Customer trial",
  "Evaluate Clearline in 15–20 minutes with five fictional cases, then discuss how to test it safely against a small number of your own historical cases.",
  "/trial",
);

const cases = [
  ["01", "Create an intent", "Connect", "Create a fictional payment, compare three sandbox quotes and one excluded route, choose a route and follow it to provider-reported completion."],
  ["02", "Investigate a return", "Control", "Inspect a returned payout and identify the beneficiary-details correction required, and who owns it."],
  ["03", "Handle a compliance hold", "Control", "See the provider's document request and the human owner. Clearline records holds; it does not clear them."],
  ["04", "Inspect stablecoin finality", "Control", "Distinguish a synthetic Base Sepolia transaction observation from proof of final settlement."],
  ["05", "Follow an advance", "Funding Desk", "Review maker-checker approvals, the outstanding ledger and a repayment exception in the separate Funding Desk prototype."],
];

const safe = [
  ["Agree the question first", "One workflow, and what a useful finding would look like. No data changes hands at this step."],
  ["Use up to five historical cases", "Closed cases only, redacted by your team. Only the fields needed: timestamps, references, statuses, amounts. No beneficiary personal data, account numbers or identity documents."],
  ["Write the data terms down", "Permitted fields, transfer method, who has access, where it is stored, retention and deletion date, agreed in writing before anything is shared. Never through this website or the sandbox."],
  ["Reconstruct, then compare", "Rebuild what was known at each point in time, compare it with what your team did, and record where the workflow helps and where it does not."],
  ["Keep the limits explicit", "This is a product evaluation. It is not an audit or assurance engagement, and it cannot prove a different outcome would have occurred."],
];

export default function Trial() {
  return (
    <main id="main">
      <PageHero eyebrow="Customer trial" title={<>Start with the payments <em>that are hard to explain.</em></>}
        stages={["synthetic", "illustrative"]}
        actions={<><ButtonLink href={TRIAL_URL} main>Start the guided trial</ButtonLink><ButtonLink href="/contact" variant="secondary">Talk to us about your workflow</ButtonLink></>}>
        <p>Five fictional cases take 15–20 minutes. No sign-up, bank login or integration. Everything you see is synthetic: providers, quotes, webhooks, balances and statements.</p>
      </PageHero>

      <Section tone="white" eyebrow="Part one · explore" title="The five cases">
        <ol className="list-rows">
          {cases.map(([n, t, area, d]) => (
            <li key={n}><span className="idx">{n}</span><div><p className="label">{area}</p><h3 className="h3">{t}</h3><p>{d}</p></div></li>
          ))}
        </ol>
        <div className="actions">
          <ButtonLink href={TRIAL_URL}>Open the guided trial</ButtonLink>
          <ButtonLink href={SOFTWARE_URL} variant="secondary">Go straight to the console</ButtonLink>
        </div>
        <p className="caption" style={{ marginTop: 12 }}>Case 05 opens the <ExtLink href={FUNDING_DESK_URL}>Funding Desk prototype</ExtLink>, which does not share records with Connect yet.</p>
      </Section>

      <Section eyebrow="Three questions for your team" title="Would this change your operating day?">
        <ol className="list-rows">
          <li><span className="idx">01</span><p>Where does your team lose payment visibility today?</p></li>
          <li><span className="idx">02</span><p>Which exception takes the most work to resolve, and who owns it?</p></li>
          <li><span className="idx">03</span><p>What do you use for it now, and who would own the budget to fix it?</p></li>
        </ol>
        <p style={{ marginTop: 20 }}><a className="text-link" href={mailto("Clearline trial: our answers")}>Send your answers by email</a></p>
      </Section>

      <Section id="historical" tone="bluegrey" eyebrow="Part two · historical cases" title="How to evaluate your own history safely"
        intro={<p>If the fictional cases look relevant, we can discuss replaying up to five of your closed, redacted cases. That only happens after we agree the scope and how the data will be handled securely, in writing, and never through the public sandbox.</p>}>
        <ol className="list-rows">
          {safe.map(([t, d], i) => <li key={t}><span className="idx">{String(i + 1).padStart(2, "0")}</span><div><h3 className="h3">{t}</h3><p>{d}</p></div></li>)}
        </ol>
        <p className="note" style={{ marginTop: 24 }}>Never send credentials, wallet keys, bank logins, account numbers, identity documents or customer records to Clearline by email or through this website. A real-data evaluation also needs an independent security review and advice for your jurisdiction first.</p>
      </Section>

      <ContactBand />
    </main>
  );
}
