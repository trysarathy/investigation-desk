/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { orNotFound } from "@/server/control-page";
import { exceptionDetail } from "@/server/merchant-ui";
import { merchantMember } from "@/server/merchant-page";
import { pageNow } from "@/server/demo-build";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { FlashMessage } from "@/components/control/forms";
import { AssignForm, ExceptionNoteForm, ProposeResolutionForm } from "@/components/merchant/forms";
import { Chip, DecisionChip, age, differenceLabel, fiat, whenIn } from "@/components/merchant/ui";

export const metadata: Metadata = { title: "Exception" };

const STATUS: Record<string, string> = { open: "Open", in_review: "In review (resolution awaiting approval)", resolved: "Resolved" };

export default async function ExceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, shell } = await merchantMember();
  const id = decodeURIComponent((await params).id);
  const d = await orNotFound(exceptionDetail(ctx, id));
  const e = d.exception;
  const open = e.status !== "resolved";
  const mayAct = can(ctx.role, "merchant_investigate") && open;
  const pending = d.requests.find((r) => r.status === "pending");
  const evidence = d.notes.filter((n) => n.kind === "evidence");
  const ent = shell.entities.find((x) => x.id === d.match?.ledger.invoice.entityId) ?? null;
  const when = (v: string | Date | null | undefined) => whenIn(v, ent);

  return (
    <>
      <p className={s.small}><a href="/control/merchant/exceptions">← All exceptions</a></p>
      <h1 className={s.title}>Exception {e.id}</h1>
      <p className={s.lede}>{e.orderId ? <>Payment <a href={`/control/merchant/payments/${encodeURIComponent(e.orderId)}`}>{e.orderId}</a> · </> : null}opened {when(e.openedAt)} ({age(e.openedAt, pageNow(shell.dataMode))} ago) · <Chip tone={open ? "warn" : "ok"} testId="exception-status">{STATUS[e.status] ?? e.status}</Chip></p>
      <FlashMessage flashKey={`resolution:${e.id}`} />

      <div className={m.cols2}>
        <section className={s.panel} aria-labelledby="what">
          <h2 className={s.h2} id="what">What happened</h2>
          <p data-testid="exception-reason">{e.reason}</p>
          <p><strong>Next step:</strong> {e.nextStep}</p>
          <dl className={m.kv}>
            <dt>Owner role</dt><dd>{e.ownerRole}</dd>
            <dt>Owner</dt><dd data-testid="exception-owner">{e.ownerName ?? "Unassigned"}</dd>
            {e.closedAt ? <><dt>Closed</dt><dd>{when(e.closedAt)}</dd></> : null}
          </dl>
        </section>
        <section className={s.panel} aria-labelledby="payment">
          <h2 className={s.h2} id="payment">The payment</h2>
          {d.match ? (
            <>
              <p><DecisionChip decision={d.match.decision} /> at step {d.match.decidingStep}, rule <span className={s.mono}>{d.match.ruleId}</span></p>
              <dl className={m.kv}>
                <dt>Invoice</dt><dd>{fiat(d.match.ledger.invoice.amountMinor, d.match.ledger.invoice.currency)}</dd>
                <dt>Credited</dt><dd>{fiat(d.match.ledger.creditedMinor, d.match.ledger.invoice.currency)}</dd>
                <dt>Open balance</dt><dd>{fiat(d.match.ledger.openBalanceMinor, d.match.ledger.invoice.currency)} ({d.match.ledger.balanceLabel})</dd>
              </dl>
              {d.match.differences.length ? <ul className={s.small}>{d.match.differences.map((x) => <li key={x.id}>{differenceLabel(x.type)} {fiat(x.amountMinor, x.currency)}: {x.reason}</li>)}</ul> : null}
            </>
          ) : <p>No payment is linked to this exception (a transfer that matched no order).</p>}
        </section>
      </div>

      <section className={s.section} aria-labelledby="notes">
        <h2 className={s.h2} id="notes">Notes and evidence</h2>
        {d.notes.length === 0 ? <p>No notes or evidence yet.</p> : (
          <ol className={s.timeline}>
            {d.notes.map((n) => (
              <li key={n.id}>
                <p className={s.small}><strong>{when(n.createdAt)}</strong> · {n.author ?? "A former member"} · {n.kind === "evidence" ? <Chip>Evidence attached by a person — not independent</Chip> : "Note"}</p>
                <p>{n.body}{n.reference ? <> <span className={s.mono}>[{n.reference}]</span></> : null}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {mayAct ? (
        <section className={s.section} aria-labelledby="act">
          <h2 className={s.h2} id="act">Work this exception</h2>
          <div className={m.cols2}>
            <div className={s.panel}><h3 className={s.h3}>Assign</h3><AssignForm exceptionId={e.id} members={d.members} current={e.ownerUserId} me={ctx.userId} /></div>
            <div className={s.panel}><h3 className={s.h3}>Add a note</h3><ExceptionNoteForm exceptionId={e.id} kind="note" /></div>
            <div className={s.panel}><h3 className={s.h3}>Attach evidence</h3><ExceptionNoteForm exceptionId={e.id} kind="evidence" /></div>
            <div className={s.panel}>
              <h3 className={s.h3}>Propose a resolution</h3>
              {pending ? <p className={s.small}>Version {pending.version} is already waiting for approval. A new proposal replaces it (the old version can then no longer be approved).</p> : null}
              <ProposeResolutionForm exceptionId={e.id} evidence={evidence.map((n) => ({ id: n.id, label: `${n.body}${n.reference ? ` [${n.reference}]` : ""}` }))} />
            </div>
          </div>
        </section>
      ) : open ? <p className={s.small}>Payment Operations or Finance work exceptions. Your role reads them{can(ctx.role, "decide_approval") ? " and decides proposed resolutions on the Approvals page" : ""}.</p> : null}

      <section className={s.section} aria-labelledby="approvals">
        <h2 className={s.h2} id="approvals">Resolution requests</h2>
        {d.requests.length === 0 ? <p>No resolution has been proposed.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Resolution requests table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Proposed by</th><th scope="col">SHA-256</th><th scope="col">Decision</th></tr></thead>
              <tbody>{d.requests.map((r) => (
                <tr key={r.id}>
                  <td>v{r.version}</td><td>{r.status}</td><td>{r.requestedByName ?? "—"}<br /><span className={s.small}>{when(r.createdAt)}</span></td>
                  <td className={s.mono}>{r.payloadSha256.slice(0, 16)}…</td>
                  <td>{r.decisions.length ? r.decisions.map((x, i) => <span key={i}>{x.decision === "approve" ? "Approved" : "Rejected"} by {x.by}: {x.reason}</span>) : r.status === "pending" ? <a href="/control/merchant/approvals">Awaiting a different approver</a> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
