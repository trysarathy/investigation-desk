import Link from "next/link";
import { ActingAs } from "@/components/ActingAs";
import { MatchProgress } from "@/components/MatchProgress";
import { PaymentActions } from "@/components/PaymentActions";
import { PaymentImports } from "@/components/PaymentImports";
import { Status } from "@/components/Status";
import { formatTime } from "@/lib/format";
import { demoModeOn } from "@/lib/demo/reset";
import { paymentsStore } from "@/lib/payments/live";
import { describeRedirect } from "@/lib/payments/match";
import { allMappings } from "@/lib/payments/store";
import { describe, fileABanner, LEG_LABELS, LEG_ORDER, MEANING_LABELS, paymentRow, recordIndex, REVIEW_REASONS } from "@/lib/payments/view";
import { workspaceStore } from "@/lib/workspace/live";

// Reads the imported records on every request; never pre-render it at build time.
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const data = await paymentsStore().load();
  const result = data.match?.result;
  const recs = recordIndex(data);
  const rows = (result?.payments ?? []).map((p) => paymentRow(p, recs, result!.reviews.filter((r) => r.paymentId === p.paymentId).length));
  const held = data.records.instruction.length + data.records.provider.length + data.records.bank.length;
  const ws = await workspaceStore().load();
  const banner = fileABanner({ fileALoaded: !!ws.fileA, depositLedgerRows: ws.fileB?.rows.length ?? 0 });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Payments</h1>
        <PaymentActions disabled={!held} preview={demoModeOn()} />
      </div>
      <ActingAs />
      <MatchProgress />
      {banner && <div className="bar bar-amber" role="status">{banner}</div>}
      <p className="muted" style={{ margin: 0 }}>
        One payment ID per payment, linking instruction, on-chain transfer, provider record, bank record and ledger entry.
        Links use exact identifiers only; anything ambiguous waits for review. A provider&apos;s &ldquo;complete&rdquo; is shown as the provider
        reports it, never as proof the beneficiary was credited.
      </p>

      {result ? (
        <>
          <p className="faint" style={{ margin: 0 }}>
            {rows.length} payments · {result.reviews.length} to review · {result.duplicateRecords.length} duplicate records ·{" "}
            {result.unlinked.length} unlinked records · matched {formatTime(data.match!.at)}
          </p>

          {result.reviews.length > 0 && (
            <section className="panel" aria-label="Needs review">
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}><h2>Needs review</h2></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Review</th><th>Payment</th><th>Leg</th><th>Why</th><th>Detail</th><th>Held payment IDs</th><th className="num">Candidates</th></tr></thead>
                  <tbody>
                    {result.reviews.map((r) => (
                      <tr key={r.reviewId}>
                        <td className="mono faint">{r.reviewId}</td>
                        <td><Link href={`/payments/${r.paymentId}`} className="mono">{r.paymentId}</Link></td>
                        <td>{LEG_LABELS[r.leg]}</td>
                        <td><Status status="warn" label={REVIEW_REASONS[r.reason]} /></td>
                        <td style={{ whiteSpace: "normal", minWidth: 320 }}>{r.message}</td>
                        <td style={{ whiteSpace: "normal" }}>
                          {r.candidates.filter((c) => c.reservedPaymentId).map((c) => (
                            <div key={c.recordId}>
                              <Link href={`/payments/${c.reservedPaymentId}`} className="mono">{c.reservedPaymentId}</Link>{" "}
                              <span className="faint">(reserved) · {recs.get(c.recordId) ? describe(recs.get(c.recordId)!) : c.recordId}</span>
                            </div>
                          ))}
                          {!r.candidates.some((c) => c.reservedPaymentId) && <span className="faint">—</span>}
                        </td>
                        <td className="num">{r.candidates.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="panel" aria-label="Payments">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Payment</th><th>Reference</th><th className="num">Amount</th><th>Chain</th><th>Provider status (raw)</th>
                    {LEG_ORDER.map((l) => <th key={l}>{LEG_LABELS[l]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.paymentId}>
                      <td><Link href={`/payments/${r.paymentId}`} className="mono">{r.paymentId}</Link></td>
                      <td className="mono">{r.title}{r.duplicates > 0 && <span className="badge" style={{ marginLeft: 8 }}>Duplicate record</span>}</td>
                      <td className="num mono">{r.amount ?? "—"} {r.asset ?? ""}</td>
                      <td>{r.chain ?? "—"}</td>
                      <td>{r.providerStatus
                        ? <span title={MEANING_LABELS[r.providerStatus.meaning]}><span className="mono">{r.providerStatus.raw}</span> <span className="faint">· {MEANING_LABELS[r.providerStatus.meaning]}</span></span>
                        : <span className="faint">—</span>}</td>
                      {r.legs.map((l) => <td key={l.leg}><Status status={l.status} label={l.label} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {Object.keys(result.redirects ?? {}).length > 0 && (
            <section className="panel" aria-label="Retired payment IDs">
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <h2>Retired payment IDs</h2>
                <p className="faint" style={{ margin: "4px 0 0" }}>No payment ID ever disappears. Opening one of these goes to where it leads now.</p>
              </div>
              <ul style={{ margin: 0, padding: "8px 16px 12px 32px" }}>
                {Object.values(result.redirects).map((r) => (
                  <li key={r.from}><Link href={`/payments/${r.from}`} className="mono">{r.from}</Link> · {describeRedirect(r).slice(r.from.length + 1)}</li>
                ))}
              </ul>
            </section>
          )}

          {result.unlinked.length > 0 && (
            <section className="panel" aria-label="Unlinked records">
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                <h2>Unlinked records</h2>
                <p className="faint" style={{ margin: "4px 0 0" }}>No exact identifier ties these to a payment. Free text is never parsed into a link.</p>
              </div>
              <ul style={{ margin: 0, padding: "8px 16px 12px 32px" }}>
                {result.unlinked.map((u) => <li key={u.recordId}>{recs.get(u.recordId) ? describe(recs.get(u.recordId)!) : u.recordId}</li>)}
              </ul>
            </section>
          )}
        </>
      ) : (
        <div className="bar bar-info">No payment records yet. Import instructions, a provider report or bank records below.</div>
      )}

      <PaymentImports mappings={allMappings(data)} imports={data.imports.slice(0, 20)} preview={demoModeOn()} />
    </div>
  );
}
