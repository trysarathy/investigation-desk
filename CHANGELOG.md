# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## Unreleased

- **Clearline rc7: reconcile your own files from any payment provider (draft PRs #139–#156 plus the docs PR, not merged).** Reviews were not independent.
  - **Upload your own files:** provider exports as CSV, Excel (.xlsx) or JSON; settlement reports; order lists; and bank statements as CSV, Excel, MT940 or camt.053. Amounts are read exactly; anything unclear (date order, decimal separator) is asked, never guessed.
  - **Map once, reuse:** you match a file's columns to Clearline's fields once and save the mapping. Suggestions are never confirmed for you.
  - **Two people for bank statements:** an Approver who did not upload a statement must confirm it. Imported statements still never prove a settlement on their own (your decision 2).
  - **Checked against the blockchain:** payments are checked against TRON and Ethereum data (read-only, off until you add keys). If the data cannot be read, the payment goes to Payment Operations; nothing is assumed. USDT on Ethereum is added.
  - **Tolerance (your decision 1):** the larger of 0.5% or SGD 5 / USD 5 / AED 20, per entity.
  - **New rules:** chain data unavailable; quote terms missing from the file (Clearline holds back rather than guess); a provider claim that could be one of several transfers; refunds netted in a settlement get their own journal line.
  - **Runs, schedule and notifications:** every reconciliation is recorded; a daily run can be scheduled; approved or closed items are never changed by a re-run.
  - **Exports:** draft Xero and QuickBooks journal files and a month-end pack. Every row says DRAFT. Nothing is posted.
  - **Your data is kept 90 days by default** (your decision 6), then deleted with everything derived only from it. Approvals and audit records are kept. A whole merchant can be deleted on request.
  - **What to expect:** on a month in a format Clearline had never seen, there were 0 wrong matches but also 0% automatic matches, because the file had no quote rate or window. 10,000 payments ran end to end in 57.1 s.
  - **Your decisions:** hosting (not given, so nothing is hosted); whether to close exact payments when a file has no quote terms; export permissions; and the six legal questions.

- **Merchant Reconciliation for stablecoin payment providers (rc6, draft PRs #126–#137 plus the docs PR, not merged).** Test mode · illustrative data.
  - **What it does:** a provider can offer its merchants a read-only check of every USDT or USDC payment. It compares what arrived on chain, what the provider reported, what reached the bank and what the invoice said.
  - **"Completed" is not proof:** a payment is closed only when the records agree. An amount alone never closes a match.
  - **Every difference is named and explained:** for example a sender-side fee, an underpayment, an overpayment, a re-quote after expiry, a rate difference, or a payment held by the provider.
  - **Anything unclear goes to a person:** an owner, a reason and a next step.
  - **Two people for write-offs:** one person prepares a write-off and a different person approves it.
  - **Part-paid balances:** a payment split across two networks shows as "part paid", never "overdue".
  - **Settlement bridge:** each settlement batch is bridged from gross to fees to refunds to net, and must equal the bank line to the cent.
  - **Journal entries are proposals only:** they are pending your sign-off, and nothing is posted to a ledger.
  - **Providers see totals only:** they see aggregates by default. They can read a merchant's details only after that merchant grants access, and the merchant can revoke it.
  - **A public demo of three cases:** at /clearline/cases.
  - **A laptop-only tool:** it rebuilds one day of a provider's anonymised payments.
  - **Your decisions:** Case 3's tolerance policy, whether imported statements may verify settlement, the posting rules, and the six legal questions (still missing). Until you decide, nothing changes for you.

- **Clearline Control: a signed-in, saved version for private staging (rc5, draft PRs #117–#124, not merged).**
  - **Saved, separate data:** payment investigations are now saved in a database, and each organisation sees only its own data.
  - **Real sign-in:** people sign in with their own accounts.
  - **Two people for a resolution:** one person proposes a resolution with its evidence, and a different approver approves exactly that version.
  - **Two people for statement imports:** an uploaded bank statement file becomes evidence only after a second person checks the lines it contains.
  - **Redwood Supplies (fictional) still shows unpaid:** the payment is shown as returned, net 0.00, supplier still unpaid, even after the case is resolved.
  - **Fictional data only:** everything uses fictional data; nothing is hosted, no real bank, provider or ledger is connected, and no money moves.
  - **Public demo unchanged:** the public demo at /clearline is not affected. Nothing to do on your side.

- **Accessibility checks now really run in CI, and the one problem they found is fixed** (rc5, split out of [#112](https://github.com/trysarathy/investigation-desk/pull/112), not merged). The accessibility checker (axe) was never installed in CI, so those checks were skipped or failed. It is now a fixed part of the test setup, and a missing checker fails the test instead of being skipped. With it running, it found that the sidebar "clearline." logo link announced a different name from the word on screen, which breaks voice control ("click clearline"). The link now announces "clearline console overview". Nothing to do on your side.

- [VERIFIED — `docs/OWED_LEDGER.md`] A synthetic CSV replay exports open customer advances and repayment exceptions. It keeps importer cash receipts separate from provider repayments and leaves mismatches unapplied. Run `npm run owed-ledger` with the documented fixture; no live bank or ERP connection is included.

## 2026-11-01
- **The At a glance screen no longer says payments are paid automatically outside the demo.** Automatic marking is a demo-only rule, but the live screen showed a "Paid automatically" tile, a "time saved" estimate and the line "Every payment is matched, checked and explained". In live mode the tile now reads "Checked and ready to mark paid" (payments waiting for you), the time-saved estimate is gone, and the "I've asked for the balance" hint, next step and customer reply say a person marks the invoice paid: nothing is marked paid until you confirm. The demo keeps its wording, now labelled demo. Nothing to do on your side.
- **CHANGELOG started.** From today every merged pull request adds an entry here.
