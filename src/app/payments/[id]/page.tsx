import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Status } from "@/components/Status";
import { formatTime } from "@/lib/format";
import { paymentsStore } from "@/lib/payments/live";
import { describeRedirect, resolvePaymentRef } from "@/lib/payments/match";
import type { Candidate, Leg } from "@/lib/payments/types";
import { describe, LEG_LABELS, LEG_ORDER, legStatus, recordIndex, REVIEW_REASONS, sourceLabel } from "@/lib/payments/view";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const data = await paymentsStore().load();
  const result = data.match?.result;
  const p = result?.payments.find((x) => x.paymentId === id);
  if (!p) {
    // A retired payment ID or a review ID: go to the payment that carries it now, saying why.
    const resolved = result ? resolvePaymentRef(result, id) : undefined;
    if (resolved?.payment) redirect(`/payments/${resolved.payment.paymentId}?from=${encodeURIComponent(id)}${resolved.review ? `#${resolved.review.reviewId}` : ""}`);
    if (resolved?.via.length) {
      return (
        <div className="page">
          <h1><span className="mono">{id}</span></h1>
          {resolved.via.map((r) => <div key={r.from} className="bar bar-info">{describeRedirect(r)}.</div>)}
          <p className="muted" style={{ margin: 0 }}>The ID stays reserved; it comes back if its records are imported again.</p>
          <Link href="/payments" className="btn btn-sm" style={{ alignSelf: "flex-start" }}>All payments</Link>
        </div>
      );
    }
    notFound();
  }
  const arrivedVia = from && result ? resolvePaymentRef(result, from).via : [];
  const recs = recordIndex(data);
  const reviews = result!.reviews.filter((r) => r.paymentId === id);
  const label = (rid: string) => (recs.get(rid) ? describe(recs.get(rid)!) : rid);
  const candidateList = (cs: Candidate[]) => (
    <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>
      {cs.map((c) => (
        <li key={c.recordId}>{label(c.recordId)}{c.reservedPaymentId && <> · held under <Link href={`/payments/${c.reservedPaymentId}`} className="mono">{c.reservedPaymentId}</Link> (reserved)</>}{c.reasons.length > 0 && <span className="faint"> · rank {c.score}: {c.reasons.join(", ")}</span>}</li>
      ))}
    </ol>
  );
  const reviewBlock = (id: string) => { const r = reviews.find((x) => x.reviewId === id); return r ? <div id={r.reviewId}><p style={{ margin: 0 }}><span className="mono faint">{r.reviewId}</span> {r.message}</p>{candidateList(r.candidates)}</div> : null; };
  const legDetail = (l: Leg) => {
    switch (l.state) {
      case "linked": return <><ul style={{ margin: 0, paddingLeft: 20 }}>{[...new Map(l.links.map((x) => [x.detail, x])).values()].map((x) => <li key={x.detail}>{x.detail}</li>)}</ul>{l.reviewId && reviewBlock(l.reviewId)}</>;
      case "missing": return <>{l.note && <p style={{ margin: 0 }}>{l.note}</p>}{l.suggestions.length > 0 && <><p className="muted" style={{ margin: "4px 0 0" }}>Similar records, ranked. None is linked until someone confirms it:</p>{candidateList(l.suggestions)}</>}</>;
      case "needs_review": return reviewBlock(l.reviewId);
      case "unknown": return <p style={{ margin: 0 }}>{l.note}</p>;
      case "not_applicable": return <p className="faint" style={{ margin: 0 }}>No records of this kind imported.</p>;
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="mono">{p.paymentId}</span></h1>
        <Link href="/payments" className="btn btn-sm">All payments</Link>
      </div>

      {arrivedVia.length > 0 && (
        <div className="bar bar-info" role="status">{arrivedVia.map((r) => describeRedirect(r)).join("; ")}.</div>
      )}
      {from && !arrivedVia.length && /^REV-/.test(from) && (
        <div className="bar bar-info" role="status">Review {from} is on this payment.</div>
      )}

      <section className="panel" aria-label="Legs">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Legs</h2></div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {LEG_ORDER.map((leg) => {
                const s = legStatus(p.legs[leg]);
                return (
                  <tr key={leg} style={{ cursor: "default" }}>
                    <th scope="row" style={{ width: 120 }}>{LEG_LABELS[leg]}</th>
                    <td style={{ width: 200 }}><Status status={s.status} label={s.label} /></td>
                    <td style={{ whiteSpace: "normal" }}>{legDetail(p.legs[leg])}</td>
                  </tr>
                );
              })}
              {reviews.filter((r) => r.leg === "fees" || r.leg === "returns").map((r) => (
                <tr key={r.reviewId} id={r.reviewId} style={{ cursor: "default" }}>
                  <th scope="row">{LEG_LABELS[r.leg]}</th>
                  <td><Status status="warn" label={REVIEW_REASONS[r.reason]} /></td>
                  <td style={{ whiteSpace: "normal" }}><p style={{ margin: 0 }}>{r.message}</p>{candidateList(r.candidates)}</td>
                </tr>
              ))}
              {p.fees.length > 0 && <tr style={{ cursor: "default" }}><th scope="row">Fees</th><td /><td style={{ whiteSpace: "normal" }}>{p.fees.map((f) => <div key={f.recordId}>{label(f.recordId)}</div>)}</td></tr>}
              {p.returns.length > 0 && <tr style={{ cursor: "default" }}><th scope="row">Returns</th><td /><td style={{ whiteSpace: "normal" }}>{p.returns.map((f) => <div key={f.recordId}>{label(f.recordId)}</div>)}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-label="Timeline">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Timeline</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Event time (source)</th><th>Observed</th><th>Record</th><th>Source</th></tr></thead>
            <tbody>
              {p.timeline.map((t) => {
                const r = recs.get(t.recordId);
                return (
                  <tr key={t.recordId} style={{ cursor: "default" }}>
                    <td className="mono">{t.eventTime ?? "—"}</td>
                    <td className="mono faint">{formatTime(t.observedTime)}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {t.label}
                      {r && r.sources.length > 1 && <span className="badge" style={{ marginLeft: 8 }}>Duplicate record · seen {r.sources.length} times</span>}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      {(r?.sources ?? []).map((s, i) => { const l = sourceLabel(s); return <div key={i}>{l.href ? <a href={l.href} target="_blank" rel="noreferrer">{l.text}</a> : <span className="mono">{l.text}</span>}</div>; })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-label="Identifiers">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <h2>Original identifiers</h2>
          <p className="faint" style={{ margin: "4px 0 0" }}>Kept exactly as each source wrote them. The payment ID is ours and replaces none of them.</p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Record</th><th>Role</th><th>Source field</th><th>Value</th></tr></thead>
            <tbody>
              {p.identifiers.map((i, n) => (
                <tr key={n} style={{ cursor: "default" }}>
                  <td>{i.kind.replace("_", " ")}</td><td>{i.role.replaceAll("_", " ")}</td><td className="mono">{i.sourceField}</td><td className="mono">{i.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
