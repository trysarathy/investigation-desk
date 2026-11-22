import type { Metadata } from "next";
import { describeStatus, type InvestigationCase, type ReconciliationException } from "@/lib/clearline";
import { can } from "@/server/authz";
import { paymentDetail } from "@/server/control";
import { orNotFound, pageContext } from "@/server/control-page";
import s from "@/components/control/control.module.css";
import { AssignToMe, CaseDetailsForm, DecisionForm, EvidenceForm, FlashMessage, NoteForm, ResolutionForm } from "@/components/control/forms";
import {
  caseStatusLabel, categoryLabel, evidenceClass, evidenceKindLabel, exceptionStatusLabel, executionTone, money, priorityLabel,
  reconciliationTone, settlementTone, severityLabel, Tag, timelineKindLabel, when,
} from "@/components/control/ui";

export const metadata: Metadata = { title: "Payment" };

type CaseView = InvestigationCase & { priority: string; nextAction: string | null; dueDate: string | null };
type Payload = { target: { kind: string; id: string }; note: string; evidenceRefs: string[]; version: number };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const d = await orNotFound(paymentDetail(ctx, id));
  const v = d.view;
  const st = describeStatus(v.status);
  const name = (actorId?: string | null) => (actorId ? d.actorNames[actorId] ?? "A former member" : null);
  const cases = d.cases as unknown as CaseView[];
  const evidenceChoices = d.evidence.map((e) => ({
    id: e.id,
    label: `${evidenceKindLabel(e.kind)}${e.reference ? ` · ${e.reference}` : ""} — ${e.description} (${e.independent ? "independent evidence" : "not independent"})`,
  }));
  const mayInvestigate = can(ctx.role, "investigate");
  const mayRequest = can(ctx.role, "request_approval");
  const mayDecide = can(ctx.role, "decide_approval");
  const notes = [
    ...cases.flatMap((c) => c.notes.map((n) => ({ at: n.at, actorId: n.actorId, text: n.text, on: "Investigation" }))),
    ...d.exceptions.flatMap((e) => e.history.filter((h) => h.action === "note").map((h) => ({ at: h.at, actorId: h.actorId, text: h.detail, on: categoryLabel(e.category) }))),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const r = v.returnPosition;

  return (
    <>
      {/* Plain links throughout Control: full page loads, each rendered on the server from the database. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <p className={s.small}><a href="/control/payments">← All payments</a></p>
      <h1 className={s.title}>{v.requested.internalReference} · {v.requested.beneficiaryName}</h1>
      <p className={s.lede}>
        {money(v.requested.amount.amountMinor, v.requested.amount.currency)} · {v.requested.purpose} · requested for {v.requested.requestedExecutionDate}
        {v.provider ? ` · via ${v.provider.providerName}` : ""}
      </p>

      <section className={s.section} aria-labelledby="states">
        <h2 className={s.h2} id="states">Three separate states</h2>
        <div className={s.grid3}>
          <div className={`${s.stateCard} ${executionTone(v.status.execution) === "warn" ? s.stateCardWarn : ""}`} data-testid="state-execution">
            <h3 className={s.stateName}>Execution</h3>
            <p className={s.stateValue}>{st.execution}</p>
            <p className={s.small}>What the payment provider reports about the payout. A provider&rsquo;s report is its claim; it is not proof that money arrived.{v.lastEventAt ? ` Last report ${when(v.lastEventAt)}.` : ""}</p>
          </div>
          <div className={`${s.stateCard} ${settlementTone(v.status.settlement) === "verified" ? s.stateCardVerified : settlementTone(v.status.settlement) === "warn" ? s.stateCardWarn : ""}`} data-testid="state-settlement">
            <h3 className={s.stateName}>Settlement</h3>
            <p className={s.stateValue}>{st.settlement}{v.status.settlement !== "none" ? ` (${st.settlementScope})` : ""}</p>
            <p className={s.small}>What independent evidence shows: a bank statement line or an on-chain transfer. Only independent evidence can verify settlement.</p>
          </div>
          <div className={`${s.stateCard} ${reconciliationTone(v.status.reconciliation) === "warn" ? s.stateCardWarn : ""}`} data-testid="state-reconciliation">
            <h3 className={s.stateName}>Reconciliation</h3>
            <p className={s.stateValue}>{st.reconciliation}</p>
            <p className={s.small}>Whether our statement lines are matched to this payment, by reference, amount, currency and date.</p>
          </div>
        </div>
      </section>

      {r ? (
        <section className={s.section} aria-labelledby="return-position" data-testid="return-position">
          <h2 className={s.h2} id="return-position">Return position</h2>
          <div className={s.warnBox}>
            <dl className={s.dl}>
              <dt>Debited from our account</dt><dd>{money(r.debited.amountMinor, r.debited.currency)}</dd>
              <dt>Returned to our account</dt><dd>{money(r.returnCredited.amountMinor, r.returnCredited.currency)}</dd>
              <dt>Net movement</dt><dd data-testid="net-movement">{r.netMovement ? money(r.netMovement.amountMinor, r.netMovement.currency) : "Not known yet: both legs are not on the statement"}</dd>
            </dl>
            <p className={s.unpaid} data-testid="supplier-unpaid">Supplier still unpaid</p>
            <p>
              The money came back to our account{r.netMovement ? `, so the net movement is ${money(r.netMovement.amountMinor, r.netMovement.currency)}` : ""}.
              That is not a payment: {v.requested.beneficiaryName} has not received these funds and still needs a new payment with corrected bank details.
            </p>
          </div>
        </section>
      ) : null}

      {v.outstanding.length || v.contradictions.length ? (
        <section className={s.section} aria-labelledby="outstanding">
          <h2 className={s.h2} id="outstanding">Still outstanding</h2>
          <ul>
            {v.contradictions.map((f) => <li key={f.code}>{f.text}</li>)}
            {v.outstanding.map((f) => <li key={f.code}>{f.text}{f.amount ? ` (${money(f.amount.amountMinor, f.amount.currency)})` : ""}</li>)}
          </ul>
        </section>
      ) : null}

      <section className={s.section} aria-labelledby="exceptions">
        <h2 className={s.h2} id="exceptions">Exceptions</h2>
        {d.exceptions.length === 0 ? <p>No exceptions for this payment.</p> : d.exceptions.map((e: ReconciliationException) => (
          <article className={s.panel} key={e.id} data-testid={`exception-${e.category}`} aria-labelledby={`exc-${e.id}`}>
            <h3 className={s.h3} id={`exc-${e.id}`}>{categoryLabel(e.category)} <span className={s.mono}>({e.id})</span></h3>
            <p className={s.row}>
              <Tag tone={e.status === "resolved" ? "plain" : "warn"}><span data-testid="exception-status">{exceptionStatusLabel(e.status)}</span></Tag>
              <span className={s.small}>Severity {severityLabel(e.severity)} · due {e.dueDate ?? "—"}</span>
            </p>
            <p>{e.explanation}</p>
            <p className={s.small}><strong>Required action:</strong> {e.requiredAction}</p>
            {e.resolution ? <p className={s.small}><strong>Resolved</strong> {when(e.resolution.at)} by {name(e.resolution.actorId)}: {e.resolution.note}</p> : null}
            {mayInvestigate && e.status !== "resolved" ? (
              <AssignToMe target={{ kind: "exception", id: e.id }} ownerName={name(e.ownerId)} isMine={e.ownerId === ctx.userId} label="Assign this exception to me" />
            ) : <p className={s.small}>Owner: <strong>{name(e.ownerId) ?? "Unassigned"}</strong></p>}
            {mayInvestigate && e.status !== "resolved" ? (
              <div className={s.subsection}>
                <h4 className={s.h4}>Attach evidence to this exception</h4>
                <EvidenceForm target={{ kind: "exception", id: e.id }} />
              </div>
            ) : null}
            {mayRequest && e.status !== "resolved" ? (
              <div className={s.subsection}>
                <h4 className={s.h4}>Request a resolution (needs an approver)</h4>
                <ResolutionForm target={{ kind: "exception", id: e.id }} evidence={evidenceChoices} />
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className={s.section} aria-labelledby="case">
        <h2 className={s.h2} id="case">Investigation</h2>
        {cases.length === 0 ? <p>No investigation is open for this payment.</p> : cases.map((c) => (
          <article className={s.panel} key={c.id} aria-labelledby={`case-${c.id}`} data-testid="case">
            <h3 className={s.h3} id={`case-${c.id}`}>{c.title}</h3>
            <dl className={s.dl}>
              <dt>Status</dt><dd>{caseStatusLabel(c.status)}</dd>
              <dt>Owner</dt><dd data-testid="case-owner">{name(c.ownerId) ?? "Unassigned"}</dd>
              <dt>Priority</dt><dd data-testid="case-priority">{priorityLabel(c.priority)}</dd>
              <dt>Next action</dt><dd data-testid="case-next-action">{c.nextAction ?? "None set"}</dd>
              <dt>Due date</dt><dd data-testid="case-due">{c.dueDate ?? "None set"}</dd>
            </dl>
            {mayInvestigate && c.status !== "resolved" ? (
              <>
                <AssignToMe target={{ kind: "case", id: c.id }} ownerName={name(c.ownerId)} isMine={c.ownerId === ctx.userId} label="Assign this investigation to me" />
                <div className={s.subsection}>
                  <h4 className={s.h4}>Priority, next action and due date</h4>
                  <CaseDetailsForm caseId={c.id} priority={c.priority} nextAction={c.nextAction} dueDate={c.dueDate} />
                </div>
              </>
            ) : null}
            {mayRequest && c.status !== "resolved" && d.exceptions.every((e) => e.caseId !== c.id || e.status === "resolved") ? (
              <div className={s.subsection}>
                <h4 className={s.h4}>Request closing the investigation (needs an approver)</h4>
                <ResolutionForm target={{ kind: "case", id: c.id }} evidence={evidenceChoices} />
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className={s.section} aria-labelledby="notes">
        <h2 className={s.h2} id="notes">Notes</h2>
        {notes.length === 0 ? <p>No notes yet.</p> : (
          <ul className={s.plainList} data-testid="notes">
            {notes.map((n, i) => (
              <li className={s.panel} key={`${n.at}-${i}`}>
                <p className={`${s.small} ${s.muted}`}>{when(n.at)} · {name(n.actorId)} · on {n.on}</p>
                <p>{n.text}</p>
              </li>
            ))}
          </ul>
        )}
        {mayInvestigate && (cases[0] || d.exceptions[0]) ? (
          <NoteForm target={cases[0] ? { kind: "case", id: cases[0].id } : { kind: "exception", id: d.exceptions[0].id }} />
        ) : null}
      </section>

      <section className={s.section} aria-labelledby="approvals">
        <h2 className={s.h2} id="approvals">Approvals</h2>
        <p className={`${s.small} ${s.muted}`}>Maker-checker: payment operations proposes a resolution; a different person with the Approver role approves the exact version.</p>
        {d.approvals.length === 0 ? <p>No resolution has been proposed yet.</p> : d.approvals.map((a) => {
          const p = a.payload as Payload;
          return (
            <article className={s.panel} key={a.id} data-testid={`approval-${a.status}`} aria-labelledby={`appr-${a.id}`}>
              <h3 className={s.h3} id={`appr-${a.id}`}>Version {a.version} · <span data-testid="approval-status">{a.status === "pending" ? "Waiting for an approver" : a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : "Superseded by a newer version"}</span></h3>
              <dl className={s.dl}>
                <dt>Proposed by</dt><dd>{name(a.requestedBy)} · {when(a.createdAt)}</dd>
                <dt>For</dt><dd>{p.target.kind === "case" ? "Investigation" : "Exception"} <span className={s.mono}>{p.target.id}</span></dd>
                <dt>Proposed resolution</dt><dd>{p.note}</dd>
                <dt>Evidence</dt><dd className={s.mono}>{p.evidenceRefs.join(", ")}</dd>
                <dt>SHA-256</dt><dd className={s.mono}>{a.payloadSha256}</dd>
              </dl>
              {a.status === "pending" ? (
                mayDecide ? (
                  a.requestedBy === ctx.userId
                    ? <p className={s.resultError}>You proposed this version, so another approver must decide it.</p>
                    : <DecisionForm requestId={a.id} payloadSha256={a.payloadSha256} version={a.version} />
                ) : <p className={s.small}>Only an approver can decide this request. Your role cannot.</p>
              ) : mayDecide ? <FlashMessage flashKey={`decision:${a.id}`} /> : null}
            </article>
          );
        })}
      </section>

      <section className={s.section} aria-labelledby="timeline">
        <h2 className={s.h2} id="timeline">Evidence timeline</h2>
        <p className={`${s.small} ${s.muted}`}>Every record about this payment, oldest first, with the class of evidence each one is. Green marks independent evidence.</p>
        <ol className={s.timeline} data-testid="timeline">
          {d.timeline.map((e) => {
            const c = evidenceClass(e);
            return (
              <li key={e.id} className={e.independent ? s.timelineIndependent : e.kind === "missing_evidence" ? s.timelineMissing : undefined}>
                <p className={`${s.small} ${s.muted}`}>{when(e.at)} · {timelineKindLabel(e.kind)}</p>
                <p><strong>{e.title}</strong></p>
                <p className={s.small}>Source: {e.source} · <Tag tone={c.tone}>{c.label}</Tag></p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className={s.section} aria-labelledby="report">
        <h2 className={s.h2} id="report">Report</h2>
        <p>Download the evidence-backed investigation report. The download is recorded in the audit history.</p>
        <p className={s.row}>
          <a href={`/api/control/payments/${encodeURIComponent(id)}/report?format=json`} download data-testid="report-json">Download report (JSON)</a>
          <a href={`/api/control/payments/${encodeURIComponent(id)}/report?format=csv`} download data-testid="report-csv">Download report (CSV)</a>
        </p>
      </section>
    </>
  );
}
