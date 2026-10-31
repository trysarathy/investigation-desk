# Codebase map: `src/lib/accounting` as it really is

Read on `origin/main` @ `0c7d9f1` (2026-11-01 SGT) in a read-only checkout, plus a scratch copy where
the probe test `zz-probe.test.ts` was run through the real `planPosting` and `xeroBody` (deleted
afterwards). Code is a primary source: every row below is `[VERIFIED: code @0c7d9f1, read 2026-11-01]`
unless marked otherwise. Re-check line numbers before quoting them in a PR: they move.

## Data flow
```
Xero/QBO invoice ──listOpenInvoices()──► importInvoice() ──► payment request (requests/lifecycle createRequest)
                                                              + InvoiceLink in accounting.json
chain transfer ──► requests/lifecycle ingest() ──► deriveRequest(): counted / flagged / ambiguous / pending
                                                   │
                       planPosting(reqData, acct, requestId, {threshold, price?})   ← pure, no clock, no network
                                                   │  PostingPlan {status, reasons[], lines[], leavesOpen, idempotencyKey}
         person clicks Approve (POST /api/accounting/<id> {actor, key}) ──► service.approvePosting()
                                                   │  refuses unless status "ready" and key == plan key
                       engine.approveAndPost() ──► adapter.post(link, lines, key) ──► audit log (append-only)
```

