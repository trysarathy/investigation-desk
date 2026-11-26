# Blind test breakdown — AFTER the evidence-level split (v1 Phase 0.5)

Branch `v1/a1-evidence-levels` (commits 4ed058a, 23f8b20, 96f1fc8 on top of 6352925). Same data, files, spec, judge and breakdown script as `BLIND_BREAKDOWN_BEFORE.md`. Synthetic, fictional data only. **This review is not independent**: the same agent wrote the change, the script and this report.

## Summary

| | before (6352925) | after (this branch) |
|---|---|---|
| **Browser blind test** (`npm run e2e:blind`, fresh DB, totals-only settlement), payments | 1,952 | 1,952 |
| auto-match / review / exception | 0 (0.00 %) / 1,911 (97.90 %) / 41 (2.10 %) | **0 (0.00 %) / 1,911 (97.90 %) / 41 (2.10 %)** (identical) |
| wrong matches against the truth (judge, flag off, on, off again) | 0 | **0** |
| bank evidence level of the 1,952 stored records | (not recorded) | `none` 1,952 (no payment is linked to a batch, so none is evidenced) |
| **In memory, + per-payment settlement file, statement confirmed by a second person, flag off (default)** | 0 (0.00 %) / 1,710 (87.24 %) / 250 (12.76 %) | **1,244 (63.47 %) / 466 (23.78 %) / 250 (12.76 %)** |
| wrong matches (in memory, every variant) | 0 | **0** |

- **Browser [VERIFIED].** `npm run e2e:blind` on fresh database `clearline_xa1_blind_after2`: 1 passed (3.0 min); every judge assertion held (0 wrong matches, 0 mismatches against the truth/rules/abstentions, every bank line tied or explained, idempotent re-runs, stored = computed). A first attempt on another fresh database (`clearline_xa1_blind_after`) failed at the bank statement's second-person confirmation (the page reload did not finish within 60 s) while the machine's load average was about 10 (other agents); the retry, unchanged, passed. This is the same step that the rc8/v1 report saw hang on reused databases; not investigated further.
- **Why the browser numbers do not move [VERIFIED].** The blind files give settlement as batch totals only. No payment is linked to a batch, so step 5 only *proposes* a grouping (`M5.grouping.proposed_needs_confirmation`), which the split does not change (see "Decision needed" below). The split changes only the outcome the imported bank line used to force (`M5.bank.imported_not_verified` on an exact payment in a batch that ties), and with totals only no batch ties to its payments.
- **Where the split does act [VERIFIED in memory].** With a per-payment settlement file (v1 Phase 0, migration 0041), the 1,244 exact payments in tied batches that stayed in review only because the bank line is imported are now **matched** (`M5.batch.tied_evidence_separate`), each with bank evidence `imported_two_person_confirmed` (or `none` when the statement was not confirmed by a second person). These are exactly the payments the imported-bank-line flag would close (flag on gives the same 1,244), and every one is an exact match in the generator's truth (0 wrong matches). The 201 exact payments in the 8 batches with refunds stay `M5.batch.not_tied` exceptions; nothing with a difference closed.

## Decision needed (not built): should a proposed grouping still block "matched"?

Under the brief's definition, matched depends only on chain + provider + invoice. A totals-only report's proposed grouping (`M5.grouping.proposed_needs_confirmation`) is a settlement-side fact, so one could argue it should become bank evidence `none` instead of holding the payment in review. I did **not** change it: the brief names only the imported-bank-line outcome, and the rule is documented as "never auto-closed". If the founder decides it should not block: in this blind month, **1,445 of 1,952 payments (74.03 %)** would be matched (SG 993, US 452), all with bank evidence `none` and not settled. The judge already checks every one of them: each is a decision-1 closure at step 4 that the generator's truth matches exactly (`exactNotTruth` = 0 in every run), so the wrong-match count would stay 0 [VERIFIED for the step-4 closures; the change itself is not built or run]. Review would fall to 466 (23.87 %), exceptions stay 41 (2.10 %).

