# Matching rules — merchant reconciliation (rc6, updated in rc7 and rc8)

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
| 1 Identity | `M1.chain.unavailable` (rc7), `M1.identity.unknown_token`, `M1.identity.lookalike_token`, `M1.identity.network_disabled`, `M1.finality.pending` | A token is identified by **(network, contract)**, never by symbol. A transfer is ignored until it is final on its network (TRON 19, Ethereum 12 [ASSUMPTION]). A disabled network, an unknown contract or a look-alike becomes an exception. If chain data cannot be read, the order is an exception and nothing is assumed (rc7). | Any "USDT" on another contract becomes an exception |
| 2 Reference first | `M2.reference.unattributed`, `M2.reference.no_chain_transfer`, `M2.reference.provider_ref_mismatch` | A transfer links to its order **only** through the order's quote ID, payment link or deposit address. **The sender never decides, and neither does the amount.** | Case 1: the two SGD 1,350.00 orders never cross-match, in any arrival order |
| 3 Checks | `M3.currency.*`, `M3.direction.outbound`, `M3.window.before_quote`, `M3.window.after_expiry_no_requote`, `M3.quote.invoice_mismatch`, `M3.provider.no_record`, `M3.provider.received_mismatch`, `M3.batch.unknown_batch`, `M3.batch.held_by_provider`, `M3.quote.terms_unknown` (rc7), `M3.provider.transfer_ambiguous` (rc7) | Currency, direction, time window, the provider record and the settlement batch. Missing quote terms or an ambiguous claimed transfer stop the order (rc7). | Case 2: BK-24871 is shown as completed but is in no settlement, so it becomes an exception owned by Treasury |
| 4 Explained tolerance | `M4.tolerance.sender_side_fee`, `underpayment`, `overpayment`, `requote_after_expiry`, `rate_difference`, `unexplained`, `within_band`, `explained_outside_band`, `underpayment_beyond_band`, `overpayment_beyond_band`, `writeoff_threshold`; `M4.partial.balance_link_open`; `M4.provider.credit_mismatch`; `M4.match.no_difference`; `M4.exact.no_quote_terms` (rc8) | Typed items first, then comparison with the band (below) | See the cases below |
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

- **Band (founder decision, rc7):** `band = max(tolerance_bps × invoice, fixed amount)` per entity. The defaults are 50 bps and a fixed amount per currency: SGD 5.00, USD 5.00 and AED 20.00. An Admin can edit them, and can set `tolerance_combine = 'smaller'` to use `min(…)` instead.
- **Inside the band**, with only typed differences: `matched_with_difference`, plus a write-off proposal, if the amount is at or below the write-off threshold. The threshold defaults to the same fixed amount per currency [ASSUMPTION]. Above the threshold, the order goes to `suggested_for_review`.
- **Outside the band but explained:** `suggested_for_review`. An under- or overpayment beyond the band is an `exception`.
- **Imported bank lines** (`csv_import`, and in rc7 `file_import` from CSV, XLSX, MT940 or camt.053 uploads) never make settlement verified on their own unless `allow_imported_bank_lines_as_verified` is on. It defaults to off, and the decision is the founder's (decision 2: it stays off).

## rc7 rules (added in PRs #140, #149 and #152)

Each rule's own test fails when only that rule is disabled; the runs are listed in `docs/release/TEST_RESULTS_RC7.md`.

| Rule | Step | Outcome and owner | What it means |
|---|---|---|---|
| `M1.chain.unavailable` | 1 | `exception`, Payment Operations | Chain data for the order's deposit address or transaction could not be read. The source, time and reason are recorded. Nothing is treated as received or missing; the order is never matched, written off or closed. Clearline retries on the next run. A provider claim that no read has covered also counts as unavailable, never as "nothing arrived". Other orders reconcile unchanged. |
| `M3.quote.terms_unknown` | 3 | `suggested_for_review`, Payment Operations | The files do not give a quote term the order needs: rate, quoted amount or window. The engine **abstains**. Nothing is derived and no rate is invented. The provider's credit is still checked first; an unexplained credit difference stops the order at step 4 instead. Next step: upload an export with the quote terms. |
| `M3.provider.transfer_ambiguous` | 3 | `exception`, Payment Operations | The provider names a tx hash without a log index, and several transfers in that transaction reach the order's address. Clearline does not choose. With exactly one match, that transfer is used. A missing log index is never assumed to be 0. |
| `J.settlement.refund_netted` | journal | proposal, `pending_sign_off` | A refund netted inside a verified settlement gets its own entry: Dr Sales refunds / Cr Provider clearing (Document A, Case 2: 1,215.00). See `docs/POSTING_RULES.md`. |

