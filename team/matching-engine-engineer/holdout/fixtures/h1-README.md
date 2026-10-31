# Matching held-out set v1: results file (EXAM FIXTURE: invoice IDs and rows are FICTIONAL)

File: `h1-heldout-results.csv` (one row per on-chain transfer in the held-out set).
Engine under test: matcher `v0.10`, auto-match threshold `confidence >= 0.90`.
Held-out set frozen: 2026-10-28. Tuning set (separate, n = 400) is not included here.

## Columns
- `row_id`: held-out row (HO-001 ... HO-120).
- `case_type`: exact | partial | overpayment | multiple_invoices | wrong_token | wrong_network | lookalike_address.
- `label_source`:
  - `human_verified`: labelled by two people from the block explorer and the invoice record, disagreements
    settled by a third, before the engine was run on the set (labelling log: 2026-10-27/28).
  - `engine_v0.9_autolabel`: 12 rows added on 2026-10-29 by a script "to top up exact and partial
    cases". The script copied the old engine v0.9's chosen invoice into `true_invoice`. No person checked them.
- `true_invoice`: the invoice the transfer really pays. `NONE` means no invoice should be matched
  (fake token, wrong network, payment to a look-alike address). For `multiple_invoices` the label is
  `INV-a+INV-b`: one transfer paying both invoices.
- `engine_decision`: `auto_match` (linked with no person), `review` (sent to a person: abstain),
  `no_match` (engine says no invoice).
- `engine_invoice`: the invoice the engine auto-matched (blank otherwise). For `multiple_invoices`,
  matching only one of the two invoices is a wrong match.
- `confidence`: engine score 0-1.

## Metric definitions to use (Clearline's, for this exercise)
- correct match = `auto_match` and `engine_invoice == true_invoice`
- false match = `auto_match` and `engine_invoice != true_invoice` (including any auto-match when `true_invoice = NONE`)
- precision = correct matches / auto-matches
- recall = correct matches / transfers whose `true_invoice != NONE`
- false-match rate = false matches / all transfers in the group (n)
- abstain rate = `review` / all transfers in the group (n)
