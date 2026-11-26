# Clearline rc7 — Phase 5 blind test

Branch `rc7/blind-test` (from `rc7/admin-bench` f7a06a9). Synthetic, fictional data only. Labels: **[VERIFIED]** observed in a run recorded here; **[ASSUMPTION]** reasoned but not tested; **[GUESS]** an estimate.

**This review is not independent.** The same agent wrote the generic change, the spec, the judge and this report. A person who has not seen the format should repeat the test before anyone relies on it.

## What was tested

Can a finance user reconcile a month from a provider export format Clearline was never built for, using only the generic upload screens? The format is the generator's reserved shape D (`src/lib/clearline/synthetic/blind.ts`). It is JSON with two lists: one row per payment, plus settlement totals per payout. It also has a nested object of deductions. Nothing in ingest or mapping knows this format, and this report does not name its fields. `tests/clearline/synthetic/blind-isolation.test.ts` still passes: no file outside `blind.ts` names them.

- **Data [VERIFIED].** One month from `MONTH_PRESET_PARAMS`, seed 20261100, month 2026-10:
  - 2,000 orders across two entities, ENT-SG-SYN (SGD) and ENT-US-SYN (USD).
  - 1,982 provider payments, 62 payout batches and 68 bank lines.
  - Ground truth from `computeTruth`: matched 1,475, matched with difference 290, review 76, exception 119, not evaluated 40.

  We used October instead of November because the server's verify step reads chain data up to the real clock (2026-11-23). Late-November transfers would not be visible yet.
- **Files given to the user [VERIFIED].** All were written to `test-results/blind/files` and never committed:
  - the shape D export;
  - the merchant's own order list (CSV, a layout Clearline already reads);
  - one MT940 statement per bank account.

  The order list was needed because shape D has no invoice amount. Without it, no provider row can be brought in (see finding 3).
- **How the test acted [VERIFIED].** `tests/e2e-merchant/blind.spec.ts` (`npm run e2e:blind`, desktop) plays the user.
  - It works through the browser only. The Finance, Approver and Admin users each sign in once in their own context and never sign out.
  - It chooses every column from the values shown in the preview and from the user's own facts: their order IDs, deposit addresses and bank accounts. It never uses knowledge of the format.
  - Results are read afterwards, read-only, by `tests/e2e-merchant/blind-judge.ts` through the Finance member's row-level security. The judge compares them with the truth using the rules in `tests/fixtures/synthetic/truth-expect.ts`, applied to a file that has the provider's claimed statuses and token symbols but no quote terms, and settlement as batch totals only.

## Results [VERIFIED — `npm run e2e:blind`, 1 passed (1.8 min), report `test-results/blind/report.json`]

The rates below count over the 1,952 reconciled payments (1,360 SGD and 592 USD). The 48 orders with nothing to reconcile are counted as unpaid.

| | flag off (default) | flag on (Admin, for the check only) | flag off again |
|---|---|---|---|
| Matched | 0 | 0 | 0 |
| Matched with difference | 0 | 0 | 0 |
| **Auto-match rate** (matched + with difference) / payments | **0.00 %** | **0.00 %** | 0.00 % |
| Suggested for review | 1,911 (**97.9 %**) | 1,911 (97.9 %) | 1,911 |
| Exception | 41 (**2.1 %**) | 41 (2.1 %) | 41 |
| Unpaid (an order with no payment in the export) | 48 (SG 34, US 14) | 48 | 48 |
| Abstained for lack of data (`M3.quote.terms_unknown`: the export has no quote rate or quote window) | 1,895 (SG 1,319, US 576) | 1,895 | 1,895 |
| Wrong matches | **0** | **0** | 0 |
| Decisions not explained by the truth, a documented rule or an abstention | 0 | 0 | 0 |
| Bank lines tied or explained (per account) | 34 / 34 (31 bridged to their batch, 2 debits not imported, 1 non-settlement credit not bridged) | same | same |
| Tied and verified batches; provider clearing ≠ 0 | 0; none | 0; none | 0; none |
| Open exceptions missing an owner, reason or next step | 0 of 41 | 0 of 41 | 0 |
| Stored decisions equal the engine's output on the stored input | yes | yes | yes |