**What this meant for real files in rc7 [VERIFIED in #152 and the blind test].** Exports that carry no quote rate or quote window were abstained on, not auto-matched. In the blind test this gave 0 wrong matches and a 0.00% auto-match rate (1,895 of 1,952 payments abstained). rc8 adds founder decision 1 below.

## rc8: founder decision 1 — an exact payment closes without quote terms

| Rule | Step | Outcome | What it means |
|---|---|---|---|
| `M4.exact.no_quote_terms` | 4 | `matched` (then step 5 as usual) | The files give no quote terms, yet the payment is exact and linked by reference. It is checked only after the provider's credit (an unexplained credit is still an exception). |

The order closes **only when every condition holds**; otherwise it keeps its existing outcome (`M3.quote.terms_unknown`, or the exception its facts call for):

- **(a) Linked by reference.** Exactly one transfer reached a deposit address issued for the order. Exactly one provider record names the order. That record names the same quote or payment link as the address, and if it names a transaction, it names this transfer. Amount, time and sender are never used.
- **(b) A verified chain fact.** The transfer was read by Clearline's own chain client (source `chain_client`, not a fixture, a seed or a provider's claim). It is final, inbound, and on the configured contract of the order's token, so look-alikes are excluded. Chain data unavailable, a pending transfer, several transfers, or an ambiguous claimed transaction all mean no close.
- **(c) Exact amount.** The provider's credited amount equals the invoice to the minor unit, in the same currency, and the file must give the credited currency. Any difference of any size means no close. This path never gives `matched_with_difference` and never proposes a write-off.
- **Also required.** The provider claims `paid`. There is no refund line for the order, no balance payment link (part payment) and the invoice is not void. Over- and underpayments fail (c).
- **Step 5 still applies.** An untied batch is an exception. An imported bank line (flag off) or a totals-only report's proposed grouping keeps the order in review.
- **Not implemented [VERIFIED by schema]: the token-priced branch** ("the invoice is token-priced and equals the on-chain amount"). Merchant invoices are fiat only (`invoices_cur_chk`). Adding token-priced invoices needs a database migration, which rc8 does not add.
- **Unchanged.** Inputs that carry quote terms are decided exactly as before (cases 1–3 and the A+quotes pipeline variants are unchanged).
- **Proofs.** Disabling the rule, or removing guard (a), (b) or (c), makes its tests fail (`tests/clearline/merchant/rules-exact-no-terms.test.ts`, `properties-exact.test.ts`). The pipeline-truth control and the blind judge also check that every order this rule closes is one the generator's truth matches exactly.

**Payment link IDs without a requested amount (rc8 fix).** A reference column mapped as "Payment link ID" in a file with no quoted amount used to fail the whole run ("payment link … lacks the fields reconciliation needs"). The link's requested amount is now unknown, so the order abstains or gets the exception its facts call for.

**Unchanged in rc7 and rc8.** The tolerance band above (larger of 0.5% or SGD 5 / USD 5 / AED 20) was set in #140. No rc7 change loosens matching. rc8's decision 1 closes only exact payments linked by reference. An amount alone still never closes a match, and the sender never decides.

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
  - **Tolerance (decided, rc7):** under the AED default, the band is max(91.83, 20.00) = 91.83, so the result is `matched_with_difference` with a 14.16 write-off proposed. That is within the AED 20.00 write-off threshold. Under rc6's "smaller of 0.5% or 5.00", the same case was an `exception`.
  - **Fees (Document A):** 1% on each part: 110.18 on B-UAE-1201 (net 10,907.32) and 73.33 on B-UAE-1203 (net 7,260.01).
