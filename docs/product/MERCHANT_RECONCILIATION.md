# Merchant Reconciliation (rc6)

Test mode · illustrative data.

## The problem

A merchant paid in USDT or USDC through a stablecoin checkout provider has to reconcile four records:
- **the chain:** what arrived, on which network and token, and when it became final;
- **the provider's record:** its status claim, the credited fiat, the executed rate, the fee and the batch;
- **the bank line:** the settlement credit, often netted and spanning day boundaries;
- **the merchant's order or invoice.**

"Completed" from any party is a claim, not proof. Clearline is a **read-only** layer that matches the four records and explains every difference with a type and a reason. It routes whatever is left to a named person, with the evidence, and **proposes** journal entries that a different person approves. Posting rules are **pending sign-off**.

## The three cases

Every figure is asserted in the tests. See `docs/MATCHING_RULES.md` and `docs/POSTING_RULES.md`.

1. **Amount differences:** a Singapore entity in SGD, batch B-1124-001, net 5,961.24.
   - BK-24817: a sender-side fee, with a write-off proposed.
   - BK-24823: an underpayment, with 324.00 still owed.
   - BK-24830: an overpayment, giving a liability of 145.80.
   - BK-24836: a re-quote after expiry, sent for review.
   - The two SGD 1,350.00 orders are never cross-matched.
2. **One settlement, many payments:**
   - the bridge runs from 44,412.30 (merchant day) to 41,862.30 gross (31 payments) to 40,228.68 net, which equals the bank credit;
   - the USD batch nets to 9,355.50;
   - BK-24871 is held, and routed to Treasury.
3. **Partial payment across chains:** a UAE entity in AED, two payment links, TRON USDT and Ethereum USDC.
   - The gap of 14.16 is a 12.86 shortfall plus a 1.30 rate difference.
   - The balance shows "part paid" between the parts, never "overdue".
   - **Tolerance-policy decision pending:** under the default policy this is an `exception`; see `docs/MATCHING_RULES.md`, Case 3.

## Screens (pilot, behind sign-in, white-labelled; "powered by Clearline" in small print)

| # | Screen | Route |
|---|---|---|
| 1 | Daily report ("4 payments · 1 settlement tied · 2 exceptions · 1 write-off awaiting approval"; cut-off "provider day = UTC") | `/control/merchant` |
| 2 | Payments list (filters and search) | `/control/merchant/payments` |
| 3 | Payment detail (five records side by side, rule, differences, timeline, audit) | `/control/merchant/payments/[orderId]` |
| 4 | Exceptions queue (owner, age, reason, next step; propose a resolution) | `/control/merchant/exceptions`, `/control/merchant/exceptions/[id]` |
| 5 | Batch bridge (waterfall, every line clickable) | `/control/merchant/batches/[id]` |
| 6 | Approvals (a different approver, hash-bound) | `/control/merchant/approvals` |
| 7 | Month-end (receivable from the provider, aged exceptions, FX note, journals) | `/control/merchant/month-end` |
| 8 | Evidence pack (PDF, CSV and JSON per payment and per month) | `/control/merchant/evidence` |
| 9 | Accounting export (preview; file for the sandbox/demo company; pending sign-off) | `/control/merchant/accounting` |
| 10 | Provider: merchants and health (aggregates) | `/control/merchant/provider` |
| 11 | Provider: onboarding (mapping, proposed policy, Viewer invitations, theme) | `/control/merchant/provider/onboarding` |
| 12 | Pilot metrics (auto-match %, wrong matches in a reviewed sample, exceptions per 100, time to resolve, batches tied, minutes log) | `/control/merchant/provider/pilot` (provider), `/control/merchant/pilot` (merchant) |
| — | Public case demo (no login) | `/clearline/cases` |
| — | Case Reconstruction (local CLI plus pilot viewer) | `npm run reconstruct`, `/control/merchant/reconstruct` |

Screenshots for slide 7 of the provider deck are in `docs/product/screenshots-rc6/`:
- `1440-01-daily-report-summary.jpg`
- `1440-02-exception-opened.jpg`
- `1440-06-journal-entries-preview.jpg`

Each has a 390 px version.
