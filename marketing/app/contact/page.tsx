import { ButtonLink, ExtLink, PageHero, Section } from "@/components/Shared";
import ContactForm from "@/components/ContactForm";
import { BOOKING_URL, LINKEDIN, TRIAL_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Contact",
  "Email Clearline's founder about your payment workflow. Booking link pending. Never send payment records, beneficiary details or credentials.",
  "/contact",
);

export default function Contact() {
  return (
    <main id="main">
      <PageHero eyebrow="Contact" title={<>Talk to us about <em>your workflow.</em></>}
        actions={<><ButtonLink href={mailto("Clearline: our payment workflow")} main>Email the founder</ButtonLink><ButtonLink href={TRIAL_URL} variant="secondary">Explore the sandbox first</ButtonLink></>}>
        <p>A few sentences are enough: which payments are hard to explain, who owns the exception, and what you use today. Aashmiin Kaur reads and replies to every email herself.</p>
      </PageHero>

      <Section tone="white">
        <div className="grid-2">
          <ContactForm />
          <div className="panel">
            <p className="label">Book a call</p>
            {BOOKING_URL
              ? <p><ExtLink href={BOOKING_URL}>Choose a time</ExtLink></p>
              : <p>Booking link pending. Until it is set up, email to arrange a time.</p>}
            <p className="label" style={{ marginTop: 20 }}>LinkedIn</p>
            <p><ExtLink href={LINKEDIN}>Aashmiin Kaur</ExtLink></p>
          </div>
        </div>
        <p className="note" style={{ marginTop: 32 }}>Do not send payment records, statements, beneficiary details, account numbers, identity documents, credentials or wallet keys. If a historical-case evaluation makes sense later, data terms are agreed in writing first.</p>
      </Section>
    </main>
  );
}