## Browser blind test (`npm run e2e:blind`), its database read afterwards

Imported-bank-line flag at read time: ENT-SG-SYN off, ENT-US-SYN off. Stored decisions that differ from what the engine in this checkout computes from the stored input: 0.

### As stored after the run (final state: flag off again)

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1360 | 0 (0.00 %) | 1330 (97.79 %) | 30 (2.21 %) |
| ENT-US-SYN | 592 | 0 (0.00 %) | 581 (98.14 %) | 11 (1.86 %) |
| **all** | 1952 | 0 (0.00 %) | 1911 (97.90 %) | 41 (2.10 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.grouping.proposed_needs_confirmation` | batch totals only, no payment linked to a batch: the grouping is only proposed (exact by reference at step 4: decision 1 passed) | 993 | 452 | 1445 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: credit is not exactly the invoice (any difference, no quote terms to type it) | 118 | 42 | 160 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "underpaid", not "paid" | 71 | 31 | 102 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "overpaid", not "paid" | 58 | 20 | 78 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "re_quoted", not "paid" | 36 | 14 | 50 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: more than one transfer reached the order's addresses; exactly one final transfer is needed | 20 | 10 | 30 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "partially_paid", not "paid" | 23 | 7 | 30 |
| `M1.finality.pending` | not final: fewer confirmations than the network's finality rule | 11 | 5 | 16 |
| `M3.batch.held_by_provider` | shown as completed, held for review by the provider, in no settlement | 11 | 4 | 15 |
| `M3.batch.unknown_batch` | the provider names a settlement batch that is not in the settlement report | 7 | 3 | 10 |
| `M2.reference.no_chain_transfer` | no chain transfer reached the order's deposit address | 6 | 2 | 8 |
| `M4.tolerance.unexplained` | provider credit is not received × executed rate (unexplained difference) | 6 | 2 | 8 |
| | **total not auto-matched** | 1360 | 592 | 1952 |

Closed at step 4 by decision 1 and reopened at step 5: 1445.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 41
- suggested_for_review · none: 1911

## In memory (engine only): the blind month as shape D's files give it

### Totals-only settlement (as the browser test), flag off

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 0 (0.00 %) | 1330 (97.36 %) | 36 (2.64 %) |
| ENT-US-SYN | 594 | 0 (0.00 %) | 581 (97.81 %) | 13 (2.19 %) |
| **all** | 1960 | 0 (0.00 %) | 1911 (97.50 %) | 49 (2.50 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.grouping.proposed_needs_confirmation` | batch totals only, no payment linked to a batch: the grouping is only proposed (exact by reference at step 4: decision 1 passed) | 993 | 452 | 1445 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: credit is not exactly the invoice (any difference, no quote terms to type it) | 118 | 42 | 160 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "underpaid", not "paid" | 71 | 31 | 102 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "overpaid", not "paid" | 58 | 20 | 78 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "re_quoted", not "paid" | 36 | 14 | 50 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: more than one transfer reached the order's addresses; exactly one final transfer is needed | 20 | 10 | 30 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "partially_paid", not "paid" | 23 | 7 | 30 |
| `M1.finality.pending` | not final: fewer confirmations than the network's finality rule | 11 | 5 | 16 |
| `M3.batch.held_by_provider` | shown as completed, held for review by the provider, in no settlement | 11 | 4 | 15 |
| `M3.batch.unknown_batch` | the provider names a settlement batch that is not in the settlement report | 7 | 3 | 10 |
| `M1.identity.lookalike_token` | look-alike token: the symbol of a configured token on another contract | 6 | 2 | 8 |
| `M2.reference.no_chain_transfer` | no chain transfer reached the order's deposit address | 6 | 2 | 8 |
| `M4.tolerance.unexplained` | provider credit is not received × executed rate (unexplained difference) | 6 | 2 | 8 |
| | **total not auto-matched** | 1366 | 594 | 1960 |

Closed at step 4 by decision 1 and reopened at step 5: 1445.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 49
- suggested_for_review · none: 1911

### Totals-only settlement, flag on (check only)

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 0 (0.00 %) | 1330 (97.36 %) | 36 (2.64 %) |
| ENT-US-SYN | 594 | 0 (0.00 %) | 581 (97.81 %) | 13 (2.19 %) |
| **all** | 1960 | 0 (0.00 %) | 1911 (97.50 %) | 49 (2.50 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.grouping.proposed_needs_confirmation` | batch totals only, no payment linked to a batch: the grouping is only proposed (exact by reference at step 4: decision 1 passed) | 993 | 452 | 1445 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: credit is not exactly the invoice (any difference, no quote terms to type it) | 118 | 42 | 160 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "underpaid", not "paid" | 71 | 31 | 102 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "overpaid", not "paid" | 58 | 20 | 78 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "re_quoted", not "paid" | 36 | 14 | 50 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: more than one transfer reached the order's addresses; exactly one final transfer is needed | 20 | 10 | 30 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "partially_paid", not "paid" | 23 | 7 | 30 |
| `M1.finality.pending` | not final: fewer confirmations than the network's finality rule | 11 | 5 | 16 |
| `M3.batch.held_by_provider` | shown as completed, held for review by the provider, in no settlement | 11 | 4 | 15 |
| `M3.batch.unknown_batch` | the provider names a settlement batch that is not in the settlement report | 7 | 3 | 10 |
| `M1.identity.lookalike_token` | look-alike token: the symbol of a configured token on another contract | 6 | 2 | 8 |
| `M2.reference.no_chain_transfer` | no chain transfer reached the order's deposit address | 6 | 2 | 8 |
| `M4.tolerance.unexplained` | provider credit is not received × executed rate (unexplained difference) | 6 | 2 | 8 |
| | **total not auto-matched** | 1366 | 594 | 1960 |

Closed at step 4 by decision 1 and reopened at step 5: 1445.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 49
- suggested_for_review · none: 1911

### + per-payment settlement file, statement confirmed by a second person, flag off

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 832 (60.91 %) | 337 (24.67 %) | 197 (14.42 %) |
| ENT-US-SYN | 594 | 412 (69.36 %) | 129 (21.72 %) | 53 (8.92 %) |
| **all** | 1960 | 1244 (63.47 %) | 466 (23.78 %) | 250 (12.76 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.batch.not_tied` | the batch does not tie to the cent (failed: linesEqualGross) (exact by reference at step 4: decision 1 passed) | 161 | 40 | 201 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: credit is not exactly the invoice (any difference, no quote terms to type it) | 118 | 42 | 160 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "underpaid", not "paid" | 71 | 31 | 102 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "overpaid", not "paid" | 58 | 20 | 78 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "re_quoted", not "paid" | 36 | 14 | 50 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: more than one transfer reached the order's addresses; exactly one final transfer is needed | 20 | 10 | 30 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "partially_paid", not "paid" | 23 | 7 | 30 |
| `M1.finality.pending` | not final: fewer confirmations than the network's finality rule | 11 | 5 | 16 |
| `M3.batch.held_by_provider` | shown as completed, held for review by the provider, in no settlement | 11 | 4 | 15 |
| `M3.batch.unknown_batch` | the provider names a settlement batch that is not in the settlement report | 7 | 3 | 10 |
| `M1.identity.lookalike_token` | look-alike token: the symbol of a configured token on another contract | 6 | 2 | 8 |
| `M2.reference.no_chain_transfer` | no chain transfer reached the order's deposit address | 6 | 2 | 8 |
| `M4.tolerance.unexplained` | provider credit is not received × executed rate (unexplained difference) | 6 | 2 | 8 |
| | **total not auto-matched** | 534 | 182 | 716 |

Closed at step 4 by decision 1 and reopened at step 5: 201.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · imported_two_person_confirmed: 8
- exception · none: 242
- matched · imported_two_person_confirmed: 1244
- suggested_for_review · imported_two_person_confirmed: 388
- suggested_for_review · none: 78

### + per-payment settlement file, flag on (check only)

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 832 (60.91 %) | 337 (24.67 %) | 197 (14.42 %) |
| ENT-US-SYN | 594 | 412 (69.36 %) | 129 (21.72 %) | 53 (8.92 %) |
| **all** | 1960 | 1244 (63.47 %) | 466 (23.78 %) | 250 (12.76 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.batch.not_tied` | the batch does not tie to the cent (failed: linesEqualGross) (exact by reference at step 4: decision 1 passed) | 161 | 40 | 201 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: credit is not exactly the invoice (any difference, no quote terms to type it) | 118 | 42 | 160 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "underpaid", not "paid" | 71 | 31 | 102 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "overpaid", not "paid" | 58 | 20 | 78 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "re_quoted", not "paid" | 36 | 14 | 50 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: more than one transfer reached the order's addresses; exactly one final transfer is needed | 20 | 10 | 30 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "partially_paid", not "paid" | 23 | 7 | 30 |
| `M1.finality.pending` | not final: fewer confirmations than the network's finality rule | 11 | 5 | 16 |
| `M3.batch.held_by_provider` | shown as completed, held for review by the provider, in no settlement | 11 | 4 | 15 |
| `M3.batch.unknown_batch` | the provider names a settlement batch that is not in the settlement report | 7 | 3 | 10 |
| `M1.identity.lookalike_token` | look-alike token: the symbol of a configured token on another contract | 6 | 2 | 8 |
| `M2.reference.no_chain_transfer` | no chain transfer reached the order's deposit address | 6 | 2 | 8 |
| `M4.tolerance.unexplained` | provider credit is not received × executed rate (unexplained difference) | 6 | 2 | 8 |
| | **total not auto-matched** | 534 | 182 | 716 |

Closed at step 4 by decision 1 and reopened at step 5: 201.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · imported_two_person_confirmed: 8
- exception · none: 242
- matched · imported_two_person_confirmed: 1244
- suggested_for_review · imported_two_person_confirmed: 388
- suggested_for_review · none: 78

### + per-payment settlement file, statement NOT confirmed by a second person, flag off

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 832 (60.91 %) | 337 (24.67 %) | 197 (14.42 %) |
| ENT-US-SYN | 594 | 412 (69.36 %) | 129 (21.72 %) | 53 (8.92 %) |
| **all** | 1960 | 1244 (63.47 %) | 466 (23.78 %) | 250 (12.76 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.batch.not_tied` | the batch does not tie to the cent (failed: linesEqualGross) (exact by reference at step 4: decision 1 passed) | 161 | 40 | 201 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: credit is not exactly the invoice (any difference, no quote terms to type it) | 118 | 42 | 160 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "underpaid", not "paid" | 71 | 31 | 102 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "overpaid", not "paid" | 58 | 20 | 78 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "re_quoted", not "paid" | 36 | 14 | 50 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: more than one transfer reached the order's addresses; exactly one final transfer is needed | 20 | 10 | 30 |
| `M3.quote.terms_unknown` | quote terms unknown; decision 1 failed: provider status "partially_paid", not "paid" | 23 | 7 | 30 |
| `M1.finality.pending` | not final: fewer confirmations than the network's finality rule | 11 | 5 | 16 |
| `M3.batch.held_by_provider` | shown as completed, held for review by the provider, in no settlement | 11 | 4 | 15 |
| `M3.batch.unknown_batch` | the provider names a settlement batch that is not in the settlement report | 7 | 3 | 10 |
| `M1.identity.lookalike_token` | look-alike token: the symbol of a configured token on another contract | 6 | 2 | 8 |
| `M2.reference.no_chain_transfer` | no chain transfer reached the order's deposit address | 6 | 2 | 8 |
| `M4.tolerance.unexplained` | provider credit is not received × executed rate (unexplained difference) | 6 | 2 | 8 |
| | **total not auto-matched** | 534 | 182 | 716 |

Closed at step 4 by decision 1 and reopened at step 5: 201.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 250
- matched · none: 1244
- suggested_for_review · none: 466

