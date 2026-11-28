import type { Metadata } from "next";
import Link from "next/link";
import g from "@/components/merchant/screens-g2.module.css";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";

export const metadata: Metadata = { title: "How to get started" };

const SAMPLES = [
  { file: "kestrelbay-sample-provider-settlement-report.csv", label: "Provider settlement / payout report (CSV)", type: "Provider export" },
  { file: "kestrelbay-sample-bank-statement.csv", label: "Bank statement (CSV)", type: "Bank statement" },
  { file: "kestrelbay-sample-invoices-orders.csv", label: "Invoices / orders (CSV)", type: "Orders or invoices" },
];

/** The customer's own first-day guide: the steps a finance team follows, with links to each screen. */
export default async function GettingStartedPage() {
  await merchantMember();
  return (
    <>
      <h1 className={s.title}>How to get started</h1>
      <p className={s.lede}>Pilot: anonymised or sample files only until your data agreement is signed. Clearline is read-only: it never holds, sends or converts money.</p>
      <section className={s.section} aria-labelledby="steps">
        <h2 className={s.h2} id="steps">Steps</h2>
        <ol className={g.steps}>
          <li><strong>Sign in</strong> with the link your administrator sent you, and choose a password.</li>
          <li><strong>Set up two-factor sign-in.</strong> Admins and Approvers must add an authenticator app (Security page) before they can work.</li>
          <li><strong>Create your entity</strong> (Admin): <Link href="/control/merchant/setup">Setup</Link> → entity name, base currency, time zone, tolerance, provider and the wallet addresses to watch. To try the sample files, create the entity with ID <code>ENT-SG-SYN</code> in SGD.</li>
          <li><strong>Upload your files</strong> (Finance): <Link href="/control/merchant/uploads">Uploads</Link> → choose the entity and the file type, upload, check the column mapping, validate, and confirm. A bank statement needs a second person to confirm it.</li>
          <li><strong>Run reconciliation</strong>: <Link href="/control/merchant/runs">Runs</Link> → &ldquo;Run reconciliation&rdquo; for the entity.</li>
          <li><strong>Review exceptions</strong>: <Link href="/control/merchant/exceptions">Exceptions</Link> → each one has an owner, a reason and a next step. Assign it, add a note, or prepare a write-off.</li>
          <li><strong>Approve</strong> (Approver, a different person from the one who prepared it): <Link href="/control/merchant/approvals">Approvals</Link>.</li>
          <li><strong>Export</strong>: <Link href="/control/merchant/accounting">Accounting export</Link> (journal file preview), <Link href="/control/merchant/month-end">Month-end</Link> pack, and <Link href="/control/merchant/evidence">Evidence packs</Link>.</li>
        </ol>
        <p className={s.small}>A payment is matched only when the chain transfer, the provider record and your order agree by reference, with exact amounts after typed differences. An amount alone never closes a match; anything uncertain goes to review.</p>
      </section>
      <section className={s.section} aria-labelledby="samples">
        <h2 className={s.h2} id="samples">Download sample files</h2>
        <p className={s.small}>A fictional company (&ldquo;Kestrelbay Synthetic&rdquo;, entity ENT-SG-SYN, SGD). Every name, number, address and hash in them is made up, so on a live deployment the chain cannot confirm these payments and they go to review rather than being matched.</p>
        <ul className={g.downloadList}>
          {SAMPLES.map((x) => (
            <li key={x.file}><a href={`/samples/${x.file}`} download>{x.label}</a> <span className={s.small}>(upload as &ldquo;{x.type}&rdquo;)</span> <span className={`${s.small} ${g.mono}`}>{x.file}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}
