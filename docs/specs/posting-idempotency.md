# Spec: every post to Xero is idempotent (roadmap #2)

Status: DRAFT, for Aashmiin's sign-off. **Approval-only: posting to Xero/QuickBooks. Do not auto-merge.**
Failing tests: `tests/posting-idempotency.test.ts` on branch `bug/partial-post-idempotency` (commit b529bae).

## The problem in one paragraph
Today a retry after a partial post can create a second credit note (or payment, or overpayment). The key
Clearline sends Xero is made from the lines *still to post*, plus the line's position in that list. Once one
line has posted, the list is shorter, so every remaining line goes out with a new key. Xero only
recognises a repeat when the key is the same, so it makes a new record.
[VERIFIED: tests in this branch, run 2026-11-01 against main @2ec8676: retry keys differ for all five
endpoints; 2 credit notes and 2 allocations after a lost allocation response.]

## What "idempotent" means for each Xero call
One posting line = one record in Xero. Its key is fixed when the line is first planned and never changes.
It is built from: the request id + the line kind + the line's stable identity (the transfer's observation key
for payment/overpayment lines; the kind plus "shortfall" for the single fee write-off; the kind plus
"note" for the history note). It must **not** depend on which other lines are pending, their order or count,
the attempt number, or the clock.

| Line | Xero call | Same key means |
|---|---|---|
| payment | `PUT /Payments` | Xero returns the payment it already applied to the invoice; no second payment. |
| fee_writeoff | `PUT /CreditNotes` | Xero returns the existing credit note; no second credit note. |
| fee_writeoff allocation | `PUT /CreditNotes/{id}/Allocations` | Its own fixed key (the credit note line's key + "-alloc"), against the same credit note id; the shortfall is allocated once. |
| overpayment | `PUT /BankTransactions` (RECEIVE-OVERPAYMENT) | Xero returns the existing overpayment; no second one. |
| note | `PUT /Invoices/{id}/History` | One history note per request state, not repeated. |

Every PUT carries an Idempotency-Key. The plan-level key that the approval screen uses ("the plan changed
since you looked at it") can stay as it is; it is a separate thing from the per-line keys sent to Xero.

How long Xero keeps a key and its maximum length: [ASSUMPTION: not checked this run; confirm in Xero's
developer docs on idempotency before relying on a retry window].

## How a retry must behave
1. Lines already recorded as posted are not sent again.
2. Each remaining line is sent with exactly the key it had on the first attempt (same for its allocation).
3. A credit note that Xero made but Clearline did not record (response lost before the allocation) is
   re-used: the retry gets the same credit note id back and allocates it once.
4. A run after everything is in the books sends nothing and makes nothing new.
5. A line left unposted by a failure is still posted on retry. (Today the history note is dropped: after the
   payment posts and the note fails, the retry reports "posted" and never sends the note; test (d) History.)

## Unknown outcomes: read back before retrying
- **Known "not done"** (e.g. 429 rate limit, 400 validation error): Xero made nothing; retry with the same keys
  after the wait Xero asks for.
- **Unknown** (timeout, connection reset, 5xx, response lost): Clearline must not assume either way. Before the
  next attempt it reads back from Xero, e.g. `GET /Invoices/{id}` (AmountDue, Payments, CreditNotes) and
  the credit note's allocations, and records what it finds as posted (with Xero's id) before sending
  anything else. Then it retries only what is missing, with the original keys. The key protects the retry; the
  read-back keeps the audit log true.
- If the read-back itself fails or is unclear, nothing posts. The request goes to a person with what is known.

## Acceptance criteria (each is a test in `tests/posting-idempotency.test.ts`; switch `it.fails` to `it`)
- (a) After a payment posts and the credit note gets a 429, the retry does not re-send the payment and
  sends the credit note with the same key as the first attempt.
- (b) A payment whose response was lost, re-approved after a decision changed the other lines, goes out with
  the same key; Xero holds one payment.
- (c) Payment, credit note and allocation all made in Xero with the last response lost: after the retry and
  one more run, Xero holds exactly 1 payment, 1 credit note, 1 allocation.
- (d) For each of Payments, CreditNotes, Allocations, BankTransactions, Invoice History: every PUT carries a
  key, and a retry after that call failed re-sends it with the same key.
- (e) An allocation rate-limited twice uses one identical key across all three attempts, and Xero holds one
  credit note.
- The existing accounting tests stay green; `npx tsc --noEmit`, `npx vitest run`, `npx next build` green.
- The same rule applies to the QuickBooks adapter's `requestid` (follow-up, not in this change).
- Sandbox check on the Xero Demo Company only (playbook §3): force a failure after the payment, retry, read
  back one payment, one credit note, invoice AmountDue 0.00.

## Approval
This touches posting to Xero, so it is approval-only: separate code review, QA, then Aashmiin merges. No
auto-merge.
