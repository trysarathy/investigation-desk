# Changelog

Plain-English notes for every merged change, newest first (company/OPERATING_MODEL.md §2 item 8).
Each entry: date, PR link, one paragraph a finance controller can understand: what changed, why, and
anything they need to do.

## Unreleased

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
