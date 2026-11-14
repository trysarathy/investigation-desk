import { ButtonLink, ContactBand, Disclosure, ExtLink, PageHero, Section } from "@/components/Shared";
import { FUNDING_DESK_URL, SOFTWARE_URL, TRIAL_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";
import { CONSOLE_TOOLS, TRIAL_CASES, TRY_CONNECT } from "@/lib/cases";

export const metadata = pageMeta(
  "Customer trial",
  "Evaluate Clearline in 15–20 minutes with five fictional cases, then discuss how to test it safely against a small number of your own historical cases.",
  "/trial",
);


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
        stages={["synthetic", "none"]}
        actions={<><ButtonLink href={TRIAL_URL} main>Start the guided trial</ButtonLink><ButtonLink href="/contact" variant="secondary">Talk to us about your workflow</ButtonLink></>}>
        <p>Five fictional cases take 15–20 minutes. No sign-up, bank login or integration. Everything you see is synthetic: providers, quotes, webhooks, balances and statements.</p>
      </PageHero>

      <Section tone="white" eyebrow="Part one · explore" title="The five cases">
        <ol className="list-rows">
          {TRIAL_CASES.map(c => (
            <li key={c.n}><span className="idx">{c.n}</span><div><p className="label">{c.product} · console: {c.area}</p><h3 className="h3">{c.title}</h3><p>{c.text}</p></div></li>
          ))}
        </ol>
        <p style={{ marginTop: 24, maxWidth: "70ch" }}>{TRY_CONNECT}</p>
        <h3 className="h3" style={{ margin: "40px 0 12px" }} id="console-tools">While you work through the cases</h3>
        <dl className="tool-list" aria-labelledby="console-tools">
          {CONSOLE_TOOLS.map(t => <div key={t.title}><dt>{t.title}</dt><dd>{t.text}</dd></div>)}
        </dl>
        <p className="caption" style={{ marginTop: 12 }}>These are console features in your browser&rsquo;s workspace. The v1 test API does not expose them.</p>
        <div className="actions">
          <ButtonLink href={TRIAL_URL}>Open the guided trial</ButtonLink>
          <ButtonLink href={SOFTWARE_URL} variant="secondary">Go straight to the console</ButtonLink>
        </div>
        <p className="caption" style={{ marginTop: 12 }}>Case 05 is Control&rsquo;s specialist funding workflow. The <ExtLink href={FUNDING_DESK_URL}>Funding Desk demo</ExtLink> shows it interactively, as a separate prototype. In the sandbox, payments and advances are linked by a tested projection, not a shared production ledger.</p>
      </Section>

      <Section tone="canvas" eyebrow="Before you start" title="What the sandbox can and cannot show">
        <Disclosure headingId="trial-disclosure" />
      </Section>

      <Section tone="white" eyebrow="Three questions for your team" title="Would this change your operating day?">
        <ol className="list-rows">
          <li><span className="idx">01</span><p>Where does your team lose payment visibility today?</p></li>
          <li><span className="idx">02</span><p>Which exception takes the most work to resolve, and who owns it?</p></li>
          <li><span className="idx">03</span><p>What do you use for it now, and who would own the budget to fix it?</p></li>
        </ol>
        <p style={{ marginTop: 20 }}><a className="text-link" href={mailto("Clearline trial: our answers")}>Send your answers by email</a></p>
      </Section>

      <Section id="historical" tone="canvas" eyebrow="Part two · historical cases" title="How to evaluate your own history safely"
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
