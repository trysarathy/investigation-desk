import { ButtonLink, ContactBand, PageHero, Section, Stage, type StageKind } from "@/components/Shared";
import { ExecStatus, EvidenceStatus, ReconStatus } from "@/components/Status";
import { QuotesTable, ReconTable } from "@/components/Tables";
import { TRIAL_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";
import type { ReactNode } from "react";

export const metadata = pageMeta(
  "Use cases",
  "Four fictional worked examples: payment investigation, settlement reconciliation, provider orchestration and funding exposure. Illustrations of the workflow, not validated customer outcomes.",
  "/use-cases",
);

function UseCase({ id, n, title, situation, shows, limits, stages, children, tone }: {
  id: string; n: string; title: string; situation: string; shows: string[]; limits: string; stages: StageKind[]; children?: ReactNode; tone: "white" | "ivory";
}) {
  return (
    <Section id={id} tone={tone} eyebrow={n + " · Fictional example"} title={title}>
      <div className="split">
        <div className="prose">
          <p className="label">Situation</p>
          <p>{situation}</p>
          <p className="label" style={{ marginTop: 20 }}>What Clearline shows</p>
          <ul className="bullets">{shows.map(s => <li key={s}>{s}</li>)}</ul>
          <p className="label" style={{ marginTop: 20 }}>What it does not do</p>
          <p>{limits}</p>
          <div className="stage-row">{stages.map(s => <Stage key={s} kind={s} />)}</div>
        </div>
        <div>{children}</div>
      </div>
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
        situation="A USD 12,784.90 payout to Redwood Supplies Ltd (INV-2026-141) via Harbour FX comes back. Operations needs to know why, and who fixes it."
        shows={["The full timeline with each event's source: created, priced, approved, submitted, in transit, returned.", "The provider's reason: beneficiary account details rejected.", "A plain-English explanation and the next action: check beneficiary details before reissuing."]}
        limits="It does not correct beneficiary details or reissue the payment. A person decides."
        stages={["illustrative", "synthetic"]}>
        <div className="panel">
          <p className="label">pi_3p6x92wa · INV-2026-141</p>
          <p><ExecStatus state="returned" /> <EvidenceStatus state="none" /> <ReconStatus state="unreconciled" /></p>
          <ol className="timeline">
            <li><span className="timeline-time mono">17:13 SGT</span><div><b>Instruction sent to sandbox partner</b><span className="caption">Sandbox provider · partner-reported</span></div></li>
            <li><span className="timeline-time mono">17:22 SGT</span><div><b>Partner reports payout in progress</b><span className="caption">Sandbox provider · partner-reported</span></div></li>
            <li><span className="timeline-time mono">17:31 SGT</span><div><b>Returned: beneficiary account details rejected</b><span className="caption">Sandbox provider · partner-reported</span></div></li>
          </ol>
        </div>
      </UseCase>

      <UseCase id="reconciliation" n="02" tone="ivory" title="Settlement reconciliation"
        situation="Two lines arrive from fictional provider files: a Northline settlement export and a Harbour statement. Finance needs to know which payments they belong to."
        shows={["INV-2026-126 matches on reference, payment ID, currency and amount, and is still labelled unverified.", "INV-2026-008 (SGD 148.93) has no matching payment, so it becomes an exception instead of being force-matched by amount.", "Reconciled status is reserved for payments with independent settlement evidence."]}
        limits="It does not post entries to a ledger or accounting system in this sandbox."
        stages={["synthetic", "illustrative"]}>
        <ReconTable />
      </UseCase>

      <UseCase id="orchestration" n="03" tone="white" title="Provider orchestration"
        situation="A SGD 48,215.37 supplier payment to the Philippines (INV-2026-137) can go three ways. Treasury wants to see the options and record who chose."
        shows={["Three eligible sandbox routes with rate, fee and ETA, and one excluded route with its reason.", "The approval recorded as an event before submission.", "One state model whichever provider is chosen."]}
        limits="Quotes are fixed illustrations, not executable offers. No real provider receives the instruction."
        stages={["synthetic", "none"]}>
        <QuotesTable />
      </UseCase>

      <UseCase id="funding" n="04" tone="ivory" title="Funding exposure"
        situation="A provider pays an overseas supplier SGD 48,215.37 (ADV-2026-153) before its own customer repays. Treasury needs the checks prepared and the outstanding amount tracked."
        shows={["Five prepared checks: invoice not previously funded, customer within recorded limit, earlier overdue advances, terms recorded, genuinely free cash.", "A maker-checker treasury decision recorded by a person.", "What remains owed, and repayments matched by exact reference."]}
        limits="Clearline does not lend, supply capital or make credit decisions. The Funding Desk is a separate prototype, not yet linked to Connect payment IDs."
        stages={["illustrative"]}>
        <div className="panel">
          <p className="label">Advance review · ADV-2026-153 · illustrative</p>
          <p className="num" style={{ fontSize: 28 }}>SGD 48,215.37</p>
          <p><span className="st-exec tone-warning">awaiting treasury</span></p>
          <ol className="list-rows">
            {["Invoice not previously funded", "Customer within recorded limit", "Earlier overdue advances", "Terms recorded", "Genuinely free cash"].map((c, i) => <li key={c}><span className="idx">{String(i + 1).padStart(2, "0")}</span><p>{c}</p></li>)}
          </ol>
          <p className="caption">Clearline prepares. Treasury decides.</p>
        </div>
      </UseCase>

      <ContactBand title="Which of these does your team handle by hand?" />
    </main>
  );
}
