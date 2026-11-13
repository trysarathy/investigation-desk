"use client";
import Link from "../Link";
import { useState } from "react";
import { MARKETING_URL, CONTACT_MAILTO } from "../nav";
import { useWorkspace } from "../workspace";
import { Btn, LinkBtn, Notice, Panel, Status, ui } from "../ui";

type Case = { n: string; title: string; area: string; href: string; start: string; action: string[]; expect: string[]; limits: string };

const CASES: Case[] = [
  {
    n: "01", title: "Successful payment", area: "Workspace · Investigation", href: "/clearline/payments/pi_s1_success",
    start: "A supplier payout the sandbox provider reports as completed, plus a separate bank statement line.",
    action: ["Open the payment.", "Read the three status dimensions in the header.", "In the evidence timeline, find the provider event and the statement line, each with its source."],
    expect: ["Execution says the provider reports completion — not “payment successful”.", "Settlement evidence comes from the bank statement line, matched by trusted reference (code RC_EXACT_REFERENCE_AMOUNT_CURRENCY_WINDOW).", "Reconciliation is shown separately as matched."],
    limits: "The statement line is fictional; no bank is connected.",
  },
  {
    n: "02", title: "Returned payout", area: "Investigation · Exceptions", href: "/clearline/payments/pi_s2_returned",
    start: "The beneficiary's bank rejected the payout; the provider reported a return and a return line arrived on the statement.",
    action: ["Open the payment and read the explanation panel.", "In the case section, assign an owner and add a note.", "Try to resolve the case or its exception."],
    expect: ["The explanation names what is known, what is not yet known, and what is still financially outstanding.", "Resolve is refused until the engine's conditions are met, and the reason is shown.", "Every action appears in the case history and the audit log."],
    limits: "Beneficiary details are opaque test references; no real account is checked.",
  },
  {
    n: "03", title: "Compliance hold", area: "Control · Compliance holds", href: "/clearline/control/holds",
    start: "The partner placed the payout on hold and asked for supporting documents.",
    action: ["Submit the requested document names (metadata only).", "Assign the compliance reviewer.", "Switch “Acting as” to Priya (compliance) and record a decision with a reason."],
    expect: ["There is no release button; Clearline only records the reviewer's decision.", "A decision by anyone other than the assigned reviewer is refused with the reason.", "The hold never releases on a timer or a provider event alone."],
    limits: "Clearline makes no compliance decision; the partner and your reviewer do.",
  },
  {
    n: "04", title: "Base Sepolia finality delay", area: "Investigation · Chain evidence", href: "/clearline/payments/pi_s4_chain",
    start: "A testnet USDC transfer has been observed on Base Sepolia but does not yet have enough confirmations.",
    action: ["Open the payment and read the chain evidence panel.", "Use “Simulate next provider event” to deliver more confirmations.", "Watch settlement evidence move from pending finality towards verified."],
    expect: ["Settlement evidence is pending finality until the confirmation threshold is reached.", "The scope says on-chain transfer — it never claims a bank credit.", "Only the allow-listed testnet token on chain 84532 is accepted."],
    limits: "Synthetic testnet observations; no live chain lookup in this console.",
  },
  {
    n: "05", title: "Funding exposure", area: "Control · Funding exposure", href: "/clearline/control/funding",
    start: "The provider advanced SGD 50,000.00 to pay a supplier before its customer reimbursed it.",
    action: ["Open Funding exposure.", "Check principal, repaid and outstanding, with the due date and repayment evidence.", "Follow the exception for the receipt that quoted no reference."],
    expect: ["SGD 50,000.00 advanced → SGD 30,000.00 repaid by reference → SGD 20,000.00 outstanding.", "An unreferenced SGD 20,000.00 receipt is an exception, not a close — even though the amount equals what is owed.", "The supplier payout links to its own investigation page."],
    limits: "A projection, not a shared ledger. The provider makes every credit decision; Clearline lends nothing.",
  },
];