Notes on the table:

- **Exceptions and other non-closing decisions.** The 41 exceptions plus the 16 non-closing decisions outside the "lack of data" rule are exactly the truth for the 57 orders the engine can decide without quote terms:
  - 16 chain finality still pending;
  - 15 held by the provider;
  - 10 unknown batch;
  - 8 references with no chain transfer;
  - 8 unexplained tolerance differences.

  The judge splits these as 57 "= truth", 1,895 "= truth plus a documented rule", and 48 abstentions (unpaid).
- **The provider-clearing check is vacuous here [VERIFIED].** A totals-only settlement report links no payment to a batch, so nothing ties to a payment and nothing settles. That holds even with the imported-bank-line flag on: 0 tied and verified batches. The batch totals do bridge to every settlement credit (gross − fees − refunds = net = bank line, 31 of 31 per entity).
- **Idempotent re-run [VERIFIED].** Running reconciliation a second time on the same data shows "Nothing changed for …" for both entities, with the flag off and with it on. The digest of everything a run writes (decisions, differences, exceptions, write-offs, journals) is the same before and after. Switching the flag back off returns the same decisions and rules as the first run.
- **Time [VERIFIED for automation; GUESS for a person].** The scripted user took about 45 s from first upload to the end of the first reconciliation:
  - orders 10 s;
  - payments list 12 s;
  - payouts list 10 s;
  - bank statement 4 s plus 5 s for the second person;
  - reconcile 4 s.

  The whole spec took 1.8 min. **[GUESS]** A person doing this for the first time would need roughly 30–60 minutes, most of it working out which column is which and finding status words outside the preview. With saved templates, a later month would take about 5–10 minutes.

## Where the UI needed a workaround or was confusing

1. **The file could not be uploaded at all (blocker; fixed generically).** [VERIFIED]
   - Problem: a JSON file whose top-level object has several lists was refused with "choose which one holds the records", but no screen or API let the user choose.
   - Generic fix (commit 1): the refusal now names the lists, and the upload form asks "Which list holds the records?". The choice is stored as an immutable file fact (`uploads.json_list`, migration 0028, its own trigger; `check_upload` is unchanged).
   - Tests: a different JSON shape (an invoicing export with `invoices` and `refunds` lists and nested totals) in `tests/clearline/ingest/tabular.test.ts` and `tests/control/uploads.test.ts`. Nested objects were already flattened to dot paths, so the nested deductions needed nothing new.
   - Workaround still needed: the same file had to be uploaded twice, once as the provider export (payments list) and once as the settlement report (payouts list).
2. **Several suggestions were wrong in ways that matter (fixed by hand from the values).** [VERIFIED]
   - The deposit-address and sender columns were suggested the wrong way round. The user recognised their own deposit addresses.
   - The only token amount was suggested as the *quoted* amount; it is the received amount.
   - The only rate was suggested as the *quote* rate. The user checked that credited ≈ received × rate on every previewed row, which makes it the rate the provider applied.
   - The credited amount, network, settlement batch and quote reference were not suggested at all.
   - In the payouts list, the batch reference was suggested as a payment ID.

   **[ASSUMPTION — not tested]** Accepting the swapped address suggestion would make the engine read the payer's wallet as the deposit address. Every payment would then fail to find its transfer and stop at review or exception, not close: no money moves either way. This was not run.
