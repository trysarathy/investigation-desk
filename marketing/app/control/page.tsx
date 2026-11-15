import Link from "next/link";
import { ButtonLink, ContactBand, ExtLink, PageHero, Section, Stage } from "@/components/Shared";
import { AmountDifferenceTable, ExceptionsTable, FundingTable, LiquidityTable, ReconTable, TableWrap } from "@/components/Tables";
import InvestigationView from "@/components/InvestigationView";
import { FUNDING_DESK_URL, SOFTWARE_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Control",
  "Clearline Control: investigation, reconciliation, exceptions, the Accounting Bridge, audit history, liquidity, holds and the Funding Desk workflow on one payment record. Test-mode console on fictional data.",
  "/control",
);

/** ACCOUNTING_BRIDGE.md §2 on rc4/clearline-app @ dc4d39a (final rc4): sandbox posting rules, pending founder sign-off, fictional data. Account roles, not codes. */
const BRIDGE_RULES: [string, string, string, string, string][] = [
  ["JR_SUPPLIER_PAYOUT_DEBIT", "A bank debit for a delivered fiat payout, matched by its provider payment id", "Supplier payable", "Bank", "Yes, by bank debit evidence"],
  ["JR_ADVANCE_DISBURSED", "The same debit, for a payout funded by a treasury-approved advance", "Customer receivable", "Bank", "Yes, by bank debit evidence"],
  ["JR_PAYOUT_DEBIT_NOT_DELIVERED", "The same debit when the payout was returned, failed, cancelled, expired or held", "Provider clearing", "Bank", "No"],
  ["JR_PAYOUT_RETURN_CREDIT", "A return credit confirmed on the statement", "Bank", "Provider clearing", "No"],
  ["JR_REPAYMENT_BY_REFERENCE", "A customer repayment allocated by its repayment reference", "Bank", "Customer receivable", "No"],
  ["JR_STABLECOIN_ONRAMP_FUNDING", "A bank debit funding a stablecoin-route payout (the on-ramp)", "Stablecoin clearing", "Bank", "No: only the final chain transfer clears the payable"],
  ["JR_STABLECOIN_FINAL_TRANSFER", "A final chain transfer to the beneficiary's wallet, matched by the provider-reported transaction hash", "Supplier payable", "Stablecoin clearing", "Yes, by chain evidence"],
  ["JR_REVERSAL", "An exported or posted entry whose evidence changed, or an exported entry a second approver withdrew", "The original's credits", "The original's debits", "No"],
];
/** The console's caveat on every Accounting tab and export (src/components/clearline/accounting.tsx RULES_NOTE). */
const RULES_CAVEAT = "Sandbox posting rules, pending founder sign-off — review with your accountant before using this file.";
const NEVER: [string, string][] = [
  ["NP_PROVIDER_COMPLETION_ONLY", "a provider's completion report with no bank or final chain evidence"],
  ["NP_AMOUNT_ONLY_MATCH", "a receipt that matches only by amount"],
  ["NP_CHAIN_NOT_FINAL", "a chain transfer below the finality threshold"],
  ["NP_FEE_NOT_EVIDENCED", "indicative quote fees"],
  ["NP_FX_NOT_EVIDENCED", "an FX difference the engine has no rate evidence for, including the conversion between the funding currency and USDC on the stablecoin route"],
  ["NP_EVIDENCE_CONTRADICTED", "a bank debit or final chain transfer matched while a provider-status contradiction is open: it stays contradicted"],
];

function TableWrapBridge() {
  return (
    <TableWrap label="Sandbox posting rules" caption={"Account roles, not account codes: your mapping supplies the codes. Amounts are exact, in the currency of the evidence. The console marks every Accounting tab and export: \u201c" + RULES_CAVEAT + "\u201d"}>
      <thead><tr><th scope="col">Rule</th><th scope="col">Evidence</th><th scope="col">Debit</th><th scope="col">Credit</th><th scope="col">Shows the supplier as paid?</th></tr></thead>
      <tbody>{BRIDGE_RULES.map(([r, e, d, c, paid]) => <tr key={r}><td className="mono">{r}</td><td>{e}</td><td>{d}</td><td>{c}</td><td>{paid}</td></tr>)}</tbody>
    </TableWrap>
  );
}

