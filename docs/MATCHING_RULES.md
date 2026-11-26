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
| 4 Explained tolerance | `M4.tolerance.sender_side_fee`, `underpayment`, `overpayment`, `requote_after_expiry`, `rate_difference`, `unexplained`, `within_band`, `explained_outside_band`, `underpayment_beyond_band`, `overpayment_beyond_band`, `writeoff_threshold`; `M4.partial.balance_link_open`; `M4.provider.credit_mismatch`; `M4.match.no_difference`; `M4.exact.no_quote_terms` (rc8); `M4.exact.token_priced`, `M4.token_priced.*` (v1 draft) | Typed items first, then comparison with the band (below) | See the cases below |
| 5 Grouping and bridge | `M5.batch.tied_verified`, `M5.batch.tied_evidence_separate` (v1 Phase 0.5), `M5.batch.not_tied`, `M5.batch.currency_mismatch` (v1 decision 9: a batch is tied in its own currency, e.g. a USD account's under an SGD entity; a payment or bank line in another currency is an exception, never converted), `M5.bank.imported_not_verified`, `M5.grouping.proposed_needs_confirmation`, `M5.bridge.timing_prior_batch`, `M5.bridge.timing_next_batch`, `M5.bridge.held_by_provider` | Payments are grouped by batch ID (from per-line settlement rows, or v1 per-payment settlement files, by payment ID). A batch ties only if gross − fees − refunds = net = the bank line, to the cent. Without a batch ID, a grouping is **proposed** and never closed automatically. Step 5 only confirms or tightens a decision. | Case 2: gross 41,862.30 → net 40,228.68 |

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
| `price_token_mismatch` | v1 draft: a token-priced invoice paid in another token or on another network (always review) |
| `price_token_amount` | v1 draft: a token-priced invoice paid with a different token amount, in signed base units (always review) |

## Tolerance policy (per entity; editable; changes are Admin-only)

- **Band (founder decision, rc7):** `band = max(tolerance_bps × invoice, fixed amount)` per entity. The defaults are 50 bps and a fixed amount per currency: SGD 5.00, USD 5.00 and AED 20.00. An Admin can edit them, and can set `tolerance_combine = 'smaller'` to use `min(…)` instead.
- **Inside the band**, with only typed differences: `matched_with_difference`, plus a write-off proposal, if the amount is at or below the write-off threshold. The threshold defaults to the same fixed amount per currency [ASSUMPTION]. Above the threshold, the order goes to `suggested_for_review`.
- **Outside the band but explained:** `suggested_for_review`. An under- or overpayment beyond the band is an `exception`.
- **Imported bank lines** (`csv_import`, and in rc7 `file_import` from CSV, XLSX, MT940 or camt.053 uploads) never make settlement verified on their own unless `allow_imported_bank_lines_as_verified` is on. It defaults to off, and the decision is the founder's (decision 2: it stays off). Since v1 Phase 0.5 an exact payment is no longer held in review by this; its bank evidence is shown apart (see "the evidence-level split" below).

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
- **Step 5 still applies.** An untied batch is an exception. A totals-only report's proposed grouping keeps the order in review. (Until v1 Phase 0.5 an imported bank line with the flag off did too; now the exact payment is matched and the bank evidence is shown apart.)
- **The token-priced branch** was not built in rc8 (it needed a migration). v1 Phase 0 adds it as an approval-only draft: see "v1: token-priced invoices" below.
- **Unchanged.** Inputs that carry quote terms are decided exactly as before (cases 1–3 and the A+quotes pipeline variants are unchanged).
- **Proofs.** Disabling the rule, or removing guard (a), (b) or (c), makes its tests fail (`tests/clearline/merchant/rules-exact-no-terms.test.ts`, `properties-exact.test.ts`). The pipeline-truth control and the blind judge also check that every order this rule closes is one the generator's truth matches exactly.

## v1 Phase 0 (APPROVAL-ONLY DRAFT, pending the founder's sign-off): token-priced invoices

An invoice or order may be priced directly in a token (for example 1,250.00 USDT on TRON = 1,250,000,000 base units on the configured contract), instead of in fiat. The database keeps exactly one pricing mode per invoice (migration 0040). Fiat-priced invoices are decided exactly as before.

| Rule | Step | Outcome | What it means |
|---|---|---|---|
| `M4.exact.token_priced` | 4 | `matched` (then step 5 as usual) | Decision 1's conditions, with the token in place of the fiat credit (below). |
| `M4.token_priced.token_mismatch` | 4 | `suggested_for_review`, Payment Operations | Paid in another token, or the same token on another network. Typed `price_token_mismatch` (the amount received, in its own token). Nothing is converted between tokens. |
| `M4.token_priced.amount_difference` | 4 | `suggested_for_review`, Payment Operations | Received ≠ the invoice's token amount by any amount, even one base unit. Typed `price_token_amount` (signed base units; its fiat value at a recorded rate, or "needs a rate" when none: the stored 0 is never shown or emitted as a value). Never `matched_with_difference`, never a write-off. |
| `M4.token_priced.not_exact` | 4 | `suggested_for_review`, Payment Operations | The amount is exact, but another condition below fails. |

- **Closes only when every condition holds:** exactly one transfer reached a deposit address issued for the order and it is final, inbound, read by Clearline's chain client (`chain_client`), on the configured contract of **exactly the invoice's token on the invoice's network**; exactly one provider record names the order, by the same quote or link (and this transfer if it names one); the provider agrees with the chain; received = the invoice's token amount **to the base unit**; the provider claims `paid`; no refund, balance link or void invoice; a quote whose own amount is known agrees with the price.
- **Never by amount alone.** A transfer to an address not issued for the order is unattributed; a record naming another quote is a reference mismatch. Steps 1–3 run unchanged (identity, look-alikes, finality, chain unavailable, window, held, unknown batch) and stop the order first.
- **The provider's credit is still checked** (credited = received × its executed rate); an unexplained credit is an exception, as before.
- **Fiat value only from a recorded rate.** `ledger.fiatValue` is `rated` (price × the latest recorded `<symbol>/<currency>` rate observed at or before the payment's final transfer, at most 24 hours earlier [ASSUMPTION, for sign-off]) or `needs_rate` (no payment yet, no such rate, or two rates recorded at the same instant that disagree). With `needs_rate` the order is still matched for cash, and the record says the fiat value needs a rate; nothing is derived from the provider's credit or a quote. (#173) Every surface reads the record through `src/lib/clearline/merchant/fiat-value.ts`: the payment page, the payments list (`fiatValueStatus`, `fiatValueMinor`), the exception page, month-end (an unknown open balance is left out of the receivables total and named apart in `openReceivablesNeedingRate`), the evidence pack (JSON `null` with `fiatValueStatus: "needs_rate"`, CSV `needs_rate`, PDF "needs a rate") and the month-end pack's ledger-invoice comparison (`order_fiat_value_needs_rate`) show "needs a rate", never 0. A difference in another token (`price_token_mismatch`) is never valued and shows the same. The IAS 21 settlement pattern is a draft in docs/POSTING_RULES.md (not built).
- **No journal proposals** are made for a token-priced order, or for a batch that settles one of its payments, until the founder signs off how it is booked (fiat value, FX gain or loss).
- **Step 5 still applies**, exactly as for decision 1.
- **Tests:** `tests/clearline/merchant/rules-token-priced.test.ts`, `properties-token-priced.test.ts`, and the control test `tests/control/token-priced.test.ts`.

## v1 Phase 0 (APPROVAL-ONLY DRAFT, pending the founder's sign-off): per-payment settlement files

A provider that sends settlement as batch totals only links no payment to a batch, so step 5 can only propose a grouping (`M5.grouping.proposed_needs_confirmation`) and nothing closes automatically: this is why the rc7/rc8 blind test stayed at 0.00 %. v1 adds a **per-payment settlement file** (file type `settlement_payments`, migration 0041): one row per payment with the provider's payment ID (and optionally the order reference), gross, fee, net, batch ID, currency and settlement date. It is uploaded beside the totals report through the same upload → mapping → validation → confirmation → normalise flow.

- **Linking is by reference only.** A line links a payment to a batch through the provider's payment ID. A line naming a batch that is not in the settlement report links nothing. An amount never links anything.
- **A batch ties from these lines only when** (check `perPaymentLines`, in addition to every existing check): Σ gross = the batch's gross, Σ fee = its fees, Σ net − refunds = its net; every line has gross − fee = net, the batch's currency, a known provider payment whose credited amount is the line's gross, and (when given) the order the payment belongs to; the provider record does not name another batch; no payment is in two batches (both are then untied); and if the batch also has per-line rows from a settlement report, both name the same payments. Then, as before, net = the bank line and the merchant-day bridge must have nothing unexplained.
- **No rule of step 5 changes.** A tied batch with an imported bank line is still `M5.bank.imported_not_verified` while the flag is off (since v1 Phase 0.5 only for a payment with a difference; an exact one is `M5.batch.tied_evidence_separate`, see below); an untied batch is still `M5.batch.not_tied` (exception); step 5 still only confirms an exact step-4 match or makes a decision stricter. A batch with refunds that neither the settlement report's lines nor the per-payment file's refund rows name does not tie.
- **Refund rows (v1 #174, approval-only draft; migration 0046).** A row of line type `refund` names the **original payment** by its provider payment ID and carries its own refund ID. **Sign convention:** a refund row gives the money returned as a **negative** gross and net with a **zero** fee (gross − fee = net holds for every row, and a batch's rows sum to its net); a positive refund amount, a fee on a refund row, a refund row without a refund ID and a refund ID on a payment row are refused at validation (never adjusted). Normalisation refuses (as a conflict) a refund whose original is not a payment of this merchant entity in reconciliation, is credited in another currency, or would take the payment's refunds above its credit. The engine checks the same again (known payment of the entity's input, same currency, refund ID used once, negative amount with fee 0 and net = gross, all refunds of the payment ≤ its credit, the order when given) and a batch with refunds ties from the file only when its payment rows give its gross and fees, its refund rows sum exactly to its refunds, every row's net sums to its net (gross − fees − refunds = net, exactly) and the net equals the bank line. Any invalid refund row leaves the batch untied. **A refund row never links its payment to a batch and never closes a payment by amount:** an order with a refund row is never closed by decision 1 or the token-priced rule ("a refund is recorded for this order"), exactly as for a settlement report's refund line.
- **Without a per-payment file, nothing changes** (the check is absent and every output is byte-identical).
- **Tests:** `tests/clearline/merchant/settlement-per-payment.test.ts`, `tests/clearline/synthetic/per-payment-blind.test.ts` (blind-test style numbers) and the control test `tests/control/settlement-payments.test.ts`.

## v1 Phase 0.5: the evidence-level split (founder decisions 12–16)

A payment's **match** and its **bank evidence** are now two separate things, shown side by side everywhere (payment list and detail, batch list and detail, daily report, overview, evidence pack JSON/CSV/PDF, month-end pack `bridges.csv`, provider console, reconstruction report).

- **Matched** means: chain, provider record and invoice agree by reference, the amounts are exact after typed items, the chain transfer is final and on the verified contract. Nothing about this definition changed in code: steps 1–4 are untouched.
- **Bank evidence** is a level stored on every match record (`match_records.bank_evidence`, migration 0042) and on every batch bridge:

| Level | When | Label |
|---|---|---|
| `none` | No bank line ties to the payment: no batch, an untied batch, a proposed grouping, a statement no second person confirmed, or a seeded / recorded "feed" line | Bank evidence: none |
| `imported_two_person_confirmed` | The batch ties to the cent and its bank line comes from an imported statement (rc5 statement import or v1 bank-statement upload) that a person other than the uploader confirmed. Read from the stored confirmation, never from a file column. | Bank evidence: imported statement, confirmed by a second person (not bank-authenticated) |
| `bank_authenticated` | **Reserved.** Nothing produces it (no bank connection exists). The database check refuses it, the writer throws on it, and a test checks no source file can produce it. | Bank evidence: bank-authenticated |

- A payment is only as evidenced as its weakest batch, and an untied batch evidences nothing.
- **Settled** (batch and payment): the batch ties to the cent **and** its evidence is at least `imported_two_person_confirmed`.
- **The imported-bank-line flag never raises the evidence level.** It still does exactly what it did: it lets an imported line make settlement *verified* (which journal settlement proposals require). Its default stays off.

### Exactly which rule outcomes change

| Situation | Before | After |
|---|---|---|
| Exact payment (step 4 `matched`, e.g. `M4.exact.no_quote_terms`, `M4.match.no_difference`, `M4.exact.token_priced`) in a batch that ties to the cent, whose bank line is imported, flag off | `suggested_for_review` · `M5.bank.imported_not_verified` (owner Treasury) | `matched` · **`M5.batch.tied_evidence_separate`** (new rule, step 5); `M5.bank.imported_not_verified` is recorded as a history note; settlement still not verified; bank evidence `imported_two_person_confirmed` (statement confirmed by a second person) or `none` |

**Nothing else changes**:
- A payment with any difference (`matched_with_difference` at step 4, or review) in such a batch stays `suggested_for_review` · `M5.bank.imported_not_verified`. No new write-off is proposed.
- A totals-only report's proposed grouping stays `suggested_for_review` · `M5.grouping.proposed_needs_confirmation` (no batch link is evidence the engine can use).
- An untied batch stays `exception` · `M5.batch.not_tied`.
- With the flag on, an exact payment in a tied batch is `matched` · `M5.batch.tied_verified`, as before.
- Journal proposals are unchanged (settlement proposals still need a tied, *verified* batch).
- An amount alone never matches; the sender never decides; the tolerance band, the write-off threshold and the preparer-never-approves rule are unchanged; steps 1–4 are unchanged.
- **Tests:** `tests/clearline/merchant/settlement-per-payment.test.ts`, `properties-evidence.test.ts` (amount-only coincidences, shuffled order, idempotent re-runs, evidence never higher than supported, `bank_authenticated` reserved), `tests/clearline/synthetic/per-payment-blind.test.ts`, and the control tests `settlement-payments.test.ts` (stored level), `normalise-e2e.test.ts`, `demo.test.ts`. Disabling `M5.batch.tied_evidence_separate` restores the old outcome and makes those tests fail.
- **Numbers:** `docs/release/BLIND_BREAKDOWN_BEFORE.md` and `BLIND_BREAKDOWN_AFTER.md`.

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