3. **The export alone cannot be brought in.** [VERIFIED in a service-level rehearsal and in the spec's design] It carries no invoice amount. A provider row whose order is not already in reconciliation is a conflict, so the merchant's own order list must be uploaded first. A finance user may not expect this; the screen says only "in conflict".
4. **Status words beyond the first 20 rows.** [VERIFIED] The screen lists only the status words found in the 20-row preview. The other words (3 in the payments list, 1 in the order list) had to be found by opening the file outside Clearline and typing them in with "Add word". The validation report rejects such rows with "has a word you did not map" but never shows the word.
5. **Payment time cannot be mapped.** [VERIFIED] The only time column holds Unix epoch seconds, and the mapping screen has no such date format. "Paid at" was left as "Not in this file".

   **[ASSUMPTION]** This changed no decision in this test, because quote terms were missing anyway. A generic "Unix time (seconds)" date format would be needed for files where it does matter. It was not added.
6. **Templates reuse well, with two gaps.** [VERIFIED] Both mappings were offered again automatically for the second entity, but:
   - the JSON list has to be chosen again at upload, because a template does not remember it;
   - the payouts template stores the first entity's bank account as its fixed value and had to be changed by hand. Forgetting this would leave the second entity's batches unbridged.
7. **The reference column mixes quote and payment-link IDs.** [VERIFIED in the service-level rehearsal only]
   - Mapping it as **Quote ID** (what the spec does) gives the results above.
   - Leaving it unmapped gives the same decisions, but 30 rows conflict (re-quoted orders) and are not brought in.
   - Mapping it as **Payment link ID**, which its column name hints at, made the reconciliation run fail with an internal error ("payment link … lacks the fields reconciliation needs"). This is safe, because nothing is decided, but it is confusing; the UI shows only a generic failure. **Not fixed** (outside the generic scope); recommended follow-up. **Fixed in rc8** (see "After founder decision 1" below).
8. **No auto-match is possible from this format.** [VERIFIED] Without a quote rate or quote window, Clearline correctly abstains on every payment it cannot judge (1,895 of 1,952). That is the intended safe behaviour, not a UI defect. A provider would need to add its quote terms, or per-payment settlement lines, before anything can close automatically.

**Can the generic UI express shape D?** With the generic JSON-list choice from commit 1, yes, for everything the engine reads, except the epoch payment time (finding 5). Without commit 1 it cannot: the file is refused at upload.

## Checks at the final revision

Commands run in `/home/user/rc7-blind` [VERIFIED]:

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| eslint (rc5-lint config) | 0 errors, 63 warnings (baseline) |
| `vitest run` | 2,528 passed, 57 skipped (baseline 2,527 plus 1 new) |
| `npm run test:control`, fresh database | 300 passed (baseline 299 plus 1 new) |
| merchant e2e, full suite (blind spec excluded by default) | 35 passed, 1 skipped (baseline) |
| `npm run e2e:blind` | 1 passed (1.8 min) |

Hard rules: matching was not loosened (no engine or rule change). The test is read-only on funds, uses no keys and no real data. No rc5 or rc6 security control was changed. The only new database object is the `uploads.json_list` column, with its own immutability trigger.

## After founder decision 1 (rc8, branch `rc8/exact-close`)

Same data, files, spec and judge as above; only the engine changed. The spec ran on its own port (3291) with its own database. **This review is not independent either.** The same agent wrote the rule, its tests, the judge changes and this section.

**What changed [VERIFIED by tests].**
- **Decision 1.** New rule `M4.exact.no_quote_terms`. Without quote terms, an order closes at step 4 only when the payment is exact and linked by reference: one chain-client transfer, final, on the configured contract, to the order's deposit address, and one provider record naming the order's quote or link, paid, with credit = invoice to the cent in the same currency. Step 5 still applies. See `docs/MATCHING_RULES.md`.
- **Payment link IDs (finding 7).** A reference mapped as "Payment link ID", in a file with no quoted amount, no longer fails the run. The link's requested amount is unknown, so the order abstains or gets the exception its facts call for. Regression test: `tests/control/payment-link-reference.test.ts`. At 87c5bf4 it fails with the old error.

### Results [VERIFIED — `npm run e2e:blind`, 1 passed (2.7 min), report `test-results/blind/report.json`]

Rates are over the 1,952 reconciled payments; 48 unpaid orders as before.

| | before (rc7, flag off) | after decision 1, flag off | after, flag on (Admin, check only) |
|---|---|---|---|
| Matched | 0 | 0 | 0 |
| Matched with difference | 0 | 0 | 0 |
| **Auto-match rate** | **0.00 %** | **0.00 %** | **0.00 %** |
| Suggested for review | 1,911 (97.9 %) | 1,911 (97.9 %) | 1,911 (97.9 %) |
| Exception | 41 (2.1 %) | 41 (2.1 %) | 41 (2.1 %) |
| Unpaid | 48 | 48 | 48 |
| Wrong matches | **0** | **0** | **0** |
| Closed at step 4 by decision 1 | – | 1,445 (SG 993, US 452) | 1,445 |
| … of which not an exact match in the truth | – | **0** | **0** |
| Review: `M3.quote.terms_unknown` | 1,895 | 450 (SG 326, US 124) | 450 |
| Review: `M5.grouping.proposed_needs_confirmation` | 0 | 1,445 | 1,445 |
| Decisions not explained by the truth, a rule or an abstention | 0 | 0 | 0 |
| Open exceptions missing an owner, reason or next step | 0 of 41 | 0 of 41 | 0 of 41 |
| Idempotent re-run; stored = computed | yes; yes | yes; yes | yes; yes |

**Why the auto-match rate is still 0.00 % [VERIFIED].**
- Decision 1 does close 1,445 exact payments at step 4. Each one equals an exact match in the generator's truth (the judge checks every one).
- Step 5 then reopens them. Shape D's settlement is batch totals only, so no payment is linked to a batch. Under the existing rc6 rule `M5.grouping.proposed_needs_confirmation`, a grouping by provider day is only proposed and never closes automatically.
- Turning the imported-bank-line flag on does not change this: nothing ties to a payment.
- Decision 1 does not override step 5. Doing so would loosen a separate documented rule, so it was not done.

**What the finance user sees instead [VERIFIED].** For 1,445 payments, the open question is "confirm the proposed grouping against the settlement report and the bank line", not "upload an export with quote terms". 450 payments still lack data that decision 1 cannot replace: a credit that is not exactly the invoice, a non-paid claim, or more than one record or transfer for the order.

**Journal proposals [VERIFIED count; ASSUMPTION about before].** The runs now report 1,004 (SG) and 456 (US) provider-confirmation proposals, all pending sign-off. These are proposals only: nothing is posted. The rule-based proposals need a decision at step 4 or later, or a payment held by the provider. **[ASSUMPTION — reasoned from `journal.ts`, not re-run]** Before decision 1, only the 11 (SG) and 4 (US) held payments qualified.

**[ASSUMPTION] What would raise the auto-match rate.** Not tested here:
- per-payment settlement lines, so payments tie to their batch;
- a bank feed, or the flag on, so settlement is verified.

The pipeline-truth table below shows this effect on the small preset (variant "A · per-line" with the flag on).

### Pipeline-truth table, small preset seed 40 [VERIFIED — `tests/control/pipeline-truth.test.ts`, 20 passed]

| variant | entity | rc7: = truth + rule (rules) | rc8: = truth + rule (rules) | rc8: decision 1 at step 4 | rc8: closed, flag off / on | rc7: = raw truth, flag on | rc8: = raw truth, flag on | wrong matches |
|---|---|---|---|---|---|---|---|---|
| A · per-line · CSV | SG | 23 (terms_unknown 23) | 21 (imported_not_verified 11, terms_unknown 10) | 14 | 0 / 11 | 3 | 14 | 0 |
| A · per-line · CSV | US | 7 (terms_unknown 7) | 7 (imported_not_verified 4, terms_unknown 3) | 4 | 0 / 4 | 2 | 6 | 0 |
| B · per-line · MT940 | SG | 13 (terms_unknown 13) | 7 (terms_unknown 6, imported_not_verified 1) | 7 | 0 / 1 | 2 | 3 | 0 |
| B · per-line · MT940 | US | 2 (terms_unknown 2) | 2 (imported_not_verified 1, terms_unknown 1) | 1 | 0 / 1 | 1 | 2 | 0 |
| C · C totals · camt.053 | SG | 24 (terms_unknown 24) | 24 (grouping 14, terms_unknown 10) | 14 | 0 / 0 | 4 | 4 | 0 |
| C · C totals · camt.053 | US | 8 (terms_unknown 8) | 8 (grouping 4, terms_unknown 4) | 4 | 0 / 0 | 2 | 2 | 0 |
| A · totals · CSV | SG | 23 (terms_unknown 23) | 23 (grouping 14, terms_unknown 9) | 15 | 0 / 0 | 3 | 3 | 0 |
| A · totals · CSV | US | 7 (terms_unknown 7) | 7 (grouping 4, terms_unknown 3) | 4 | 0 / 0 | 2 | 2 | 0 |
| A+quotes · per-line · camt.053 | SG | 16 (imported_not_verified 14, terms_unknown 2) | unchanged | 0 | 0 / 14 | 20 | 20 | 0 |
| A+quotes · per-line · camt.053 | US | 7 (imported_not_verified 7) | unchanged | 0 | 0 / 7 | 9 | 9 | 0 |
| A+quotes · totals · MT940 | SG | 20 (grouping 18, terms_unknown 2) | unchanged | 0 | 0 / 0 | 6 | 6 | 0 |
| A+quotes · totals · MT940 | US | 7 (grouping 7) | unchanged | 0 | 0 / 0 | 2 | 2 | 0 |

Notes on the table:
- **"closed, flag on" [VERIFIED for rc8].** It is the orders that end `matched` or `matched_with_difference` with the imported-bank-line flag on, for that check only. The rc7 runs did not record this column.
- **Exceptions in "B · per-line" SG [VERIFIED].** Six of the seven step-4 closures become `M5.batch.not_tied` exceptions. Their batches cannot tie from shape B files, because the Ethereum rows are refused.
- **Mismatches [VERIFIED].** The control has 0 mismatches in every variant, and every step-4 closure is an exact match in the truth. The one allowed case is a held payment that shape A shows as "Completed": step 5 keeps it in review, as it already did with quote terms.
- **Quote-term variants [VERIFIED].** The A+quotes variants (inputs with quote terms) are unchanged, as are cases 1–3: their tests pass unchanged.

### Checks at the rc8 revision (`rc8/exact-close`, run in `/home/user/rc8-a`) [VERIFIED]

| Check | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| eslint (rc5-lint config) | 0 errors, 63 warnings (baseline) |
| `vitest run` | 2,569 passed, 57 skipped (baseline 2,528 plus 41 new) |
| `npm run test:control`, fresh database | 301 passed (baseline 300 plus 1 new) |
| merchant e2e, full suite (blind spec excluded by default) | 35 passed, 1 skipped (baseline), 8.7 min |
| `npm run e2e:blind` | 1 passed (2.7 min) |

Hard rules: no database migration was added. The pure engine stays pure; the loader only passes along two facts it already stored (each chain fact's source and the provider's credited currency). Nothing keys on fixture IDs or amounts.

## v1 Phase 0 re-run (branch `v1/p0-token-invoices`, approval-only draft)

Same data, files, spec and judge; the engine gained token-priced invoices (migration 0040) and per-payment settlement files (migration 0041), neither of which the blind files use. **This review is not independent either.**

- **`npm run e2e:blind` [VERIFIED, 1 passed (3.1 min), fresh database, port 3890].** Unchanged from rc8: matched 0, matched with difference 0, auto-match 0.00 %, review 1,911 (97.9 %), exception 41 (2.1 %), unpaid 48, closed at step 4 by decision 1 1,445 (grouping SG 993, US 452), `M3.quote.terms_unknown` SG 326, US 124, wrong matches 0, flag off, on and off again.
- **Re-runs on a reused database fail at the bank statement's second-person confirmation [VERIFIED].** The page reload after "Confirm upload" does not finish within 60 s. This also happens at the base commit 727d4cf (one pass on a fresh database, one failure on the reused one), so it is not caused by this branch. Not investigated further.
- **What a per-payment settlement file would change [VERIFIED in memory, not through the browser: `tests/clearline/synthetic/per-payment-blind.test.ts`].** The same month given to the engine as shape D's files give it, plus one per-payment settlement row per payment (fees allocated per payment so the rows sum to each batch's fee):

