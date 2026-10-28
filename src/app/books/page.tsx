// Books: which accounting system Clearline posts to, the invoices there (demo books in demo mode),
// and the full audit log of what was posted, refused or failed, by whom and why.

import Link from "next/link";
import { ImportInvoices } from "@/components/books/ImportInvoices";
import { DemoBadge } from "@/components/requests/StatePill";
import { activeProvider, loadAccounting, xeroStatus } from "@/lib/accounting/service";
import { PROVIDER_LABEL, type AuditKind } from "@/lib/accounting/types";
import { formatUsdc } from "@/lib/requests/lifecycle";
import { friendlyTime } from "@/lib/requests/ui";
import { isDemoMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

const KIND: Record<AuditKind, string> = { approved: "Approved", posted: "Posted", failed: "Failed", refused: "Not posted", linked: "Linked", imported: "Request made", connected: "Connected" };

export default async function BooksPage() {
  const acct = await loadAccounting();
  const provider = activeProvider(acct);
  const demo = isDemoMode();
  const xero = await xeroStatus();
  const books = acct.demoBooks;
  const invoices = Object.values(books?.invoices ?? {}).sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? 1 : -1));
  const reqByInvoice = Object.fromEntries(Object.entries(acct.links).map(([rid, l]) => [l.invoiceId, rid]));
  const audit = [...acct.audit].reverse();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Books {demo && <DemoBadge />}</h1>
          <div className="muted">Stablecoin payments, matched, explained and in your books. Posting to: <strong data-testid="books-provider">{!demo && provider === "demo" ? "nothing connected yet" : PROVIDER_LABEL[provider]}</strong></div>
        </div>
        {!demo && (xero.connected
          ? <span className="badge">Xero connected: {xero.org}</span>
          : <a className="btn btn-primary" href="/api/accounting/xero/connect">{xero.configured ? "Connect Xero" : "Connect Xero (set up the app first)"}</a>)}
      </div>

      {demo && provider === "demo" && books && (
        <section className="panel">
          <div className="panel-h"><h2>{books.orgName}</h2><span className="faint">Simulated books: fictional company, no connection to any real accounting system</span></div>
          <table className="table" style={{ width: "100%" }} data-testid="demo-invoices">
            <thead><tr><th style={{ textAlign: "left" }}>Invoice</th><th style={{ textAlign: "left" }}>Customer</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Paid</th><th style={{ textAlign: "right" }}>Written off</th><th style={{ textAlign: "right" }}>Due</th><th style={{ textAlign: "left" }}>Status</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.invoiceId}>
                  <td>{reqByInvoice[i.invoiceId] ? <Link href={`/requests/${reqByInvoice[i.invoiceId]}`}>{i.invoiceNumber}</Link> : i.invoiceNumber}</td>
                  <td>{i.contactName}</td>
                  <td style={{ textAlign: "right" }} className="amount">{formatUsdc(i.total)}</td>
                  <td style={{ textAlign: "right" }} className="amount">{formatUsdc(i.amountPaid)}</td>
                  <td style={{ textAlign: "right" }} className="amount">{i.amountCredited === "0.00" ? "—" : formatUsdc(i.amountCredited)}</td>
                  <td style={{ textAlign: "right" }} className="amount">{formatUsdc(i.amountDue)}</td>
                  <td><span className="badge">{i.status === "PAID" ? "Paid" : "Awaiting payment"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <div className="panel-h"><h2>Audit log</h2><span className="faint">{acct.audit.length} entries, append-only</span></div>
        {audit.length === 0 && <div className="panel-b muted">Nothing posted yet.</div>}
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="audit-log">
          {audit.slice(0, 200).map((e) => (
            <li key={e.id} style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "150px 110px minmax(0,1fr)", gap: 12, fontSize: 13 }}>
              <span className="faint">{friendlyTime(e.at)}</span>
              <span><span className="badge">{KIND[e.kind]}</span></span>
              <span>
                {e.requestId && <Link href={`/requests/${e.requestId}`}>{e.invoiceNumber ?? e.requestId}</Link>} {e.requestId && "· "}
                <span className="muted">{e.by}: {e.reason}</span>
                {e.lines?.length ? <div className="faint" style={{ fontSize: 12 }}>{e.lines.map((l) => `${l.externalType} ${l.kind === "note" ? "" : formatUsdc(l.amount)}`).join(" · ")}</div> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {!demo && provider !== "demo" && (
        <section className="panel">
          <div className="panel-h"><h2>Make payment requests from your invoices</h2></div>
          <div className="panel-b"><ImportInvoices /></div>
        </section>
      )}

      {!demo && (
        <section className="panel">
          <div className="panel-h"><h2>Accounting tools</h2></div>
          <div className="panel-b muted">
            <div><strong>Xero</strong>: built. Connect with a free Xero developer app and the Xero Demo Company (docs/ACCOUNTING_SYNC.md).</div>
            <div><strong>QuickBooks Online</strong>: built against the sandbox API shapes; not yet run against a sandbox company.</div>
            <div><strong>NetSuite</strong>: designed, not built.</div>
          </div>
        </section>
      )}
    </div>
  );
}
