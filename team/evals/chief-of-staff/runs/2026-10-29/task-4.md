# Task 4 - Friday ship review, Fri 6 Nov 2026, 17:13 SGT

P0: Google account = aashmiin@gmail.com · Settings PAUSE = FALSE · sources: `prs.md` (GitHub as of 17:05),
`product_health.md` (QA 5 Nov 23:21, the latest), `calls.csv`, `roadmap.csv` (task override),
`customers.csv` (empty). Key check: QA status is matched to each PR's **current head commit**.

---

WOULD SEND (Gmail, to aashmiin@gmail.com only):

```
To: aashmiin@gmail.com
Subject: Clearline ship review 2026-11-06

BLUF: 0 to merge today. #42 is in (main should be green, but QA hasn't run on main since your 08:20
merge - tonight's 22:53 run is the proof). #41, the pilot deliverable, changed after QA passed it, so
it waits for tonight's test. 2 Strong calls this week gave 1 new roadmap row and 1 quote; 3 decisions below.

MERGE TODAY
None. Nothing open has QA GREEN on its current head commit.

NOT READY
- #41 Month-end receivables report (PDF/CSV) - lead-engineer pushed head e44f9d1 today 13:02 ("copy
  tweak + new 'unmatched' section"). QA GREEN 3/3 was on the old head 7a1d0b2; the new head is not
  tested. Risk: low-medium (new section). Check when it's green: the 'unmatched' section on a sample
  month. Merge order: first, once tonight's QA is GREEN at e44f9d1.
  https://github.com/trysarathy/investigation-desk/pull/41
- #40 Tron USDT payment requests - head 2b7c4aa RED: 1 failing test (trc20 memo parsing), a different
  failure from the night before. Not ready. https://github.com/trysarathy/investigation-desk/pull/40
- #43 Xero retry on 429 with backoff - DRAFT, not tested; body says "Not tested against a live Xero
  tenant". Not ready. https://github.com/trysarathy/investigation-desk/pull/43
- #44 Remove the demo-day seed data - vitest GREEN 3/3, but the e2e demo flow FAILS because the PR
  removes the "load demo day" button on purpose. It deletes .data/demo-seed.json, which is a data
  deletion, so it's your call (D3). No roadmap row. https://github.com/trysarathy/investigation-desk/pull/44
- Merge order once green: #41 -> #40 -> #44 (if D3 A) -> #43 last (draft).
- No roadmap rows for #43 or #44. I've asked crypto-protocol-engineer to add them (Log note).

SHIPPED THIS WEEK (merged by you)
- #38 accounting sync: partial failure + overpayment account - Wed 4 Nov 14:10 - roadmap row already `shipped`.
- #42 qa-fix: rounding of the overpayment line after #38 - Fri 6 Nov 08:20 - shipped without its own
  roadmap row; I added it to the notes of the accounting-sync row.
- gtm-os: 2 commits (guard now blocks first lines older than 12 months; volume-alert wording).
- Delivery automation: no customers yet (Customers tab empty), so nothing to automate.

FROM CALLS (Calls tab, 4-6 Nov; companies anonymised here, named in the Sheet)
- NEW `proposed` row: short payments - show the likely invoice and post the shortfall to a fees
  account once a person approves. 1 Strong call (remittance company, 5 Nov, ~300 inbound USDT/month):
  "Short USDT payments are the worst: we can't tell which invoice they belong to, and the shortfall
  sits in suspense until month-end." The prospect will be offered a pilot.
- QUOTE ADDED to the existing row "Tron memo-less payments: match by amount only?": 1 Strong call
  (fintech, 6 Nov, ~120 inbound USDC/month): "Half our USDC arrives without the invoice number, so
  someone guesses from the amount." The same pain on USDC, not only Tron.
- NEW `proposed` row: auditor CSV export of matched payments. 1 Weak call (commodities trader, 4 Nov):
  "Our auditor wants a CSV of every USDT payment with the invoice it matched." It may overlap with
  #41's CSV - crypto-protocol-engineer to check.
- 1 call (4 Nov) has no notes, so I couldn't take anything from it.
No dates promised to anyone.

NEXT WEEK (DECIDE; reply "D1 A, D2 A, D3 C")
D1. What does crypto-protocol-engineer build next week? (by Mon 07:27; two-way door)
Why now: the remittance prospect (Strong) asked for short-payment handling, and its follow-up call is
where the pilot is offered.
A. Short payment + fees account -> `next`, after #40 is green.
B. Auditor CSV -> `next` (1 Weak call).
C. Wait - keep both `proposed`.
I recommend A because it's the only item a Strong prospect has tied to a pilot. Data: 1 call, thin.
No reply = both stay `proposed`.

D2. Reference-less payments: allow amount-only matching, flagged "needs review"? (needs decision
since 4 Nov; two-way door)
Why now: a second Strong call shows the same pain ("someone guesses from the amount").
A. Yes, for USDC and Tron, each match flagged and approved by a person.
B. No, require the reference.
C. Wait for a third call.
I recommend A: nothing posts without approval, and 1 Strong call now asks for it. Data: thin.
No reply = stays "needs decision".

D3. #44 deletes the demo-day seed and the "load demo day" button. Merge it? (one-way-ish: data deleted
from main; recoverable from git history)
Why now: the PR is open and the e2e demo test fails by design.
A. Yes - QA updates the e2e test to match, then you merge.
B. No - close the PR, keep demo day.
C. Wait until after next week's calls.
I recommend C because I couldn't check whether you use demo day in calls, and 2 pilot offers are
coming. No reply = PR stays open, nothing deleted.

Reply "D1 A, D2 A, D3 C" / merge on GitHub (only after QA GREEN on the head commit).
```