| variant | payments | auto-match | review | exception | wrong matches |
|---|---|---|---|---|---|
| totals only, flag off (default) | 1,960 | 0 (0.00 %) | 1,911 (97.50 %) | 49 (2.50 %) | 0 |
| totals only, flag on (check only) | 1,960 | 0 (0.00 %) | 1,911 (97.50 %) | 49 (2.50 %) | 0 |
| + per-payment file, flag off (default) | 1,960 | 0 (0.00 %) | 1,710 (87.24 %) | 250 (12.76 %) | 0 |
| + per-payment file, flag on (check only) | 1,960 | 1,244 (63.47 %) | 466 (23.78 %) | 250 (12.76 %) | 0 |

  The in-memory count (1,960) differs from the browser's 1,952 because no file rows are refused in memory (for example the 8 look-alike token payments). With the flag off nothing closes: imported bank lines are still "imported, not bank-authenticated". The 201 extra exceptions are exact payments in the 8 batches with refunds: per-payment rows name no refund, so those batches cannot tie (`M5.batch.not_tied`), which is stricter than the proposed grouping they had before.

### v1 #174: refund rows in the per-payment file (in memory, branch `v1/a3-followups`)

Same month, same engine input, now also given one refund row per refund each batch nets (line type `refund`, the original payment's ID, the refund's own ID, the amount as a negative gross and net, fee 0). [VERIFIED in memory: `tests/clearline/synthetic/per-payment-blind.test.ts`, printed with `--silent=false`; not through the browser.]

