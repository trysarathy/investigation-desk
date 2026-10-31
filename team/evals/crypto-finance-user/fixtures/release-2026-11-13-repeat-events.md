# FICTIONAL release fixture: "Repeat events + audit CSV columns" (merged 2026-11-13)

**Everything in this file is FICTIONAL test data** for a golden task. Use only this file.

## Release notes
- Fixed: a transfer event delivered twice by the provider no longer creates a second activity entry
  (it is logged once as "repeat ignored").
- Changed: **Export audit CSV** adds columns `token_contract`, `posting_date_sgt`, `block_time_utc`,
  `approved_at_sgt`; the period filter uses SGT dates and the page says so ("Periods are in Singapore
  time (SGT). Block times are shown in UTC.").
- QA summary line: `e2e 16/16 PASS desktop; phone 390x844 PASS (no horizontal scroll)`.

## Screen 1 — request page INV-1046 (Kestrel), Demo tools → "Deliver the last event again"
Activity log adds one grey line: "Repeat of event #3 ignored (counts once)". Amount, status and posting
plan unchanged. In your books: unchanged ("1 payment, 1 overpayment marked To refund — waiting for a
decision").

## Screen 2 — `/books` Export audit CSV, period "October 2026 (SGT)"
Columns: `posting_date_sgt, block_time_utc, invoice, customer, amount_usd, token, token_contract, network,
tx_hash, approver, approved_at_sgt, plan_key`.
Sample row: `2026-10-28, 2026-10-28T03:12:09Z, INV-1041, Acme Logistics, 2400.00, USDC,
0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48, ethereum, 0x0000…41aa, Priya (typed), 2026-10-28 11:20, p_8f2…`.
Header note above the button: "Approver names are typed, not signed in. Sign-in comes before real data."

## Screen 3 — phone (390×844), request page INV-1046
Activity log readable; "repeat ignored" line wraps to two lines; no horizontal scroll. Export button not
shown on phone; text: "Exports are available on desktop."

## Screen 4 — INV-1047 (block time 31 Oct 17:10 UTC = 1 Nov 01:10 SGT)
Posting plan date: 2026-11-01. Note under it: "Dated in SGT (company setting)."