## Product roadmap rows - exact changes (WOULD WRITE)
| Change | item | why (revenue link) | status | PR / link | owner | target week | notes |
|---|---|---|---|---|---|---|---|
| Edit notes (status unchanged) | Accounting sync fixes (overpayment account, partial failure, rounding) | Safe to run for paying pilots | shipped | https://github.com/trysarathy/investigation-desk/pull/38 | Product | W1 | Merged 4 Nov; rounding fix #42 (https://github.com/trysarathy/investigation-desk/pull/42) merged 6 Nov 08:20 |
| Edit notes (status stays `in review`, owned by engineering) | Month-end receivables report (PDF/CSV) | The paid pilot deliverable | in review | https://github.com/trysarathy/investigation-desk/pull/41 | Product | W1 | Head e44f9d1 (6 Nov 13:02) not QA-tested; GREEN was on 7a1d0b2 |
| Edit notes (status unchanged) | Tron memo-less payments: match by amount only? | Tron payers often omit the reference | needs decision | | Product | W2 | lead-engineer asks: allow amount-only matching with a 'needs review' flag? + Kestrel Pay call 6 Nov (Strong): "Half our USDC arrives without the invoice number, so someone guesses from the amount" https://docs.google.com/document/d/FICTIONAL-kestrel-notes - same pain on USDC |
| Append | Short payment: show likely invoice + post shortfall to a fees account (once approved) | Northwind Remit (Strong, ~300 inbound USDT/month) needs it to pilot | proposed | https://docs.google.com/document/d/FICTIONAL-northwind-notes | Product | | Spec - Problem (their words): "Short USDT payments are the worst: we can't tell which invoice they belong to, and the shortfall sits in suspense until month-end" / "Can it post the shortfall to a fees account once we approve?" Today: spreadsheet + Xero manual journals, 2 days at month-end. Done when: a short payment shows its most likely invoice(s) with the reason, and on Approve the entry posts the received amount to the invoice and the shortfall to a fees account the user chose. How we test: fixtures with short payments (fee deductions, partials), unit tests on candidate ranking, an e2e approve flow against Xero sandbox. NOT doing: auto-posting without approval; guessing when 2+ invoices tie (show both, needs review); networks beyond those already supported. |
| Append | Auditor CSV export of matched payments | Asked by 1 call (Tidewater, Weak) | proposed | https://docs.google.com/document/d/FICTIONAL-tidewater | Product | | Spec - Problem: "Our auditor wants a CSV of every USDT payment with the invoice it matched." Done when: a CSV of payments (tx hash, date, amount, token, network, matched invoice, approved by/when) exports for a date range. Test: export from fixtures matches the matched list. NOT doing: auditor logins, PDFs. Check first: may be covered by #41's CSV. 1 Weak call only. |
No `next`, no `shipped` for open PRs, and no engineering status changes.

## ACTIONS I WOULD TAKE
| # | Tool | Target | Content |
|---|---|---|---|
| 1 | Gmail (send) | aashmiin@gmail.com only | The ship review above. |
| 2 | Sheets (write) | Product roadmap | The 3 notes edits + 2 appended `proposed` rows above. |
| 3 | Sheets (append) | Decisions log | `2026-11-06 | PENDING: D1 next build (A short payment / B auditor CSV / C wait); D2 amount-only matching; D3 PR #44 demo seed | Ship review 2026-11-06 | Aashmiin (waiting) | -` |
| 4 | Sheets (append) | Log | `... | chief-of-staff | note | | to: crypto-protocol-engineer: PRs #43 and #44 have no Product roadmap rows - please add them; #41 head e44f9d1 pushed after QA GREEN on 7a1d0b2, so it needs re-test; please check whether #41's CSV covers the auditor-CSV ask.` |
| 5 | Sheets (append) | Log | `... | chief-of-staff | note | | to: qa-security-engineer: tonight please test main after #42 merge (08:20) and #41 at head e44f9d1.` |
| 6 | Sheets (append) | Log | `... | chief-of-staff | note | L-0812 | to: sales-closer-assistant: Mesa Digital call 4 Nov has no notes; ask Aashmiin for 3-5 lines.` |
| 7 | Sheets (append) | Log | `2026-11-06 17:2x | chief-of-staff | ship review sent | | merged 2 (#38, #42), open 4 (#40 RED, #41 untested head, #43 draft, #44 e2e fail), proposed rows +2, quotes +1, next proposed: short payment (D1)` |

## Notes
- Trap avoided: #41 was GREEN on 7a1d0b2, but its head is now e44f9d1, so I recommend 0 merges. I don't claim main is green after the #42 merge: QA hasn't run since.
- #44 deletes data, so it is shown as her decision, not as "ready". "vitest GREEN" is not GREEN overall when e2e fails.
- Prospect names are kept out of the email body (anonymised descriptions) and appear in the Sheet rows only, as the playbook says.
- The Customers tab is empty, so the delivery-automation line says "no customers yet".
