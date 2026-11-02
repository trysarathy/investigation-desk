// S2 (DEMO ONLY): the payment matched to its sample invoice, the same release checks as S1, and the
// entry the existing posting rules propose. Approve only when final (Aashmiin's rule); it never posts.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveDemo } from "@/components/demo-slices/ApproveDemo";
import { CheckChips } from "@/components/demo-slices/ReleaseCard";
import { demoSlicesOn } from "@/lib/demo-slices/gate";
import { APPROVED_MESSAGE, APPROVER, entryScenarios, proposedEntry, WAITING_MESSAGE } from "@/lib/demo-slices/entry";
import { ranSummary } from "@/lib/demo-slices/present";
import { formatUsdc } from "@/lib/requests/lifecycle";
import { DemoHead } from "../DemoHead";

export const dynamic = "force-dynamic";

export default async function EntryDemo({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  if (!demoSlicesOn()) notFound();
  const { s } = await searchParams;
  const ids = await entryScenarios();
  const id = s && ids.includes(s) ? s : ids[0];
  const e = id ? await proposedEntry(id) : null;
  const c = e?.card;
  return (
    <div className="page demo-page">
      <DemoHead title="Invoice and Xero entry" current="/demo/entry" />
      {s && !ids.includes(s) && <p role="status" className="bar bar-amber" style={{ margin: 0 }}>That sample has no entry to show (it needs a person first, or never posts). Showing {id} instead.</p>}
      <nav className="chips" aria-label="Sample payment">
        {ids.map((x) => <Link key={x} className="chip" href={`/demo/entry?s=${x}`} aria-current={x === id ? "page" : undefined}>{x}</Link>)}
      </nav>
      {!e || !c ? <p className="muted">No sample payment has an entry to show.</p> : (
        <>
          <section className="panel" aria-labelledby="match-h" data-testid="entry-match">
            <div className="panel-h"><h2 id="match-h" style={{ margin: 0, fontSize: 15 }}>Matched to {e.invoiceId}</h2></div>
            <div className="panel-b">
              <p style={{ margin: 0 }}>{e.customerRef} · invoice {e.invoiceId} for {e.invoiceAmount} · paid on {c.network}</p>
              <p className="muted" style={{ margin: 0 }}>{e.matchLine}</p>
            </div>
          </section>
          <section className="panel" aria-labelledby="entry-h" data-testid="entry-proposed">
            <div className="panel-h"><h2 id="entry-h" style={{ margin: 0, fontSize: 15 }}>Proposed Xero entry</h2></div>
            <div className="panel-b">
              <ul className="points">{e.planReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              {e.rows.length > 0 && (
                <>
                  <div className="table-wrap wide-only">
                    <table className="table entry-table" style={{ width: "100%", fontSize: 13 }} data-testid="entry-lines">
                      <thead><tr><th style={{ textAlign: "left" }}>Account</th><th style={{ textAlign: "right" }}>Debit (USD)</th><th style={{ textAlign: "right" }}>Credit (USD)</th><th style={{ textAlign: "left" }}>Detail</th></tr></thead>
                      <tbody>
                        {e.rows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.account}{r.code && <div className="mono muted" style={{ fontSize: 12 }}>{r.code}</div>}</td>
                            <td className="amount" style={{ textAlign: "right" }}>{r.dr ? formatUsdc(r.dr) : ""}</td>
                            <td className="amount" style={{ textAlign: "right" }}>{r.cr ? formatUsdc(r.cr) : ""}</td>
                            <td className="muted detail">{r.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ul className="cards narrow-only" data-testid="entry-lines-narrow">
                    {e.rows.map((r, i) => (
                      <li key={i} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                        <div><strong>{r.dr ? "Debit" : "Credit"} {formatUsdc((r.dr ?? r.cr)!)} USD</strong></div>
                        <div>{r.account}{r.code && <span className="mono muted"> · {r.code}</span>}</div>
                        <div className="muted" style={{ fontSize: 13 }}>{r.detail}</div>
                      </li>
                    ))}
                  </ul>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>SGD: rate not applied in this demo.</p>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>Receipts go to a stablecoin clearing account, not a bank account: the wallet isn&apos;t treated as cash. The account code is a sample; each organisation sets its own.</p>
                </>
              )}
              <div data-testid="approve-checks" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <strong style={{ fontSize: 13 }}>Checks</strong>
                <CheckChips card={c} />
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{ranSummary(c.checks, c.result.tone)}</p>
              </div>
              {e.rows.length > 0 || e.approvable
                ? <ApproveDemo message={APPROVED_MESSAGE} approver={APPROVER} disabledReason={e.approvable && e.rows.length ? undefined : e.approvable ? "No Xero entry is prepared for this payment, so there is nothing to approve." : WAITING_MESSAGE} />
                : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