## Files
| File | What it does | Things to know |
|---|---|---|
| `types.ts` | `BooksProvider` (demo/xero/quickbooks/netsuite), `InvoiceLink`, `LineKind` = payment / fee_writeoff / overpayment / note, `PostingLine` (amount = exact decimal string, `date` YYYY-MM-DD), `PlanStatus`, `AuditEntry`, `AccountSettings` (`walletAccountCode` default **"090"**, `feeAccountCode` default **"404"**), `PartialPostError`, `BooksAdapter` | One wallet account for every token, network and address. `overpaymentAccountCode` is unused (kept for old files) |
| `rules.ts` | `planPosting()` and helpers `cmp`, `floorCents` (round down to cents), `toCents` (half up), `idempotencyKeyFor` (sha256 of request id + kind/amount/observationKey/accountCode per line, `clearline-<32 hex>`), `parPrice`, `DEPEG_LIMIT = "0.005"` | **Line 137:** `const day = (x) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);` = the UTC date (the posting-date bug). Falls back to `firstSeenAt` (when Clearline saw it) if block time is missing |
| `engine.ts` | `approveAndPost()` (the only write to the books), `importInvoice()`, `seedDemoBooks()` | Records a `PartialPostError`'s posted lines as posted, so a retry posts only the rest |
| `service.ts` | Server side: `activeProvider`, `adapterFor`, `planFor`, `approvePosting`, `importOpenInvoices`, `xeroStatus` | `planPosting` is always called with `{ threshold: CONFIRMATIONS }` only: **no price feed is ever passed**, so every rate is par and the 0.5% depeg guard never fires in practice. QuickBooks uses a static `QBO_ACCESS_TOKEN` from the environment (no refresh) |
| `store.ts` | `FileAccountingStore` (`accounting.json`, atomic write in a lock), `MemoryAccountingStore` | |
| `providers/xero.ts` | `xeroBody()` maps lines: payment → `PUT /Payments`; fee_writeoff → `PUT /CreditNotes` (ACCRECCREDIT, NoTax, line to fee account) + `PUT /CreditNotes/{id}/Allocations`; overpayment → `PUT /BankTransactions` Type `RECEIVE-OVERPAYMENT`; note → `PUT /Invoices/{id}/History`. `Idempotency-Key: <planKey>-<i>` (allocation `-alloc`) | Sends `Date: l.date` unchanged. Amounts converted with `Number()` at the last moment (exact for 2-dp amounts). No `CurrencyRate`, no 429/`Retry-After` handling, no Organisation read. Sets `Reference` on RECEIVE-OVERPAYMENT, which Xero's spec says is only supported for SPEND and RECEIVE (see `xero-api.md`) |
| `providers/xero-auth.ts` | OAuth 2.0 code flow; `DEFAULT_SCOPES = "openid profile email offline_access accounting.transactions accounting.contacts.read"`; token refresh in a file lock; tokens in `<dataDir>/xero-tokens.json` | No `accounting.settings.read`, so it **cannot read `GET /Organisation`** (Timezone, BaseCurrency, lock dates). File is written by `writeAtomic` with default mode → 0644 (SECURITY_GAPS #6). Token-endpoint errors deliberately don't echo the body. The refresh lock is `withLock` from `src/lib/lock.ts`, which is **in-process only** ("They don't span processes: run one server process per data directory"): two server processes can both refresh and one loses the rotated refresh token |
| `providers/quickbooks.ts` | payment → `POST /payment` linked to the invoice; fee_writeoff → `POST /creditmemo` + `POST /payment` of 0 linking memo and invoice; overpayment → `POST /payment` with no Line (unapplied credit); note → folded into the next payment's `PrivateNote`. `?minorversion=75&requestid=<key>` | `TxnDate: l.date` unchanged (same UTC bug). Header says "[ASSUMPTION] not yet run against a sandbox company" |
| `providers/demo.ts` | Fictional "Northwind Pay Pte Ltd" books inside Clearline's data file | Rejects a payment larger than the amount due; used by every demo test |
| `providers/netsuite.ts` | Interface only; throws "isn't built yet" | Design notes in the header |
| `src/app/api/accounting/[id]/route.ts` | `POST {actor, key}` → `approvePosting` | No CSRF/Origin check; the key is recomputable (SECURITY_GAPS #2) |
| `src/app/api/accounting/xero/{connect,callback}` | OAuth start (state cookie, httpOnly, 10 min) and callback (state must equal cookie) | Picks the first `tenantType === "ORGANISATION"` |
| `src/lib/decimal.ts`, `src/lib/payments/money.ts` | `compareDecimal`, `isZero`; `add`, `sub`, `eq`, `mulBps` on exact decimal strings (BigInt) | Use these. Never `parseFloat`/`Number` for money arithmetic |

## Tests
- `tests/accounting.test.ts`: 23 `it(...)` cases in 5 describes (posting rules; approval, idempotency and
  audit; Xero and QuickBooks request shapes; helpers; demo books).
- Branch `bug/xero-posting-date-timezone` (commit `a3bde16`): `tests/posting-date-timezone.test.ts`,
  **17 `it.fails`** (5 instants × payment / short note / fee write-off = 15, plus Xero and QuickBooks
  payload checks). The seam it expects: `PlanOptions.orgTimeZone?: string` (IANA, e.g. `Asia/Singapore`),
  used in `day()`. Cases: 23:59 SGT 30 Oct → 30 Oct; 00:00 SGT 31 Oct → 31 Oct; 07:59 SGT 31 Oct → 31 Oct;
  07:30 SGT 1 Nov → 1 Nov (month end); same instant for `America/New_York` → 31 Oct; each also checked
  against `Pacific/Kiritimati` so a hard-coded zone can't pass.

## Behaviour measured with the probe (real `planPosting`, invoice in USD, block time 2026-10-30T23:59Z = 07:59 SGT 31 Oct)
| Case | Status | Lines (kind, amount, account, date) |
|---|---|---|
| Exact 1,000.00 | ready | payment 1000.00 · 090 · **2026-10-30** (UTC; SGT date is 31 Oct) |
| 4,950.00 of 5,000.00 | ready, leaves open | payment 4950.00 · 090; note 0 |
| same, accept_short | ready | payment 4950.00 · 090; fee_writeoff 50.00 · 404 |
| 1,000.50 of 1,000.00, no decision | needs_decision | payment 1000.00; overpayment 0.50 · 090 |
| 1,000.004 of 1,000.00 | **needs_decision** | payment 1000.00; **overpayment 0.00** · 090 (a zero-value overpayment that still blocks for a decision) |
| 999.995 of 1,000.00 | ready, leaves open | payment 999.99; note says "short by 0.005" while Xero would show **0.01** due |
| 99.995 of 100.00, accept_short | ready | payment 99.99; fee_writeoff 0.01 (closes exactly) |
| 333.333333 + 666.666667 of 1,000.00 | ready | payment 333.33; payment 666.67 (running-total floor; sums to 1000.00) |
| Duplicate 1,000 + 1,000 | needs_decision → refund_excess: ready | payment 1000.00; overpayment 1000.00 "To refund" |

## Known gaps (accounting), numbered for `docs/POSTING_RULES.md` §8
D1 UTC posting date (rules.ts:137; Xero `Date`, QBO `TxnDate`). D2 sub-cent overpayment makes a 0.00 line
and blocks for a decision. D3 sub-cent shortfall: Clearline text and the Xero balance disagree. D4 no price
feed: par always, depeg guard inert. D5 block time missing → falls back to first-seen time. D6 no Organisation
read: no BaseCurrency, Timezone or lock-date check; no `accounting.settings.read` scope. D7 RECEIVE-OVERPAYMENT
`Reference` may be ignored by Xero. D8 one wallet account for every token/network/address. D9 no 429/Retry-After
handling. D10 QBO static access token (1 h life). D11 approval forgeable cross-site (SECURITY_GAPS #2). D12 Xero
tokens 0644 (#6). D13 posting gate is 12 confirmations from `latest`, not Ethereum `finalized`. D14 apps created
after 2 Mar 2026 may not get `accounting.transactions` [ASSUMPTION: secondary, Apideck/Xero devblog search summary].
