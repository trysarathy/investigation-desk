import { ButtonLink, ContactBand, ExtLink, Section } from "@/components/Shared";
import { EMAIL, LINKEDIN, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "About the founder",
  "Clearline is built in Singapore by Aashmiin Kaur, 19, a second-year Accountancy student at Singapore Management University with a second major in Finance. What exists, what does not, and what she is still learning.",
  "/about",
);

export default function About() {
  return (
    <main id="main">
      <section className="page-hero" aria-labelledby="about-title">
        <div className="container founder">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="founder-photo" src="/founder.jpg" alt="Aashmiin Kaur" width={120} height={150} />
          <div>
            <p className="eyebrow">About · Singapore</p>
            <h1 id="about-title" className="h1">Aashmiin Kaur, <em>founder.</em></h1>
            <div className="lede"><p>I&rsquo;m 19 and in my second year of Accountancy at Singapore Management University, with a second major in Finance. I&rsquo;m building Clearline in Singapore, mostly in the evenings around classes.</p></div>
            <div className="actions">
              <ButtonLink href={mailto("Hello from the Clearline website")} main>Email Aashmiin</ButtonLink>
              <ButtonLink href={LINKEDIN} variant="secondary">LinkedIn</ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <Section tone="white" eyebrow="Why Clearline" title="The question behind it">
        <div className="prose">
          <p>Studying accountancy, I kept returning to one gap: a payment can be &ldquo;completed&rdquo; in one system and still unexplained in the books. When money crosses borders and providers, the people responsible for it often rebuild the story by hand from portals, statements and email.</p>
          <p>Clearline is my attempt to keep that story on one record: what was instructed, what each provider reported, what can actually be shown, and what still needs a person.</p>
        </div>
      </Section>

      <Section eyebrow="Where it stands" title="What exists, and what does not">
        <div className="grid-2">
          <div className="prose">
            <p className="label">Exists</p>
            <ul className="bullets">
              <li>A test-mode engine and console with fictional providers and data.</li>
              <li>A guided five-case sandbox anyone can open.</li>
              <li>A Funding Desk prototype, linked to sandbox payments through a tested projection (not a shared production ledger).</li>
            </ul>
          </div>
          <div className="prose">
            <p className="label">Does not exist yet</p>
            <ul className="bullets">
              <li>Customers, partners or investors.</li>
              <li>Any connection to a real provider, bank or wallet.</li>
              <li>A team beyond me. I use AI software tools for parts of the engineering and drafting, and I review what ships.</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="bluegrey" eyebrow="Still learning" title="What I do not know yet">
        <div className="prose">
          <ul className="bullets">
            <li>How payment-operations teams at providers actually divide the work between operations, finance and compliance.</li>
            <li>The licensing and regulatory requirements that would apply before Clearline touched real payment flows, in Singapore and elsewhere.</li>
            <li>What it takes to run financial software reliably and securely for other people&rsquo;s money data.</li>
            <li>Which of the four workflows, if any, a team would pay to fix first.</li>
          </ul>
          <p style={{ marginTop: 16 }}>If you work on any of these, I would value an honest conversation: <a className="text-link" href={"mailto:" + EMAIL}>{EMAIL}</a>. <ExtLink href={LINKEDIN}>LinkedIn</ExtLink>.</p>
        </div>
      </Section>

      <ContactBand />
    </main>
  );
}