export default function Trial() {
  const { reset } = useWorkspace();
  const [msg, setMsg] = useState<{ text: string } | null>(null);
  const doReset = () => { reset("sample"); setMsg({ text: "Workspace reset to the sample. All five cases are back at their starting state." }); };
  return (
    <>
      <div className={ui.pageHead}>
        <div>
          <p className={ui.eyebrow}>Guided trial · about 15 minutes</p>
          <h1>Follow five payments from instruction to evidence.</h1>
          <p className={ui.lede}>Clearline shows payment providers what happened to each payout, what evidence supports it, and who must act next. Everything here is fictional test data in your browser.</p>
        </div>
        <div className={ui.actions}>
          <LinkBtn href="/clearline" kind="primary">Open the console</LinkBtn>
          <Btn onClick={doReset}>Reset all cases</Btn>
        </div>
      </div>
      <Status msg={msg} />

      <Panel title="The product in one minute" id="overview">
        <div className={ui.panelBody}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Connect</strong> — create a payment intent, compare indicative sandbox routes, approve with two different people, submit, and receive provider events (including timeouts, duplicates, late and contradictory ones).</li>
            <li><strong>Investigate</strong> — each payment keeps three separate states: what the provider reports, what settlement evidence exists, and whether it reconciles. A provider saying “completed” is never shown as “payment successful”.</li>
            <li><strong>Control</strong> — reconcile statement lines by trusted reference, work exceptions with owners and due dates, see usable liquidity under a provider-defined policy, record compliance reviewer decisions, and track funding advances until repaid.</li>
          </ul>
        </div>
      </Panel>

      {CASES.map((c) => (
        <Panel key={c.n} id={`case-${c.n}`} title={<>{c.n} / 05 · {c.title}</>} actions={<span className={ui.hint}>{c.area}</span>}>
          <div className={ui.panelBody}>
            <div className={ui.grid3}>
              <div><h3 className={ui.eyebrow}>Starting state</h3><p style={{ margin: 0 }}>{c.start}</p></div>
              <div><h3 className={ui.eyebrow}>What you do</h3><ol style={{ margin: 0, paddingLeft: 18 }}>{c.action.map((a) => <li key={a}>{a}</li>)}</ol></div>
              <div><h3 className={ui.eyebrow}>Expected system response</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{c.expect.map((a) => <li key={a}>{a}</li>)}</ul></div>
            </div>
            <p className={ui.hint}><strong>Limitation:</strong> {c.limits}</p>
            <div className={ui.actions}>
              <LinkBtn href={c.href} kind="primary">Start case {c.n}: {c.title}</LinkBtn>
              <Btn size="small" onClick={doReset}>Reset to starting state</Btn>
            </div>
          </div>
        </Panel>
      ))}

      <Panel title="Try your own payment" id="connect">
        <div className={ui.panelBody}>
          <p style={{ marginTop: 0 }}>Create an intent, request quotes, approve as a different person, submit, then simulate the provider&apos;s next event with or without an injected failure. You land on the same payment&apos;s investigation page.</p>
          <LinkBtn href="/clearline/connect">Open Connect</LinkBtn>
        </div>
      </Panel>

      <Panel title="Funding Desk and the console" id="funding-desk">
        <div className={ui.panelBody}>
          <p style={{ marginTop: 0 }}>The console&apos;s Funding exposure page is a <strong>projection</strong> from the same engine: it links each advance to the supplier payout it funded, the maker–checker treasury approval, the repayment obligation and the statement lines allocated to it by reference, and computes what is still outstanding. It is not a shared production ledger. The original, more detailed Funding Desk prototype is still available separately.</p>
          <LinkBtn href="/mentor-demo">Open Funding Desk prototype</LinkBtn>
        </div>
      </Panel>

      <Panel title="Honest limitations" id="limitations">
        <div className={ui.panelBody}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>No licensed provider, bank or chain is connected. Providers, quotes, webhooks, balances and statements are simulated.</li>
            <li>State lives in this browser only; there is no server persistence, multi-user access or login. Simulated roles stand in for people.</li>
            <li>Quotes are indicative and never executable. Clearline does not move or hold funds, lend, or make compliance decisions.</li>
            <li>Not production infrastructure: no SSO, webhook delivery or retries, real settlement attestations or security review yet.</li>
          </ul>
          <Notice>Please do not enter real customer names, bank details, credentials or wallet keys.</Notice>
        </div>
      </Panel>

      <Panel title="Tell us what you found" id="feedback">
        <div className={ui.panelBody}>
          <ol style={{ marginTop: 0, paddingLeft: 18 }}>
            <li>Which of these exceptions happens most often in your team?</li>
            <li>Who owns it today, and what system do they use?</li>
            <li>Who would budget to fix it?</li>
          </ol>
          <div className={ui.actions}>
            <a className={`${ui.btn}`} href={CONTACT_MAILTO}>Email feedback</a>
            <a className={`${ui.btn} ${ui.ghost}`} href={MARKETING_URL}>← Back to the Clearline website</a>
            <Link className={`${ui.btn} ${ui.ghost}`} href="/clearline/docs">Developer API reference</Link>
          </div>
        </div>
      </Panel>
    </>
  );
}
