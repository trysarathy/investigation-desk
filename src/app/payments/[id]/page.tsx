import Link from "next/link";
import { notFound } from "next/navigation";
import { Status } from "@/components/Status";
import { formatTime } from "@/lib/format";
import { paymentsStore } from "@/lib/payments/live";
import type { Candidate, Leg } from "@/lib/payments/types";
import { describe, LEG_LABELS, LEG_ORDER, legStatus, recordIndex, REVIEW_REASONS, sourceLabel } from "@/lib/payments/view";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await paymentsStore().load();
  const p = data.match?.result.payments.find((x) => x.paymentId === id);
  if (!p) notFound();
  const recs = recordIndex(data);
  const reviews = data.match!.result.reviews.filter((r) => r.paymentId === id);
  const label = (rid: string) => (recs.get(rid) ? describe(recs.get(rid)!) : rid);
  const candidateList = (cs: Candidate[]) => (
    <ol style={{ margin: "4px 0 0", paddingLeft: 20 }}>
      {cs.map((c) => (
        <li key={c.recordId}>{label(c.recordId)}{c.reasons.length > 0 && <span className="faint"> · rank {c.score}: {c.reasons.join(", ")}</span>}</li>
      ))}
    </ol>
  );
  const legDetail = (l: Leg) => {
    switch (l.state) {
      case "linked": return <ul style={{ margin: 0, paddingLeft: 20 }}>{[...new Map(l.links.map((x) => [x.detail, x])).values()].map((x) => <li key={x.detail}>{x.detail}</li>)}</ul>;
      case "missing": return <>{l.note && <p style={{ margin: 0 }}>{l.note}</p>}{l.suggestions.length > 0 && <><p className="muted" style={{ margin: "4px 0 0" }}>Similar records, ranked. None is linked until someone confirms it:</p>{candidateList(l.suggestions)}</>}</>;
      case "needs_review": { const r = reviews.find((x) => x.reviewId === l.reviewId); return r ? <><p style={{ margin: 0 }}>{r.message}</p>{candidateList(r.candidates)}</> : null; }
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
                <tr key={r.reviewId} style={{ cursor: "default" }}>
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
