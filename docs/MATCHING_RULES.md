# Matching rules — merchant reconciliation (rc6)

Test mode · illustrative data.

- **Where the engine lives:** `src/lib/clearline/merchant/` (`match.ts`, `bridge.ts`, `reconcile.ts`).
- **How it behaves:** it is pure and deterministic. The steps run in a fixed order, and every result records its **deciding step** and **rule ID**.
- **Proof:** every rule has a test that fails when only that rule is disabled (`docs/plan/RC6_RULE_PROOFS.md`).

## Outcomes
- **`matched`:** the payment ties.
- **`matched_with_difference`:** it ties within the band, with typed differences and a write-off **proposed** (a second person must approve it).
- **`suggested_for_review`:** the difference is explained but sits outside the band, or the evidence is not strong enough to close.
- **`exception`:** an owner, a reason and a next step are recorded.

## Steps

| Step | Rules | What it decides | Example |
|---|---|---|---|
| 1 Identity | `M1.identity.unknown_token`, `M1.identity.lookalike_token`, `M1.identity.network_disabled`, `M1.finality.pending` | A token is identified by **(network, contract)**, never by symbol. A transfer is ignored until it is final on its network (TRON 19, Ethereum 12 [ASSUMPTION]). A disabled network, an unknown contract or a look-alike becomes an exception. | Any "USDT" on another contract becomes an exception |
| 2 Reference first | `M2.reference.unattributed`, `M2.reference.no_chain_transfer`, `M2.reference.provider_ref_mismatch` | A transfer links to its order **only** through the order's quote ID, payment link or deposit address. **The sender never decides, and neither does the amount.** | Case 1: the two SGD 1,350.00 orders never cross-match, in any arrival order |
| 3 Checks | `M3.currency.*`, `M3.direction.outbound`, `M3.window.before_quote`, `M3.window.after_expiry_no_requote`, `M3.quote.invoice_mismatch`, `M3.provider.no_record`, `M3.provider.received_mismatch`, `M3.batch.unknown_batch`, `M3.batch.held_by_provider` | Currency, direction, time window, the provider record and the settlement batch | Case 2: BK-24871 is shown as completed but is in no settlement, so it becomes an exception owned by Treasury |
| 4 Explained tolerance | `M4.tolerance.sender_side_fee`, `underpayment`, `overpayment`, `requote_after_expiry`, `rate_difference`, `unexplained`, `within_band`, `explained_outside_band`, `underpayment_beyond_band`, `overpayment_beyond_band`, `writeoff_threshold`; `M4.partial.balance_link_open`; `M4.provider.credit_mismatch`; `M4.match.no_difference` | Typed items first, then comparison with the band (below) | See the cases below |
| 5 Grouping and bridge | `M5.batch.tied_verified`, `M5.batch.not_tied`, `M5.bank.imported_not_verified`, `M5.grouping.proposed_needs_confirmation`, `M5.bridge.timing_prior_batch`, `M5.bridge.timing_next_batch`, `M5.bridge.held_by_provider` | Payments are grouped by batch ID. A batch ties only if gross − fees − refunds = net = the bank line, to the cent. Without a batch ID, a grouping is **proposed** and never closed automatically. Step 5 only confirms or tightens a decision. | Case 2: gross 41,862.30 → net 40,228.68 |

## Difference types

| Type | Meaning |
|---|---|
| `sender_side_fee` | Received is below quoted by at most 2.000000 token units [ASSUMPTION], and the provider claims paid |
| `underpayment` | The customer paid less; the rest is still owed |
| `overpayment` | The customer paid more; the excess becomes a customer-overpayment liability |
| `requote_after_expiry` | Paid after the quote expired, and the provider re-quoted |
| `rate_difference` | The executed rate differs from the quoted rate |
| `provider_fee` | The provider's fee in a settlement |
| `refund_netted` | A refund netted inside a settlement |
| `timing_prior_batch` | Settled in an earlier batch (day boundary) |
| `timing_next_batch` | Settled in a later batch |
| `held_by_provider` | Shown as completed, but in no settlement |
| `partial_payment_open` | Part paid, with a balance link open. **Not overdue.** |
| `unexplained` | No typed explanation. Always an exception, even inside the band. |

## Tolerance policy (per entity; editable; changes are Admin-only)

- **Band:** `band = min(tolerance_bps × invoice, tolerance_abs)`. The default is 50 bps and 5.00 in the entity currency [ASSUMPTION per the founder's prompt].
- **Inside the band**, with only typed differences: `matched_with_difference`, plus a write-off proposal, if the amount is at or below the write-off threshold (default 5.00).
- **Outside the band but explained:** `suggested_for_review`. An under- or overpayment beyond the band is an `exception`.
- **Imported bank lines** (`csv_import`) never make settlement verified on their own unless `allow_imported_bank_lines_as_verified` is on. It defaults to off, and the decision is the founder's.

## The three cases (every figure is asserted in `tests/clearline/merchant/`)

- **Case 1:**
  - BK-24817 → `matched_with_difference`: sender_side_fee −1.35, write-off 1.35.
  - BK-24823 → `exception`: underpayment 12.0%, 324.00 owed.
  - BK-24830 → `exception`: overpayment 18.0%, 145.80 liability.
  - BK-24836 → `suggested_for_review`: requote_after_expiry −9.00, which is beyond the band of 5.00.
  - Batch B-1124-001: 6,021.45 − 60.21 = **5,961.24**, which equals the bank line.
- **Case 2:**
  - SGD bridge: 44,412.30 − 2,970.00 − 1,200.00 + 1,620.00 = **41,862.30** gross (31 payments). Then − 418.62 − 1,215.00 = **40,228.68** net, which equals the bank credit.
  - USD batch: 9,450.00 − 94.50 = **9,355.50**.
- **Case 3:**
  - 11,017.50 + 7,333.34 = 18,350.84. The gap of **14.16** splits into an underpayment (shortfall) of 12.86 and a rate difference of 1.30.
  - After part 1 only: an open balance of 7,347.50 as `partial_payment_open`.
  - **Policy conflict.** Under the **default** policy (band 5.00 AED) this is an `exception`, because the 12.86 shortfall is beyond the band. The fixture's UAE policy (absolute cap 100.00, so band 91.83 [ASSUMPTION]) gives `matched_with_difference`, with a 14.16 write-off proposed. This is a founder decision: "whichever is smaller" against "whichever is larger", or a per-entity policy.
