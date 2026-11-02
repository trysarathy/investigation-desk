// S2 (DEMO ONLY): the payment matched to its sample invoice and the entry the existing posting rules
// propose, waiting for approval. Approve here does not post anywhere.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveDemo } from "@/components/demo-slices/ApproveDemo";
import { demoSlicesOn } from "@/lib/demo-slices/gate";
import { APPROVED_MESSAGE, entryScenarios, proposedEntry } from "@/lib/demo-slices/entry";
import { formatUsdc } from "@/lib/requests/lifecycle";
import { DEMO_ACTOR } from "@/lib/mode";
import { DemoHead } from "../DemoHead";

export const dynamic = "force-dynamic";

export default async function EntryDemo({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  if (!demoSlicesOn()) notFound();
  const { s } = await searchParams;
  const ids = await entryScenarios();
  const id = s && ids.includes(s) ? s : ids[0];
  const e = id ? await proposedEntry(id) : null;
  return (
    <div className="page demo-page">
      <DemoHead title="Invoice and Xero entry" current="/demo/entry" />
      {s && !ids.includes(s) && <p role="status" className="bar bar-amber" style={{ margin: 0 }}>That sample has no entry ready to approve (it needs a person first, or never posts). Showing {id} instead.</p>}
      <nav className="chips" aria-label="Sample payment">
        {ids.map((x) => <Link key={x} className="chip" href={`/demo/entry?s=${x}`} aria-current={x === id ? "page" : undefined}>{x}</Link>)}
      </nav>
      {!e ? <p className="muted">No sample payment has an entry ready to approve.</p> : (
        <>
          <section className="panel" aria-labelledby="match-h" data-testid="entry-match">
            <div className="panel-h"><h2 id="match-h" style={{ margin: 0, fontSize: 15 }}>Matched to {e.invoiceId}</h2><span className="demo-badge">{e.label}</span></div>
            <div className="panel-b">
              <p style={{ margin: 0 }}>{e.customerRef} · invoice {e.invoiceId} for {e.invoiceAmount}</p>
              <ul className="points">{e.matchReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          </section>
          <section className="panel" aria-labelledby="entry-h" data-testid="entry-proposed">
            <div className="panel-h"><h2 id="entry-h" style={{ margin: 0, fontSize: 15 }}>Proposed Xero entry · waiting for your approval</h2></div>
            <div className="panel-b">
              <ul className="points">{e.planReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <div className="table-wrap wide-only">
                <table className="table" style={{ width: "100%", fontSize: 13 }} data-testid="entry-lines">
                  <thead><tr><th style={{ textAlign: "left" }}>Account</th><th style={{ textAlign: "right" }}>Debit (USD)</th><th style={{ textAlign: "right" }}>Credit (USD)</th><th style={{ textAlign: "left" }}>Detail</th></tr></thead>
                  <tbody>
                    {e.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.account}{r.code && <div className="mono muted" style={{ fontSize: 12 }}>{r.code}</div>}</td>
                        <td className="amount" style={{ textAlign: "right" }}>{r.dr ? formatUsdc(r.dr) : ""}</td>
                        <td className="amount" style={{ textAlign: "right" }}>{r.cr ? formatUsdc(r.cr) : ""}</td>
                        <td className="muted">{r.detail}</td>
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
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Receipts go to a stablecoin clearing account, not a bank account: the wallet isn&apos;t treated as cash. The account code is a sample; each organisation sets its own.</p>
              <ApproveDemo message={APPROVED_MESSAGE} approver={DEMO_ACTOR} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