export default function Control() {
  return (
    <main id="main">
      <PageHero eyebrow="Clearline Control" title={<>Understand what happened <em>after submission.</em></>}
        stages={["synthetic", "none"]}
        actions={<><ButtonLink href={SOFTWARE_URL} main>Open Control in test mode</ButtonLink><ButtonLink href="/use-cases" variant="secondary">See the use cases</ButtonLink></>}>
        <p>Control is the operations side: it follows each payment after it leaves, separates what was reported from what can be shown, and turns disagreements into exceptions in a queue, where a person assigns each owner.</p>
      </PageHero>

      <Section tone="white" eyebrow="Investigation" title="A timeline with sources, not a status badge"
        intro={<p>Every event shows its provenance and what the engine did with it. The investigation view separates what the provider reported from independent evidence, lists what is still unknown, and names who acts next.</p>}>
        <InvestigationView initial="s3_hold" />
      </Section>

      <Section eyebrow="Reconciliation" title="Match by reference. Never by amount alone."
        intro={<p>A statement line is allocated automatically only on a trusted reference (the provider payment id for payouts, the repayment reference for repayments) plus amount, currency and a value-date window. Amount-only, ambiguous, duplicate, currency-mismatched or out-of-window lines become exceptions with an explanation code. A full bank-statement match sets settlement verified (scope bank_statement); it shows the payout left the account, not that the beneficiary was credited. A provider-reported return makes reconciliation an exception at once. A matching return line on the statement confirms it (returnStatus confirmed_by_statement), but the exception stays open until a person resolves it, because the supplier is still unpaid. While the return is open, any bank debit for the payout is contradicted settlement evidence. The investigation also states the return position, keeping two facts apart: net movement is zero only when the outgoing debit and an equal return credit are both on the statement, and the beneficiary is never treated as paid. In the sample return both legs are on the statement: &ldquo;The debit and the return credit (USD 12,784.90 each) net to zero on the statement. The beneficiary was not paid.&rdquo; A case cannot be closed while the payment is not yet evidenced or an advance repayment is still outstanding.</p>}>
        <ReconTable />
        <h3 className="h3" style={{ margin: "40px 0 12px" }} id="amount-differences">Short amounts and reports that contradict the payout</h3>
        <div className="prose" style={{ marginBottom: 16 }}>
          <p>A bank line with the trusted reference but less than the amount is allocated as partial: reconciliation is partially matched, settlement stays observed, and the remainder stays outstanding (<code className="inline">RC_PARTIAL_AMOUNT</code>).</p>
          <p>A provider settlement report below the payout amount is not treated as settlement in full. It raises an <code className="inline">unmatched_reconciliation</code> exception (<code className="inline">RC_UNDER_AMOUNT_REPORT</code>), reconciliation becomes an exception, and settlement is not upgraded. Both cases carry a structured difference: expected, reported, difference, currency, source and the required next action.</p>
          <p>A provider settlement report on a payout that is failed, cancelled, expired or returned is a contradiction, not evidence. It raises <code className="inline">contradictory_evidence</code> (<code className="inline">RC_REPORT_ON_TERMINAL_PAYOUT</code>), reconciliation becomes an exception, and settlement is left unchanged.</p>
        </div>
        <AmountDifferenceTable />
        <h3 className="h3" style={{ margin: "40px 0 12px" }}>Exceptions, due dates and owners</h3>
        <p className="prose" style={{ marginBottom: 16 }}>The engine creates every exception with a due date: an explicit date, or the creation date plus 1 day (critical, high), 3 days (medium) or 5 days (low). It creates them unassigned. A person assigns the owner in the console, and an exception cannot be resolved without one. In the sample, two of the four open exceptions have been assigned; two are still unassigned.</p>
        <ExceptionsTable />
      </Section>

      <Section id="accounting-bridge" tone="white" eyebrow="Accounting Bridge · Control › Accounting" title={<>From evidence <em>to a proposed journal entry.</em></>}
        intro={<p>The last step of a payment&rsquo;s lifecycle is its accounting outcome. The Accounting Bridge proposes balanced double-entry journal entries from the evidence Control has recorded, under sandbox posting rules, and exports them as a file for your accountant. It is not a ledger and it posts nothing: &ldquo;posted&rdquo; is recorded only when a person types the reference from their own ledger.</p>}>
        <div className="grid-2">
          <ul className="bullets">
            <li>Entries come only from independent evidence: a bank statement line matched by trusted reference, or a final chain transfer. Each line names its rule and its evidence.</li>
            <li>Every entry is balanced, in one currency. No FX, fee or tax line is invented.</li>
            <li>A second person approves; the person who proposed an entry cannot (maker &ne; checker). Withdrawing an exported entry, or confirming it was never imported, needs an approver other than the person who exported it.</li>
            <li>Accounts map to your chart of accounts by posting role. An unmapped role blocks the export, and a mapping change that alters an approved entry&rsquo;s codes sends it back for approval.</li>
          </ul>
          <ul className="bullets">
            <li>Accounting periods are open or closed. A late item is moved to the next open period and flagged, never silently re-dated.</li>
            <li>Each approved entry is exported once. The journal export and an accounting-ready reconciliation export (CSV or JSON, marked fictional) carry an id derived from their content.</li>
            <li>A returned payout never shows the supplier as paid. On the stablecoin route, the bank debit only funds the on-ramp; the payable clears on the final chain transfer. If evidence changes after an export, a reversal is proposed, unless a second approver confirms the file was never imported.</li>
            <li>Every action is in the audit history, for the workspace and for each payment.</li>
          </ul>
        </div>
        <div style={{ marginTop: 32 }}><TableWrapBridge /></div>
        <p className="label" style={{ marginTop: 32 }}>Never proposed</p>
        <ul className="bullets">{NEVER.map(([c, t]) => <li key={c}>{t} <code className="inline">{c}</code></li>)}</ul>
        <p className="caption" style={{ marginTop: 16 }}>Sandbox posting rules, applied to fictional data and pending founder sign-off. No accounting system is connected; a ledger adapter is planned, not built.</p>
        <div className="stage-row"><Stage kind="synthetic" /><Stage kind="none" /></div>
      </Section>

      <Section tone="canvas" eyebrow="Liquidity" title="Usable balance, net of what is not yours to spend"
        intro={<p>Restricted and safeguarded amounts, committed payouts and a policy buffer are subtracted before anything is shown as usable. Stale snapshots are flagged and left out. The classifications follow an illustrative, provider-defined policy, not a regulatory one.</p>}>
        <LiquidityTable />
      </Section>

      <Section tone="white" eyebrow="Compliance holds" title="Owners, not automated decisions">
        <div className="prose">
          <p>When a provider holds a payout and asks for documents, Control records the request, assigns a compliance reviewer and records their decision. No provider event moves a held payout on its own: it is released only after the partner reports the release and the assigned reviewer records a release decision, or it ends when the reviewer rejects. Clearline makes no compliance decision.</p>
          <div className="stage-row"><Stage kind="synthetic" /></div>
        </div>
      </Section>

      <Section id="funding-desk" tone="canvas" eyebrow="Funding Desk · a specialist workflow in Control" title={<>When a provider pays before <em>its customer repays.</em></>}
        intro={<p>Some providers pay a supplier before their customer repays them. The Funding Desk is Control&rsquo;s workflow for that exposure, not a separate product: the advance, a treasury decision by a second person (maker &ne; checker), the repayment obligation and its allocations, tied to the supplier payout that Connect sent.</p>}>
        <div className="grid-2">
          <div className="prose">
            <p className="label">In the sandbox engine</p>
            <p>The supplier payout is linked to the advance, treasury approval and repayment through a tested projection. It is a projection over the sandbox workspace, not a shared production ledger. Repayments are allocated only by repayment reference; an unreferenced receipt stays an exception even when the amount matches.</p>
            <div className="stage-row"><Stage kind="synthetic" /></div>
          </div>
          <div className="prose">
            <p className="label">In the interactive demo</p>
            <p>The Funding Desk demo walks a fictional advance through review, treasury approval, supplier payout and a repayment exception. It is a separate, interactive prototype; the provider makes every credit decision, and Clearline does not lend or supply capital.</p>
            <div className="stage-row"><Stage kind="prototype" /></div>
            <p><ExtLink href={FUNDING_DESK_URL}>Open the Funding Desk demo</ExtLink></p>
          </div>
        </div>
        <div style={{ marginTop: 32 }}><FundingTable /></div>
        <p style={{ marginTop: 24 }}><Link className="text-link" href="/use-cases#funding">Worked funding example</Link></p>
      </Section>

      <ContactBand />
    </main>
  );
}
