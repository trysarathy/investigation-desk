/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { dataAsOf, overviewCounts, sourceFreshness } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import { can } from "@/server/authz";
import { demoBuild } from "@/server/demo-build";
import { DEMO_LAST_DAY, DEMO_TODAY } from "@/lib/clearline/demo/clock";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { DecisionChip, EvidenceChip } from "@/components/merchant/ui";
import { FreshnessStrip } from "@/components/merchant/freshness";
import { LiveRefresh } from "@/components/ui";
import { BANK_EVIDENCE_SHORT } from "@/lib/clearline/merchant";

export const metadata: Metadata = { title: "Overview" };

const n = (x: number) => x.toLocaleString("en-US");

/** The five records Clearline follows for every payment, in order. Each is shown on its own and never merged. */
const STEPS = [
  { key: "providerRecords", title: "Provider record", from: "Your payment provider's export", what: "What the provider says happened: the quote, the amount it credited you, its fee and the settlement batch. A claim, not proof.", independent: false },
  { key: "chainTransfers", title: "Chain transfer", from: "The blockchain (TRON, Ethereum)", what: "The token transfer itself: network, token contract, amount, deposit address, confirmations. Independent evidence.", independent: true },
  { key: "orders", title: "Order", from: "Your own orders or invoices", what: "What the customer owed you, in your currency. Clearline ties the transfer to the order by its deposit address or reference, never by the amount alone.", independent: false },
  { key: "batches", title: "Settlement batch", from: "The provider's settlement report", what: "How the provider grouped the day's payments, less fees and refunds, into one payout. A claim until the bank shows it.", independent: false },
  { key: "bankLines", title: "Bank line", from: "Your bank statement or feed", what: "The payout arriving in your account. The batch ties only when gross − fees − refunds = net = this line, to the cent.", independent: true },
] as const;

export default async function OverviewPage() {
  const { ctx, shell } = await merchantMember();
  const [c, fresh] = await Promise.all([overviewCounts(ctx), sourceFreshness(ctx)]);
  const demo = demoBuild() && shell.dataMode === "demo";
  const evaluated = Object.values(c.decisions).reduce((a, x) => a + (x ?? 0), 0);
  return (
    <>
      <div className={m.titleRow}><h1 className={s.title}>How Clearline works</h1><LiveRefresh /></div>
      <p className={s.lede}>Every stablecoin payment leaves five records in five places. Clearline puts them side by side for each payment, explains every difference in plain English, and asks a person only where the records disagree. It is read-only: it never holds, sends or converts money.</p>
      <FreshnessStrip provider={fresh.provider} bank={fresh.bank} chain={dataAsOf(shell.entities)} />
      {can(ctx.role, "merchant_upload") ? <p><a className={m.cta} href="/control/merchant/uploads" data-testid="overview-upload-files">Upload files</a> <a href="/control/merchant/getting-started">How to get started</a></p> : null}

      <section className={s.section} aria-labelledby="flow-h">
        <h2 className={s.h2} id="flow-h">The five records of one payment</h2>
        <ol className={m.flow} data-testid="overview-flow">
          {STEPS.map((x, i) => (
            <li className={m.flowStep} key={x.key}>
              <p className={m.flowNum} aria-hidden="true">{i + 1}</p>
              <h3 className={m.flowTitle}>{x.title}</h3>
              <p className={s.small}><strong>From:</strong> {x.from}</p>
              <p className={s.small}>{x.what}</p>
              <p className={s.small}><span className={m.flowCount}>{n(c[x.key])}</span> {x.independent ? "on file · independent evidence" : "on file · not independent"}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={s.section} aria-labelledby="decide-h">
        <h2 className={s.h2} id="decide-h">What Clearline decides</h2>
        <div className={s.panel}>
          <p>An amount alone never closes a match. Each payment gets one of four results, with the rule that decided it; the person who prepares a write-off or a resolution never approves it.</p>
          <ul className={m.decisions}>
            {(["matched", "matched_with_difference", "suggested_for_review", "exception"] as const).map((d) => (
              <li key={d}><DecisionChip decision={d} /> <span className={m.flowCount}>{n(c.decisions[d] ?? 0)}</span>{evaluated ? <span className={s.small}> of {n(evaluated)} evaluated</span> : null}</li>
            ))}
          </ul>
          <ul className={m.decisions} aria-label="Bank evidence, shown apart from the decisions" data-testid="overview-evidence">
            {(["none", "imported_two_person_confirmed"] as const).map((lvl) => (
              <li key={lvl}><EvidenceChip level={lvl} label={BANK_EVIDENCE_SHORT[lvl]} /> <span className={m.flowCount}>{n(c.bankEvidence[lvl] ?? 0)}</span></li>
            ))}
          </ul>
          <p className={s.small}>Bank evidence is shown apart from the match: a payment is matched by its chain, provider and invoice records; nothing is bank-authenticated yet. Every exception has an owner, a reason and a next step.</p>
        </div>
      </section>

      <section className={s.section} aria-labelledby="start-h">
        <h2 className={s.h2} id="start-h">{demo ? "The demo" : "Start here"}</h2>
        {demo ? (
          <div className={s.panel}>
            <p>Northwind Travel (demo) takes stablecoin payments through Provider P (demo) in Singapore (SGD and a USD account) and the UAE (AED). The data covers the 30 days to {DEMO_LAST_DAY}; the demo&rsquo;s today is {DEMO_TODAY}, and its files are on the Uploads page. Everything is fictional.</p>
            <ol className={`${s.small} ${m.journey}`}>
              <li>The <a href={`/control/merchant?date=${DEMO_LAST_DAY}`}>daily report</a> for yesterday, then the <a href="/control/merchant/payments">payments</a>.</li>
              <li>One payment end to end: <a href="/control/merchant/payments/BK-24823">BK-24823</a>, and its <a href="/control/merchant/exceptions/EX-BK-24823">exception</a>.</li>
              <li>A batch bridge: <a href="/control/merchant/batches/B-1125-SGD">B-1125-SGD</a>, from the merchant&rsquo;s day to the bank credit.</li>
              <li>A partial payment across two chains: <a href="/control/merchant/payments/BK-25102">BK-25102</a>.</li>
              <li><a href="/control/merchant/month-end">Month-end</a>, the <a href="/control/merchant/accounting">accounting export</a> and the <a href="/control/merchant/evidence">evidence packs</a>.</li>
              <li>Today&rsquo;s files on <a href="/control/merchant/uploads">Uploads</a>, then reconcile.</li>
            </ol>
            <p><a className={m.cta} href={`/control/merchant?date=${DEMO_LAST_DAY}`} data-testid="start-demo">Start demo</a></p>
          </div>
        ) : (
          <p><a className={m.cta} href="/control/merchant" data-testid="start-demo">Open the daily report</a></p>
        )}
      </section>
    </>
  );
}