| variant | payments | auto-match | review | exception | wrong matches |
|---|---|---|---|---|---|
| + per-payment file (payment rows only), flag off (default) | 1,960 | 0 (0.00 %) | 1,710 (87.24 %) | 250 (12.76 %) | 0 |
| + per-payment file (payment rows only), flag on (check only) | 1,960 | 1,244 (63.47 %) | 466 (23.78 %) | 250 (12.76 %) | 0 |
| + per-payment file with refund rows, flag off (default) | 1,960 | 0 (0.00 %) | 1,911 (97.50 %) | 49 (2.50 %) | 0 |
| + per-payment file with refund rows, flag on (check only) | 1,960 | 1,435 (73.21 %) | 476 (24.29 %) | 49 (2.50 %) | 0 |

With the refund rows the 8 batches with refunds tie, so the 201 `M5.batch.not_tied` exceptions go: with the flag off they return to review (imported bank lines still never verify settlement); with the flag on 191 more exact payments close at `M5.batch.tied_verified` and 10 go to review [inferred from the counts: the refunded orders, which a refund row never lets close]. Small preset (seed 40): payment rows only, flag on 17 / 16 / 6; with refund rows 17 / 17 / 5 (auto-match / review / exception), wrong matches 0 everywhere.

[Integration, wave 1] The flag-off rows above were measured before the evidence-level split (Phase 0.5, below). With the split, flag off, the exact payments in tied batches are matched with their bank evidence shown apart, so each flag-off row's auto-match equals the flag-on row's (asserted by `tests/clearline/synthetic/per-payment-blind.test.ts`); exceptions are unchanged.

## v1 Phase 0.5 re-run: the evidence-level split (branch `v1/a1-evidence-levels`)

At 3505615, on a fresh database: 1 passed (3.0 min) [VERIFIED]. Matched 1,445 (74.03 %), review 466 (23.87 %), exception 41 (2.10 %), wrong matches 0.
- The matched payments are the exact payments decision 1 closes at step 4. They are now matched with "settlement not linked" (totals only), not settled, and bank evidence none.
- At 08701a6 (imported-bank-line change only) the numbers were unchanged from rc8.
- Full breakdown by blocking reason: `BLIND_BREAKDOWN_BEFORE.md` and `BLIND_BREAKDOWN_AFTER.md`.
