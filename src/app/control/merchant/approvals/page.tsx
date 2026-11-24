import type { Metadata } from "next";
import { can } from "@/server/authz";
import { listMerchantApprovals } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { FlashMessage } from "@/components/control/forms";
import { MerchantDecisionForm, SubmitWriteoff } from "@/components/merchant/forms";
import { Chip, Empty, differenceLabel, fiat, whenIn } from "@/components/merchant/ui";
import { when } from "@/components/control/ui";

export const metadata: Metadata = { title: "Approvals" };

type WoPayload = { amountMinor: string; currency: string; orderId: string; differences: { id: string; type: string; amountMinor: string; reason: string }[]; matchDecision: string | null };
type ResPayload = { exception: { id: string; orderId: string | null; reason: string; nextStep: string }; note: string; evidence: { id: string; body: string; reference: string | null }[]; match: { decision: string } | null };

export default async function ApprovalsPage() {
  const { ctx, shell } = await merchantMember();
  // a write-off is in its entity's currency: its time is shown in that entity's time zone when one entity has the currency
  const zoneOf = (currency: string | undefined) => { const es = shell.entities.filter((e) => e.currency === currency); return es.length === 1 ? es[0] : null; };
  const a = await listMerchantApprovals(ctx);
  const pending = a.requests.filter((r) => r.status === "pending");
  const closed = a.requests.filter((r) => r.status !== "pending");
  const mayDecide = can(ctx.role, "decide_approval");
  const mayPropose = can(ctx.role, "propose_writeoff");
  return (
    <>
      <h1 className={s.title}>Approvals</h1>
      <p className={s.lede}>Write-offs and resolutions wait here for a <strong>different</strong> person with the Approver role. The approver decides the exact version they reviewed: its SHA-256 goes with the decision, and the server and the database refuse any other version, or a decision by the person who prepared it.</p>
      {closed.slice(0, 20).map((r) => <FlashMessage key={r.id} flashKey={`decision:${r.id}`} />)}
      {pending.filter((r) => r.kind === "merchant_writeoff").map((r) => <FlashMessage key={r.id} flashKey={`writeoff:${r.subjectId}`} />)}

      <section className={s.section} aria-labelledby="pending">
        <h2 className={s.h2} id="pending">Awaiting a decision ({pending.length})</h2>
        {pending.length === 0 ? <Empty>Nothing is waiting for approval.</Empty> : pending.map((r) => {
          const mine = r.requestedBy === ctx.userId;
          const what = r.kind === "merchant_writeoff" ? "write-off" : "resolution";
          return (
            <article className={s.panel} key={r.id} aria-labelledby={`req-${r.id}`} data-testid="approval-request">
              <h3 className={s.h3} id={`req-${r.id}`}>{r.kind === "merchant_writeoff" ? `Write-off ${r.amount ?? ""}` : `Resolution of ${r.subjectId}`} · version {r.version}</h3>
              <p className={s.row}><Chip tone="amber">Awaiting approval</Chip><span className={s.small}>Prepared by {r.requestedByName} · {r.kind === "merchant_writeoff" ? whenIn(r.createdAt, zoneOf((r.payload as WoPayload).currency)) : when(r.createdAt)}{r.orderId ? <> · payment <a href={`/control/merchant/payments/${encodeURIComponent(r.orderId)}`}>{r.orderId}</a></> : null}</span></p>
              {r.kind === "merchant_writeoff" ? (() => {
                const p = r.payload as WoPayload;
                return (
                  <div>
                    <p>Write off <strong>{fiat(p.amountMinor, p.currency)}</strong> on {p.orderId} (payment {p.matchDecision?.replace(/_/g, " ") ?? "—"}).</p>
                    <ul className={s.small}>{p.differences.map((d) => <li key={d.id}>{differenceLabel(d.type)} {fiat(d.amountMinor, p.currency)}: {d.reason}</li>)}</ul>
                  </div>
                );
              })() : (() => {
                const p = r.payload as ResPayload;
                return (
                  <div>
                    <p><strong>Exception:</strong> <a href={`/control/merchant/exceptions/${encodeURIComponent(p.exception.id)}`}>{p.exception.id}</a> — {p.exception.reason}</p>
                    <p><strong>Proposed resolution:</strong> {p.note}</p>
                    <p className={s.small}><strong>Evidence cited (attached by a person, not independent):</strong></p>
                    <ul className={s.small}>{p.evidence.map((x) => <li key={x.id}>{x.body}{x.reference ? ` [${x.reference}]` : ""}</li>)}</ul>
                  </div>
                );
              })()}
              <details>
                <summary>The exact payload under review</summary>
                <pre className={m.pre}>{JSON.stringify(r.payload, null, 2)}</pre>
              </details>
              {mine ? <p className={s.small} data-testid="preparer-note">You prepared this {what}, so you cannot approve it. A different approver must decide.</p>
                : mayDecide ? <MerchantDecisionForm requestId={r.id} payloadSha256={r.payloadSha256} version={r.version} what={what} />
                : <><p className={s.small}>SHA-256 <span className={s.mono}>{r.payloadSha256}</span></p><p className={s.small}>Only a person with the Approver role can decide.</p></>}
            </article>
          );
        })}
      </section>

      <section className={s.section} aria-labelledby="to-submit">
        <h2 className={s.h2} id="to-submit">Write-offs proposed by the engine, not yet submitted ({a.writeoffsToSubmit.length})</h2>
        {a.writeoffsToSubmit.length === 0 ? <p>None.</p> : (
          <ul className={s.plainList}>{a.writeoffsToSubmit.map((w) => (
            <li key={w.id} className={s.panel}>
              <p><a href={`/control/merchant/payments/${encodeURIComponent(w.orderId)}`}>{w.orderId}</a>: write-off of {w.amount} <span className={s.mono}>({w.id})</span></p>
              {mayPropose ? <SubmitWriteoff writeoffId={w.id} amount={w.amount} /> : <p className={s.small}>Finance submits write-offs for approval.</p>}
            </li>
          ))}</ul>
        )}
      </section>

      <section className={s.section} aria-labelledby="closed">
        <h2 className={s.h2} id="closed">Decided and superseded</h2>
        {closed.length === 0 ? <p>None yet.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Decided and superseded requests table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Prepared by</th><th scope="col">Decision</th><th scope="col">SHA-256</th></tr></thead>
              <tbody>{closed.map((r) => (
                <tr key={r.id}>
                  <td>{r.kind === "merchant_writeoff" ? `Write-off ${r.amount ?? ""}` : `Resolution ${r.subjectId}`} v{r.version}</td>
                  <td><Chip tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "warn" : "plain"}>{r.status}</Chip></td>
                  <td>{r.requestedByName}</td>
                  <td>{r.decisions.map((d, i) => <span key={i}>{d.decision === "approve" ? "Approved" : "Rejected"} by {d.by}: {d.reason}</span>)}{r.decisions.length === 0 ? <span className={s.muted}>No decision (a newer version replaced it)</span> : null}</td>
                  <td className={s.mono}>{r.payloadSha256.slice(0, 16)}…</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
