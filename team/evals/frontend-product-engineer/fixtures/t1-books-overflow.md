# Fixture t1: the Books page on a phone

Source: `origin/main` @ 0c7d9f1, `src/app/books/page.tsx` (excerpts, real code) and a measurement taken
on 2026-11-01 (local production build, demo day loaded, Playwright Chromium).

## Measurement (real, from the baseline run)
| Route | Viewport | documentElement.scrollWidth | clientWidth | Full-page screenshot height |
|---|---|---|---|---|
| /books | 1280×800 | 1280 | 1280 | — |
| /books | 390×844 | 743 | 390 | 17,746 px |
| /books | 320×800 | 743 | 320 | — |
| /requests/all | 390×844 | 390 | 390 | — |

Screenshot note (390): the "Northwind Pay Pte Ltd (demo books, fictional)" invoice table runs off the
right edge (columns Paid, Written off, Due, Status are outside the panel). Below it, each "Audit log"
entry shows the time and badge in two fixed columns and the text column is about 40 px wide: one word
per line ("INV-1041 · / Mei / Tan / (Finance / ops): / Payment / request …").

## Code excerpt 1: demo invoices table (books/page.tsx)
```tsx
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
```

## Code excerpt 2: audit log (books/page.tsx)
```tsx
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="audit-log">
          {audit.slice(0, 200).map((e) => (
            <li key={e.id} style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "150px 110px minmax(0,1fr)", gap: 12, fontSize: 13 }}>
              <span className="faint">{friendlyTime(e.at)}</span>
              <span><span className="badge">{KIND[e.kind]}</span></span>
              <span>…{e.by}: {e.reason}…</span>
            </li>
          ))}
        </ol>
```

## Relevant CSS (globals.css, real)
```css
.table-wrap { overflow-x: auto; }
@media (max-width: 760px) { … .wide-only { display: none; } }
@media (min-width: 761px) { .narrow-only { display: none; } }
```
Other list pages wrap tables as `<div className="table-wrap"><table className="table">…`.
The e2e test `tests/e2e/demo_cases.py` checks "no horizontal scroll at 1280x720 (projector) or 390px (phone)"
on the pages it visits and uses `data-testid="demo-invoices"` and `data-testid="audit-log"`.

## Plan task (team/plan/tasks-2026-11-02.md, row 3)
| # | Owner | Task | Acceptance |
|---|---|---|---|
| 3 | frontend-product-engineer | Books page usable on a phone (baseline finding F1) | No horizontal page scroll at 320 and 390 on /books; audit log readable on a phone |
