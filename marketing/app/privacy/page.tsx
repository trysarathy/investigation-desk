import Link from "next/link";
import { ButtonLink, PageHero, Section } from "@/components/Shared";
import { FORM_ENABLED } from "@/components/ContactForm";
import { EMAIL, PRODUCT_DEMO_URL, mailto } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Privacy",
  "How the Clearline website handles information: no analytics or tracking, fonts served from this site, email to the founder's university mailbox, and a separate test-mode sandbox.",
  "/privacy",
);

export default function Privacy() {
  const rows: [string, string][] = [
    ["Who we are", "Clearline is an early-stage project run by Aashmiin Kaur in Singapore. It is not yet an incorporated company with a dedicated privacy officer; questions go to the founder directly."],
    ["Hosting", "This website is static and is intended to be hosted on Vercel, which processes standard connection data (such as IP address and request logs) to deliver pages. We do not receive or use those logs for marketing."],
    ["Analytics and cookies", "None. The site sets no cookies, runs no analytics and loads no advertising or social tracking scripts. Fonts are served from this site, not from a third-party font service."],
    ["Email", "If you email " + EMAIL + ", your message is held in the founder's Singapore Management University mailbox, under the university's email arrangements. It is used only to reply to you and is not added to a mailing list."],
    ["Web form", FORM_ENABLED ? "The contact form is processed by Formspree, a third-party form service, which forwards your message to the founder." : "There is no web form on this site at the moment. Nothing you type on this website is collected."],
    ["The sandbox", "The sandbox at " + PRODUCT_DEMO_URL + " is a separate test-mode application with fictional data. Its console keeps your test session in your own browser's local storage. Do not enter real information there."],
    ["Payment records", "Never send payment records, beneficiary details, statements, credentials or keys through this website or by email. Any historical-case evaluation needs written data terms first."],
    ["Your requests", "You can ask what information we hold about you, or ask us to correct or delete it, by emailing the founder."],
  ];
  return (
    <main id="main">
      <PageHero eyebrow="Privacy" title={<>Privacy, <em>plainly.</em></>}
        actions={<ButtonLink href={mailto("Privacy question")} main>Ask a privacy question</ButtonLink>}>
        <p>What this website collects (very little), who processes it, and what never to send us. Last updated 13 November 2026.</p>
      </PageHero>
      <Section tone="white">
        <div className="list-rows prose">
          {rows.map(([t, d], i) => <div key={t}><span className="idx">{String(i + 1).padStart(2, "0")}</span><div><h2 className="h3">{t}</h2><p>{d}</p></div></div>)}
        </div>
        <p className="caption" style={{ marginTop: 24 }}>This notice describes the website as built. It has not been reviewed by a lawyer. See also <Link className="text-link" href="/trial#historical">how historical-case evaluations handle data</Link>.</p>
      </Section>
    </main>
  );
}
