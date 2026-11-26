# Blind test breakdown — BEFORE the evidence-level split (v1 Phase 0.5)

Base: `v1/p0-12-settlement-numbers` at 6352925 (engine unchanged). Synthetic, fictional data only. Labels: **[VERIFIED]** observed in a run recorded here; **[ASSUMPTION]** reasoned, not tested. **This review is not independent**: the same agent wrote the breakdown script, the change and this report.

## How it was produced (reproducible)

1. Fresh database `clearline_xa1_blind_before` (`scripts/db/setup-local.sh`), test build (`CLEARLINE_TEST_BUILD=1 … next build`), then `npm run e2e:blind` on port 4001 [VERIFIED: 1 passed (3.9 min); flag off, on and off again; wrong matches 0; idempotent re-runs].
2. Right after the run, its database read only, as the blind merchant's Finance member through row-level security:
   `DATABASE_URL=postgres://clearline_runtime:…@127.0.0.1:54329/clearline_xa1_blind_before npx tsx --conditions=react-server scripts/blind/breakdown.ts db`
   It counts the **stored** match records (what the run wrote), and checks them against what the engine computes from the stored input (0 differ).
3. The same month in memory, the way shape D's files give it, with and without a per-payment settlement file: `npx tsx scripts/blind/breakdown.ts memory`.

The reason for each payment is read from its own record only (`scripts/blind/reasons.ts`): the deciding rule plus the specific condition that failed (for `M3.quote.terms_unknown`, the first condition of rc8 decision 1 that failed, from its history note). Wrong matches are counted against the generator's ground truth (`computeTruth`): a closed payment whose truth decision differs, or that carries a transfer that is not the order's.

The in-memory count (1,960) differs from the browser's 1,952 because the browser upload refuses 8 look-alike token rows (they appear in memory as `M1.identity.lookalike_token` exceptions).

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

- exception · (not recorded): 41
- suggested_for_review · (not recorded): 1911

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

- exception · (not recorded): 49
- suggested_for_review · (not recorded): 1911

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

- exception · (not recorded): 49
- suggested_for_review · (not recorded): 1911

### + per-payment settlement file, statement confirmed by a second person, flag off

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 0 (0.00 %) | 1169 (85.58 %) | 197 (14.42 %) |
| ENT-US-SYN | 594 | 0 (0.00 %) | 541 (91.08 %) | 53 (8.92 %) |
| **all** | 1960 | 0 (0.00 %) | 1710 (87.24 %) | 250 (12.76 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.bank.imported_not_verified` | batch ties, but its bank line is imported, not bank-authenticated (flag off) (exact by reference at step 4: decision 1 passed) | 832 | 412 | 1244 |
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
| | **total not auto-matched** | 1366 | 594 | 1960 |

Closed at step 4 by decision 1 and reopened at step 5: 1445.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · (not recorded): 250
- suggested_for_review · (not recorded): 1710

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

- exception · (not recorded): 250
- matched · (not recorded): 1244
- suggested_for_review · (not recorded): 466

### + per-payment settlement file, statement NOT confirmed by a second person, flag off

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 0 (0.00 %) | 1169 (85.58 %) | 197 (14.42 %) |
| ENT-US-SYN | 594 | 0 (0.00 %) | 541 (91.08 %) | 53 (8.92 %) |
| **all** | 1960 | 0 (0.00 %) | 1710 (87.24 %) | 250 (12.76 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
| `M5.bank.imported_not_verified` | batch ties, but its bank line is imported, not bank-authenticated (flag off) (exact by reference at step 4: decision 1 passed) | 832 | 412 | 1244 |
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
| | **total not auto-matched** | 1366 | 594 | 1960 |

Closed at step 4 by decision 1 and reopened at step 5: 1445.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · (not recorded): 250
- suggested_for_review · (not recorded): 1710

