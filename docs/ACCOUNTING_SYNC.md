# Accounting sync: from a matched stablecoin payment to the books

Clearline = the bridge from stablecoin payments to the books. Every incoming stablecoin payment is
requested clearly, matched to its invoice, checked, explained when wrong, and, once a person
approves, posted to the company's accounting system.

## Flow

1. **Invoice in the books → payment request.** `POST /api/accounting/import` reads open sales
   invoices (Xero `ACCREC` / `AUTHORISED`; QuickBooks invoices with a balance) and makes one payment
   request per USD invoice, linked to it. In demo mode, every demo request has a fictional invoice in
   the demo books.
2. **Payment arrives → matched and checked.** The existing request lifecycle (read-only on-chain).
3. **Posting plan.** `planPosting()` in `src/lib/accounting/rules.ts` turns the request and its
   transfers into the exact lines that would post. Shown on the request page under *In your books*.
4. **Approval.** A person clicks *Approve and post*. The button sends the plan's key; if the plan
   changed since the page loaded, the server refuses and shows the new plan.
5. **Post.** The adapter writes the lines to the accounting system with an idempotency key per line.
6. **Audit.** Every approval, posting, failure and refused approval (plan not ready, plan changed, books not connected) is appended to the audit log (`/books`). A counterfeit or wrong-network payment shows "Never posted" on its page; it is logged when someone tries to approve it.

## Posting rules (all tested in `tests/accounting.test.ts`)

| Case | What posts | Invoice after |
|---|---|---|
| Exact | One payment: tx hash, token, network, USD value and rate source in the reference | Paid |
| Short, no decision or balance requested | Partial payment + a note on the invoice | Open for the shortfall |
| Short, accepted as settled | Payment + **separate** fee write-off line (fee account) | Paid |
| Over | Nothing until a person decides; then the invoice amount + a **separate** overpayment line received into the wallet account, marked "To refund" or "Customer credit" | Paid |
| Duplicate (paid twice) | One payment + one overpayment marked for refund. Never two payments | Paid |
| Same transfer delivered twice | Nothing new (one line per transfer, ever) | Unchanged |
| Wrong network | **Never posted**, even if a person accepts it (post by hand) | Unchanged |
| Counterfeit token / failed / wrong token | **Never posted** | Unchanged |
| No reference | Nothing until a person confirms which invoice it pays; then as exact | |
| Still confirming | Nothing until confirmed | |
| Non-USD invoice | Blocked: post by hand (FX later) | |
| Token more than 0.5% off par | Blocked: post by hand | |

**USD value.** USDC and USDT are valued at par (1.00 USD) and every line says so ("par: no price
feed connected"). A price feed can be plugged in through `PriceSource`; a reading more than 0.5%
from par stops automatic posting.

## Access

- On-chain: read-only, as before. Nothing holds keys or moves funds.
- Accounting system: write access is used only by `approveAndPost()`, only for a plan in state
  `ready`, only after a person approves it. Tokens live server-side in the data directory
  (`xero-tokens.json`), never in the repo or the browser.

## Systems

| System | Status | Records |
|---|---|---|
| Demo books | Built (demo mode) | Fictional "Xero-style" organisation inside Clearline's data file |
| Xero | Built; needs your Xero developer app to run | Payment, CreditNote + Allocation, BankTransaction `RECEIVE-OVERPAYMENT`, invoice History note |
| QuickBooks Online | Built against documented shapes; not yet run on a sandbox | Payment, CreditMemo + linking payment, unapplied Payment |
| NetSuite | Interface designed (`providers/netsuite.ts`), not built | customerPayment, creditMemo |

**Pilots (Aashmiin's decision, 31 Oct 2026):** a pilot delivers matching, explanations and a Xero-ready import file that the customer's accountant reviews and imports. Live posting to a customer's Xero is switched on only after the Xero sandbox tests pass and Aashmiin approves.

### Connect Xero (about 10 minutes)

1. Sign in at developer.xero.com → *New app* → *Web app*. Redirect URI:
   `http://localhost:3000/api/accounting/xero/callback`.
2. Put the client ID and secret in `.env.local` (git-ignored), never in chat or the repo:
   `XERO_CLIENT_ID=…` and `XERO_CLIENT_SECRET=…`.
3. Start with `DEMO_MODE=off npm run dev`, open `/books`, click *Connect Xero*, and choose the
   **Demo Company** (Xero's free sample organisation).
4. Set the account codes (`accounts` in `.data/accounting.json`, no screen yet): `walletAccountCode` = the code of a **bank** account in the Demo Company (payments and overpayments are received into it; Xero rejects anything else), `feeAccountCode` = `404 Bank Fees`. Overpayments are received into the wallet account and marked "To refund" or "Customer credit" in the reference.
5. *Import invoices* on `/books`, pay one with test USDC, approve, and check the invoice in Xero.

[ASSUMPTION] Xero introduced granular scopes for apps created from 2026; if the connection is refused
for scope reasons, set `XERO_SCOPES` (see `providers/xero-auth.ts`).

## Failures and rounding
- If an adapter fails part-way (line 1 posted, line 2 failed), the lines that posted are recorded as posted in the audit log, so a retry posts only what's left.
- Payment lines are rounded **down** to cents against the running total, so the books never show more received than arrived; a payment that covers the invoice exactly closes it.
- The Xero token refresh runs inside a file lock (Xero replaces the refresh token on each use).
