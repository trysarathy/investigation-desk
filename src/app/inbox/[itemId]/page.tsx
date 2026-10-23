import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActingAs, ActorLink } from "@/components/ActingAs";
import { InboxActions, ReviewDecide } from "@/components/InboxActions";
import { Status } from "@/components/Status";
import { formatTime } from "@/lib/format";
import { recordsOf } from "@/lib/payments/exceptions";
import { openContradictionsFor, resolveItemId, STATUS_LABELS } from "@/lib/payments/inbox";
import { inboxStore, paymentsStore } from "@/lib/payments/live";
import { describe, describeRedirect, resolvePaymentRef } from "@/lib/payments/match";
import { codeLabel } from "@/lib/payments/view";

export const dynamic = "force-dynamic";

export default async function InboxItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const id = decodeURIComponent(itemId);
  const inbox = await inboxStore().load();
  if (inbox.items[id]?.movedTo) {
    // Its payment merged into another: the item continues there.
    const to = resolveItemId(inbox, id);
    if (to) redirect(`/inbox/${encodeURIComponent(to)}?from=${encodeURIComponent(id)}`);
  }
  const item = inbox.items[id];
  if (!item) notFound();
  const data = await paymentsStore().load();
  const result = data.match?.result;
  const paymentOf = (pid: string) => (result ? resolvePaymentRef(result, pid).payment?.paymentId : undefined) ?? pid;
  const contradictions = openContradictionsFor(inbox, item, paymentOf);
  const moved = item.history.filter((h) => h.action === "moved").at(-1);
  const recs = recordsOf(data);
  const resolved = item.subject.kind === "payment" && result ? resolvePaymentRef(result, item.subject.paymentId) : undefined;
  const review = item.kind === "review" && result ? result.reviews.find((r) => r.reviewId === item.itemId) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="mono">{item.itemId}</span></h1>
        <div style={{ display: "flex", gap: 8 }}>
          <ActorLink href={`/api/inbox/${encodeURIComponent(item.itemId)}/evidence.pdf`} className="btn btn-sm">Evidence pack (PDF)</ActorLink>
          <Link href="/inbox" className="btn btn-sm">Inbox</Link>
        </div>
      </div>
      <ActingAs />
      {contradictions.map((c) => (
        <div key={c.itemId} className="bar bar-red" role="alert">
          <span>New contradiction on this payment: <Link href={`/inbox/${encodeURIComponent(c.itemId)}`} className="mono">{c.itemId}</Link> · {c.title}</span>
        </div>
      ))}
      {moved && <div className="bar bar-info">{moved.why}</div>}
      <section className="panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <strong>{codeLabel(item)}</strong>
          <Status status={item.status === "closed" ? "pass" : item.status === "reopened" ? "fail" : "warn"} label={STATUS_LABELS[item.status]} />
          {item.confidence && <span className="badge">{item.confidence} confidence</span>}
          {item.sample && <span className="badge">Sample case</span>}
          {!item.current && <span className="badge">No longer produced by matching</span>}
        </div>
        <p style={{ margin: 0 }}>{item.title}</p>
        <p className="muted" style={{ margin: 0 }}><strong>Next step:</strong> {item.nextStep}</p>
        <p className="faint" style={{ margin: 0 }}>
          Owner {item.owner ?? "unassigned"} · follow up {item.followUp ?? "not set"} · first seen {formatTime(item.firstSeen)} · last seen {formatTime(item.lastSeen)}
        </p>
        {item.subject.kind === "payment" && (
          <p style={{ margin: 0 }}>
            Payment{" "}
            {resolved?.payment
              ? <Link href={`/payments/${resolved.payment.paymentId}`} className="mono">{resolved.payment.paymentId}</Link>
              : <span className="mono">{item.subject.paymentId}</span>}
            {resolved?.via.length ? <span className="muted"> · {resolved.via.map(describeRedirect).join("; ")}</span> : null}
          </p>
        )}
        {item.subject.kind === "case" && <p style={{ margin: 0 }}>Investigation <Link href={item.subject.href} className="mono">{item.subject.caseId}</Link></p>}
      </section>

      {review && (
        <ReviewDecide reviewId={review.reviewId} candidates={review.candidates.map((c) => ({
          recordId: c.recordId, label: recs.get(c.recordId) ? describe(recs.get(c.recordId)!) : c.recordId, reserved: c.reservedPaymentId,
          rank: c.reasons.length ? `${c.score}: ${c.reasons.join(", ")}` : undefined,
        }))} />
      )}

      {!review && <section className="panel" aria-label="Evidence">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Evidence</h2></div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {item.evidence.map((e, n) => (
                <tr key={n} style={{ cursor: "default" }}>
                  <th scope="row" style={{ width: 260, whiteSpace: "normal" }}>{e.label}</th>
                  <td style={{ whiteSpace: "normal" }}>{e.recordId && recs.get(e.recordId) ? describe(recs.get(e.recordId)!) : e.value}</td>
                  <td className="mono faint" style={{ whiteSpace: "normal", maxWidth: 360 }}>
                    {e.source?.startsWith("https://") ? <a href={e.source} target="_blank" rel="noreferrer">Explorer</a> : e.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}

      <InboxActions itemId={item.itemId} status={item.status} owner={item.owner} followUp={item.followUp} kind={item.kind} />

      {item.notes.length > 0 && (
        <section className="panel" style={{ padding: 16 }} aria-label="Notes">
          <h2>Notes</h2>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{item.notes.map((n, i) => <li key={i}><span className="faint">{formatTime(n.at)} · {n.by}:</span> {n.text}</li>)}</ul>
        </section>
      )}
      <section className="panel" style={{ padding: 16 }} aria-label="History">
        <h2>History</h2>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          {item.history.map((h, i) => (
            <li key={i}><span className="faint">{formatTime(h.at)} · {h.by} ·</span> {h.action.replace(/_/g, " ")}
              {(h.from || h.to) && <span className="muted"> ({h.from ?? "—"} → {h.to ?? "—"})</span>}{h.why && <>: {h.why}</>}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
