import { ButtonLink, ContactBand, PageHero, Section, Stage, type StageKind } from "@/components/Shared";
import { ExecStatus, ReconStatus, SettlementStatus } from "@/components/Status";
import { SAMPLE_PAYMENTS } from "@/lib/sample";
import { FundingTable, QuotesTable, ReconTable } from "@/components/Tables";
import { TRIAL_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";
import type { ReactNode } from "react";

export const metadata = pageMeta(
  "Use cases",
  "Four fictional worked examples: payment investigation, settlement reconciliation, provider orchestration and funding exposure. Illustrations of the workflow, not validated customer outcomes.",
  "/use-cases",
);

function UseCase({ id, n, title, situation, shows, limits, stages, children, tone }: {
  id: string; n: string; title: string; situation: string; shows: string[]; limits: string; stages: StageKind[]; children?: ReactNode; tone: "white" | "canvas";
}) {
  return (
    <Section id={id} tone={tone} eyebrow={n + " · Fictional example"} title={title}>
      <div className="grid-2">
        <div className="prose">
          <p className="label">Situation</p>
          <p>{situation}</p>
          <p className="label" style={{ marginTop: 20 }}>What it does not do</p>
          <p>{limits}</p>
          <div className="stage-row">{stages.map(s => <Stage key={s} kind={s} />)}</div>
        </div>
        <div className="prose">
          <p className="label">What Clearline shows</p>
          <ul className="bullets">{shows.map(s => <li key={s}>{s}</li>)}</ul>
        </div>
      </div>
      <div style={{ marginTop: 32 }}>{children}</div>
    </Section>
  );
}

export default function UseCases() {
  return (
    <main id="main">
      <PageHero eyebrow="Use cases" title={<>Four workflows. <em>Fictional examples.</em></>}
        actions={<><ButtonLink href={TRIAL_URL} main>Walk through them in the sandbox</ButtonLink><ButtonLink href="/contact" variant="secondary">Tell us which one costs you time</ButtonLink></>}>
        <p>Each example uses the sandbox&rsquo;s fictional providers and records. They show how the workflow is meant to work. They are not customer results, and Clearline has no customers yet.</p>
      </PageHero>

      <UseCase id="investigation" n="01" tone="white" title="Payment investigation"
        situation="A USD 12,784.90 payout to Redwood Supplies Ltd (INV-2026-141) via Northline Payments comes back. Operations needs to know why, what is proven, and who fixes it. (Engine scenario s2_returned.)"
        shows={["Each provider event with its provenance and what the engine did with it: accepted, in transit, returned. The return makes reconciliation an exception straight away, and the earlier bank debit becomes contradicted settlement evidence.", "The outgoing debit and the return credit on the bank statement, each allocated by the trusted reference. returnStatus becomes confirmed_by_statement and the return position is RT_NET_ZERO: net movement zero, beneficiary not paid. The exception stays open, due within one day.", "Who acts (the exception owner, assigned by a person) and the next action: verify beneficiary details with the supplier, confirm the returned funds, then create a correction intent."]}
        limits="It does not correct beneficiary details or reissue the payment. A person creates the correction intent."
        stages={["synthetic"]}>
        <div className="panel">
          <p className="label">s2_returned · INV-2026-141</p>
          <p><ExecStatus state="returned" /> <SettlementStatus state="contradicted" scope="bank_statement" /> <ReconStatus state="exception" /> <span className="caption mono">returnStatus: confirmed_by_statement</span></p>
          <ol className="timeline">
            {SAMPLE_PAYMENTS[1].events.map(e => <li key={e.time}><span className="timeline-time mono">{e.time}</span><div><b>{e.label}</b><span className="caption">{e.source} · {e.outcome}</span></div></li>)}
          </ol>
          <p className="caption">{SAMPLE_PAYMENTS[1].whoActs}</p>
        </div>
      </UseCase>

      <UseCase id="reconciliation" n="02" tone="canvas" title="Settlement reconciliation"
        situation="Six fictional bank-statement lines arrive. Finance needs to know which payments and repayments they belong to, and which it cannot attribute."
        shows={["Payout debits allocated on the provider payment id, amount, currency and value-date window. Settlement becomes verified with scope bank_statement; the beneficiary's credit is still listed as unknown.", "A partial repayment allocated by its repayment reference, with the remainder left outstanding.", "An SGD 20,000.00 credit with no reference becomes an exception, even though the amount matches what is owed.", "If a provider settlement report showed less than the payout, it would become an exception (RC_UNDER_AMOUNT_REPORT) with the expected, reported and difference amounts and a required next action; a report on a failed or returned payout is treated as a contradiction (RC_REPORT_ON_TERMINAL_PAYOUT)."]}
        limits="It does not post entries to a ledger or accounting system in this sandbox."
        stages={["synthetic"]}>
        <ReconTable />
      </UseCase>

      <UseCase id="orchestration" n="03" tone="white" title="Provider orchestration"
        situation="An SGD 24,651.37 supplier payment to the Philippines (INV-2026-126) could take several routes. Operations chooses one; a different person approves it. (Engine scenario s1_success.)"
        shows={["Every route quoted, including ineligible ones with the reason.", "Choosing a route creates an instruction; approval must come from a different person (maker ≠ checker).", "One execution model whichever provider is chosen, with provider events applied, deduplicated or rejected."]}
        limits="Quotes are indicative and not executable. No real provider receives the instruction."
        stages={["synthetic", "none"]}>
        <QuotesTable />
      </UseCase>

      <UseCase id="funding" n="04" tone="canvas" title="Funding exposure (Funding Desk)"
        situation="A provider pays a supplier SGD 50,000.00 before its customer, Seabright Trading, repays. Treasury needs the decision recorded and the outstanding amount tracked. (Engine scenario s5_funding.)"
        shows={["The supplier payout linked to the advance, the treasury approval (maker ≠ checker), the repayment obligation and its allocations.", "SGD 30,000.00 repaid by reference; SGD 20,000.00 outstanding.", "An unreferenced SGD 20,000.00 receipt kept as an exception rather than allocated by amount."]}
        limits="This is a tested projection over the sandbox workspace, not a shared production ledger. Clearline does not lend, supply capital or make credit decisions. The Funding Desk demo, linked from the Control page, shows the same workflow interactively."
        stages={["synthetic"]}>
        <FundingTable />
      </UseCase>

      <ContactBand title="Which of these does your team handle by hand?" />
    </main>
  );
}
