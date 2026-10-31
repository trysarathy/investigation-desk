# FICTIONAL release fixture: "Books v2" (merged 2026-11-06)

**Everything in this file is FICTIONAL test data** written for a golden task. The release, screens,
companies, amounts and hashes are invented. Use only this file; do not run the app for this task.

## Release notes (as written by the engineer)
- New: **Approve all ready** button on `/books`: approves every payment request whose posting plan is
  `ready`, in one click.
- New: posting date on each line = the transfer's block date.
- New: success message after posting.
- New: **Export audit CSV** on `/books` (period filter).
- Fixed: plan-changed refusal now shows the new plan inline.
- QA summary line: `e2e 16/16 PASS (desktop 1280x720); phone layout not in this run`.

## Screen 1 — `/books` (desktop, 1280×720), after "Load the demo day"
Header: "In your books — Xero (Demo Company) connected".
Banner: none.
Table "Ready to post (12)": columns Customer · Invoice · Amount · Lines · Status.
- 11 rows show `Lines: 1` (payment).
- Row "Brightline Studio · INV-1042 · 4,950.00 USDC · Lines: 2 · Ready". The two lines are only visible
  after clicking the row: "Payment 4,950.00" and "Fee write-off 50.00 → account 404".
Button (blue, top right): **Approve all ready (12)**. No confirmation dialog. Approver field: a text box
"Your name" pre-filled with the last name typed ("Priya").
Below: "Never posted (3)": Orbit Retail (counterfeit USDT), Meridian (wrong network), Kestrel second
transfer (duplicate → overpayment line, waiting for decision). Each shows a grey "Never posted" or
"Waiting for a decision" label. No approve button on these rows.
Button: **Export audit CSV** with a "Period" picker defaulting to "This month".

## Screen 2 — request page `INV-1047` (Harbour Freight), section "In your books"
"Received: 1 Nov 2026, 01:10 SGT (block time 31 Oct 2026 17:10 UTC)".
Posting plan:
| Line | Date | Account | Amount | Reference |
|---|---|---|---|---|
| Payment | 2026-10-31 | Wallet (USDC) 090 | 1,200.00 | tx 0x0000…9a1f · USDC · Ethereum · par |
Button: **Approve and post**.

## Screen 3 — after clicking Approve all ready (12)
Green toast for 4 seconds: "✓ 12 payments posted to Xero automatically".
Audit log (`/books`, lower section) shows 12 rows: time (SGT), request, "posted", approver "Priya".

## Screen 4 — Export audit CSV (October)
Columns: `posted_at_sgt, invoice, customer, amount_usd, tx_hash, network, approver`.
Rows: 14 (all postings with posting date in October, including INV-1047).

## Screen 5 — phone (390×844), `/books`
The "Ready to post" table scrolls horizontally; the "Lines" column is off-screen to the right on load.
**Approve all ready (12)** is a full-width sticky button at the bottom of the screen.
Tapping a row opens it, but the line detail table is cut off at the "Account" column.

## Screen 6 — request page INV-1043 (Orbit Retail, counterfeit USDT)
"In your books: Never posted. The token's contract (0x0000…dead) is not Tether's USDT contract on
Ethereum." No approve button. Evidence shows both contracts side by side.

## Screen 7 — plan changed
On INV-1044 a second transfer arrived while the page was open. Clicking **Approve and post** shows:
"The plan changed since you opened this page. Here is the new plan:" with the new lines inline, and
"Approve this plan" button. Nothing posted until clicked again. Audit log row: "approval refused: plan
changed".
