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
   - Mapping it as **Payment link ID**, which its column name hints at, made the reconciliation run fail with an internal error ("payment link … lacks the fields reconciliation needs"). This is safe, because nothing is decided, but it is confusing; the UI shows only a generic failure. **Not fixed** (outside the generic scope); recommended follow-up.
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
