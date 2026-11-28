/* eslint-disable @next/next/no-html-link-for-pages -- plain links on purpose: every page is a full load rendered on the server from the database (as in rc5 Control) */
import type { Metadata } from "next";
import { can } from "@/server/authz";
import { orNotFound } from "@/server/control-page";
import { exceptionDetail, type StoredBank, type StoredProviderRecord, type StoredTransfer } from "@/server/merchant-ui";
import { merchantPaymentDetail } from "@/server/merchant";
import { merchantMember } from "@/server/merchant-page";
import { pageNow } from "@/server/demo-build";
import s from "@/components/control/control.module.css";
import m from "@/components/merchant/merchant.module.css";
import { FlashMessage } from "@/components/control/forms";
import { AssignForm, ExceptionNoteForm, ProposeResolutionForm } from "@/components/merchant/forms";
import { Chip, DecisionChip, FiatAmount, age, bankStatusLabel, differenceLabel, networkLabel, whenIn } from "@/components/merchant/ui";
import { ExceptionKeys } from "@/components/merchant/exceptions-queue";
import { ExceptionOptimism, OwnerName, PendingNotes, PendingProposal } from "@/components/merchant/exception-optimism";
import { Amount, EvidenceBadge, HashLink, Mono, StatusBadge } from "@/components/ui";
import { NEEDS_A_RATE, differenceNeedsRate, unknownFiat } from "@/lib/clearline/merchant/fiat-value";

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
  // v1 (#173): a token-priced invoice without a recorded rate shows "needs a rate", never 0
  const unk = unknownFiat(d.match?.ledger);
  // the payment's own records, read side by side: what the provider claims, what the bank shows, what the chain shows
  const pay = e.orderId ? await merchantPaymentDetail(ctx, e.orderId).catch(() => null) : null;
  const chain = pay ? (pay.parts.chain as { transfers: StoredTransfer[]; pending: { txHash: string }[] }) : null;
  const provider = pay ? (pay.parts.provider as { records: StoredProviderRecord[] }) : null;
  const bank = pay ? (pay.parts.bank as StoredBank) : null;
  const cur = d.match?.ledger.invoice.currency ?? "";
  const stillOpen = e.status === "resolved" ? null : <StatusBadge kind={e.status === "in_review" ? "needs_review" : "exception"} label={STATUS[e.status] ?? e.status} wrap />;

  return (
    <>
      <p className={s.small}><a href="/control/merchant/exceptions">← All exceptions</a></p>
      <h1 className={s.title}>Exception {e.id}</h1>
      <p className={s.lede}>{e.orderId ? <>Payment <a href={`/control/merchant/payments/${encodeURIComponent(e.orderId)}`}>{e.orderId}</a> · </> : null}opened {when(e.openedAt)} ({age(e.openedAt, pageNow(shell.dataMode))} ago) · <span data-testid="exception-status">{stillOpen ?? <StatusBadge kind="approved" label={STATUS[e.status] ?? e.status} />}</span></p>
      <FlashMessage flashKey={`resolution:${e.id}`} />
      <ExceptionKeys />
      <ExceptionOptimism>

      <div className={m.cols2}>
        <section className={s.panel} aria-labelledby="what">
          <h2 className={s.h2} id="what">What happened</h2>
          <p data-testid="exception-reason">{e.reason}</p>
          <p><strong>Next step:</strong> {e.nextStep}</p>
          <dl className={m.kv}>
            <dt>Owner role</dt><dd>{e.ownerRole}</dd>
            <dt>Owner</dt><dd><OwnerName stored={e.ownerName} /></dd>
            {e.closedAt ? <><dt>Closed</dt><dd>{when(e.closedAt)}</dd></> : null}
          </dl>
        </section>
        <section className={s.panel} aria-labelledby="payment">
          <h2 className={s.h2} id="payment">The payment</h2>
          {d.match ? (
            <>
              <p><DecisionChip decision={d.match.decision} /> at step {d.match.decidingStep}, rule <span className={s.mono}>{d.match.ruleId}</span></p>
              <dl className={m.kv}>
                <dt>Invoice</dt><dd>{unk.invoice ? NEEDS_A_RATE : <FiatAmount minor={d.match.ledger.invoice.amountMinor} currency={cur} />}</dd>
                <dt>Credited</dt><dd><FiatAmount minor={d.match.ledger.creditedMinor} currency={cur} /></dd>
                <dt>Open balance</dt><dd>{unk.open ? NEEDS_A_RATE : <FiatAmount minor={d.match.ledger.openBalanceMinor} currency={cur} />} ({d.match.ledger.balanceLabel})</dd>
              </dl>
              {d.match.differences.length ? <ul className={s.small}>{d.match.differences.map((x) => <li key={x.id}>{differenceLabel(x.type)} {differenceNeedsRate(x.type, d.match!.ledger) ? NEEDS_A_RATE : <FiatAmount minor={x.amountMinor} currency={x.currency} />}: {x.reason}</li>)}</ul> : null}
            </>
          ) : <p>No payment is linked to this exception (a transfer that matched no order).</p>}
        </section>
      </div>

      {pay && chain && provider && bank ? (
        <section className={s.section} aria-labelledby="sources">
          <h2 className={s.h2} id="sources">Provider claim, bank and chain, side by side</h2>
          <p className={s.small}>Each column says only what its own source says. They are never merged into one status.</p>
          <div className={m.three} data-testid="exception-sources">
            <article className={m.part} aria-labelledby="src-provider" data-testid="source-provider">
              <h3 className={m.partName} id="src-provider">Provider claims</h3>
              <div className={m.partBody}>
                {provider.records.length === 0 ? <p>No provider record.</p> : provider.records.map((r) => (
                  <dl className={m.kv} key={r.providerPaymentId}>
                    <dt>Record</dt><dd><Mono>{r.providerPaymentId}</Mono></dd>
                    <dt>Claims</dt><dd>{r.statusClaim.replace(/_/g, " ")}{r.displayedStatus ? ` (shown as “${r.displayedStatus}”)` : ""}</dd>
                    <dt>Credited</dt><dd><FiatAmount minor={r.creditedMinor} currency={cur} /></dd>
                    <dt>Rate</dt><dd><Mono>{r.executedRate}</Mono></dd>
                    {r.feeMinor ? <><dt>Fee</dt><dd><FiatAmount minor={r.feeMinor} currency={cur} /></dd></> : null}
                    <dt>Batch</dt><dd>{r.batchId ? <a className={s.mono} href={`/control/merchant/batches/${encodeURIComponent(r.batchId)}`}>{r.batchId}</a> : "none"}</dd>
                  </dl>
                ))}
                <p className={s.muted}>Provider statuses are claims, not proof.</p>
              </div>
            </article>
            <article className={m.part} aria-labelledby="src-bank" data-testid="source-bank">
              <h3 className={m.partName} id="src-bank">Bank</h3>
              <div className={m.partBody}>
                <p className={m.badges}>{bank.settlementVerified ? <StatusBadge kind="matched" label="Settlement verified" wrap /> : <StatusBadge kind="awaiting_evidence" label="Settlement not verified" wrap />} <EvidenceBadge level={bank.evidence} label={bank.evidenceLabel} wrap /></p>
                <dl className={m.kv}>
                  <dt>Status</dt><dd>{bankStatusLabel(bank.status)}</dd>
                  <dt>Batch</dt><dd>{bank.batchIds.length ? bank.batchIds.map((b) => <a key={b} className={s.mono} href={`/control/merchant/batches/${encodeURIComponent(b)}`}>{b}</a>) : "none"}</dd>
                  <dt>Tied</dt><dd>{bank.batchTied ? "Yes, to the cent" : "No"}</dd>
                  <dt>Settled</dt><dd>{bank.settled ? "Yes: tied to the cent, with an imported statement a second person confirmed" : "No"}</dd>
                  {bank.bankLineLabels.length ? <><dt>Lines</dt><dd>{bank.bankLineLabels.join("; ")}</dd></> : null}
                </dl>
              </div>
            </article>
            <article className={m.part} aria-labelledby="src-chain" data-testid="source-chain">
              <h3 className={m.partName} id="src-chain">Chain</h3>
              <div className={m.partBody}>
                {chain.transfers.length === 0 ? <p>No transfer found for this order.</p> : chain.transfers.map((x) => (
                  <dl className={m.kv} key={`${x.txHash}:${x.logIndex}`}>
                    <dt>Amount</dt><dd><Amount minor={x.amountBaseUnits} exponent={x.decimals} currency={x.symbol} currencyPosition="after" group /></dd>
                    <dt>Network</dt><dd>{networkLabel(x.network)} · {x.confirmations} conf.</dd>
                    <dt>Tx</dt><dd><HashLink value={x.txHash} network={x.network} /></dd>
                    <dt>To</dt><dd><HashLink value={x.to} network={x.network} kind="address" /></dd>
                    <dt>When</dt><dd>{when(x.timestamp)}</dd>
                  </dl>
                ))}
                {chain.pending.length ? <p><StatusBadge kind="awaiting_evidence" label={`${chain.pending.length} pending (not final)`} /></p> : null}
                <p className={s.muted}>Recorded fixture (no live chain connection).</p>
              </div>
            </article>
          </div>
        </section>
      ) : null}

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
        <PendingNotes />
      </section>

      {mayAct ? (
        <section className={s.section} aria-labelledby="act">
          <h2 className={s.h2} id="act">Work this exception</h2>
          <div className={m.cols2}>
            <div className={s.panel} id="assign"><h3 className={s.h3}>Assign</h3><AssignForm exceptionId={e.id} members={d.members} current={e.ownerUserId} me={ctx.userId} /></div>
            <div className={s.panel}><h3 className={s.h3}>Add a note</h3><ExceptionNoteForm exceptionId={e.id} kind="note" /></div>
            <div className={s.panel} id="evidence"><h3 className={s.h3}>Attach evidence</h3><ExceptionNoteForm exceptionId={e.id} kind="evidence" /></div>
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
        <PendingProposal />
        {d.requests.length === 0 ? <p>No resolution has been proposed.</p> : (
          <div className={s.tableWrap} role="region" aria-label="Resolution requests table" tabIndex={0}>
            <table className={s.table}>
              <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Proposed by</th><th scope="col">SHA-256</th><th scope="col">Decision</th></tr></thead>
              <tbody>{d.requests.map((r) => (
                <tr key={r.id}>
                  <td>v{r.version}</td><td>{r.status}</td><td>{r.requestedByName ?? "—"}<br /><span className={s.small}>{when(r.createdAt)}</span></td>
                  <td><HashLink value={r.payloadSha256} kind="tx" head={8} tail={8} /></td>
                  <td>{r.decisions.length ? r.decisions.map((x, i) => <span key={i}>{x.decision === "approve" ? "Approved" : "Rejected"} by {x.by}: {x.reason}</span>) : r.status === "pending" ? <a href="/control/merchant/approvals">Awaiting a different approver</a> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      </ExceptionOptimism>
    </>
  );
}
