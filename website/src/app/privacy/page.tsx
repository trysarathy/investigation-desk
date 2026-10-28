import type { Metadata } from "next";
import { Footer, Header } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy notice", description: "How Clearline handles the details you send through this website." };

const contact = site.contactEmail ? (
  <a href={`mailto:${site.contactEmail}`} className="text-accent underline underline-offset-2">{site.contactEmail}</a>
) : (
  <a href={site.linkedin} className="text-accent underline underline-offset-2">LinkedIn</a>
);

export default function Privacy() {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto max-w-2xl px-5 py-20 sm:px-8">
        <h1 className="text-[clamp(32px,5vw,44px)] font-semibold tracking-[-0.03em]">Privacy notice</h1>
        <p className="mt-3 text-[14px] text-faint">Last updated 28 October 2026</p>
        <div className="mt-10 space-y-8 text-[16px] leading-relaxed text-muted [&_h2]:mb-2 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-fg">
          <section>
            <h2>Who we are</h2>
            <p>Clearline is a pre-launch project run by {site.founder} in Singapore. This notice covers the details you give us through this website. We aim to follow Singapore's Personal Data Protection Act (PDPA).</p>
          </section>
          <section>
            <h2>What we collect</h2>
            <p>If you fill in the design-partner form: your name, company, work email, how your customers pay you, a payment-volume range, and anything you write in the note. We also record which link brought you here (for example, a LinkedIn post), if the link says so.</p>
            <p className="mt-3">For page visits we use cookie-free analytics, which counts visits without identifying you.</p>
          </section>
          <section>
            <h2>Why we use it</h2>
            <p>Only to reply to you and to run the design-partner programme. We don't sell your details, add you to a mailing list, or share them with anyone except the services below.</p>
          </section>
          <section>
            <h2>Services that process it for us</h2>
            <p>Form submissions are delivered by Formspree, and the website is hosted by Vercel. Both may store data outside Singapore, under their own security and privacy terms.</p>
          </section>
          <section>
            <h2>How long we keep it</h2>
            <p>Until the design-partner programme ends, or until you ask us to delete it, whichever comes first.</p>
          </section>
          <section>
            <h2>Your choices</h2>
            <p>You can ask to see, correct or delete your details, or withdraw your consent, at any time. Contact us on {contact} and we'll act on it promptly.</p>
          </section>
          <section>
            <h2>Data from pilots</h2>
            <p>If you become a design partner, any payment data you choose to share is used only to run your pilot, and deleted when you ask. We'll agree the details with you in writing before you share anything.</p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
