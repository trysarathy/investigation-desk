# Blind test breakdown — AFTER the evidence-level split (v1 Phase 0.5)

Branch `v1/a1-evidence-levels` at 3505615 (6352925 + 1c9fbd6, 4ed058a, 23f8b20, 96f1fc8, 08701a6, 3505615). Same data, files, spec, judge and breakdown script as `BLIND_BREAKDOWN_BEFORE.md`. Synthetic, fictional data only. **This review is not independent**: the same agent wrote the change, the script and this report.

Two outcome changes (see `docs/MATCHING_RULES.md`, "the evidence-level split"):
1. An exact payment in a tied batch whose bank line is imported moves from review to matched (`M5.batch.tied_evidence_separate`).
2. An exact payment whose settlement is only a totals-only proposed grouping, and whose provider record names a batch in the settlement report, moves from review to matched (`M5.grouping.matched_settlement_unlinked`). It is marked "settlement not linked", `settled = false` and bank evidence `none`.

## Summary

| | before (6352925) | after (3505615) |
|---|---|---|
| **Browser blind test** (`npm run e2e:blind`, fresh DB, totals-only settlement), payments | 1,952 | 1,952 |
| matched (+ with difference) | 0 (0.00 %) | **1,445 (74.03 %)**: SG 993 (73.01 %), US 452 (76.35 %) |
| review | 1,911 (97.90 %) | **466 (23.87 %)** |
| exception | 41 (2.10 %) | **41 (2.10 %)** (unchanged) |
| **wrong matches** (judge, flag off, on, off again) | 0 | **0** |
| decisions not explained by the truth, a documented rule or an abstention | 0 | 0 |
| settled payments; bank evidence of the stored records | – | 0 settled; `none` for all 1,952 (no payment is linked to a batch) |
| journal proposals (all pending sign-off) | 1,460 | 1,460 (unchanged; no settlement entry for an unlinked payment) |
| **In memory, totals only, flag off** (1,960: the 8 look-alike rows are not refused in memory) | 0 / 1,911 / 49 | **1,445 (73.72 %) / 466 (23.78 %) / 49 (2.50 %)**, 0 wrong |
| **In memory, + per-payment file, statement confirmed by a second person, flag off** | 0 / 1,710 / 250 | **1,244 (63.47 %) / 466 (23.78 %) / 250 (12.76 %)**, 0 wrong |

- **Browser [VERIFIED].** `npm run e2e:blind` on fresh database `clearline_xa1_blind_after3` (port 4001): 1 passed (3.0 min).
  - Every judge assertion held, with the flag off, on, and off again: 0 wrong matches; every one of the 1,445 decision-1 closures is an exact match in the generator's truth (`exactNotTruth` 0); 0 mismatches against the truth, a rule or an abstention; every bank line tied or explained; idempotent re-runs; stored = computed; every exception has an owner, a reason and a next step.
  - The flag changes nothing here: no batch ties to its payments, so 0 batches are tied and verified.
- **Earlier runs on this branch.** At 08701a6 (only change 1), the browser numbers were identical to before (0 / 1,911 / 41, 0 wrong). One earlier attempt on a fresh database failed at the bank statement's second-person confirmation (the page reload took over 60 s while the machine's load average was about 10); the retry, unchanged, passed.
- **What still blocks a payment.** Every one of the 507 non-matched payments has a reason that is not the bank side: missing quote terms on a payment that is not exact, finality, held or unknown batch, no transfer, or an unexplained credit (table below).
- **With a per-payment file**, the 201 exact payments in the 8 batches with refunds stay `M5.batch.not_tied` exceptions. Exceptions stay exceptions.

## Browser blind test (`npm run e2e:blind`), its database read afterwards

Imported-bank-line flag at read time: ENT-SG-SYN off, ENT-US-SYN off. Stored decisions that differ from what the engine in this checkout computes from the stored input: 0.

### As stored after the run (final state: flag off again)

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1360 | 993 (73.01 %) | 337 (24.78 %) | 30 (2.21 %) |
| ENT-US-SYN | 592 | 452 (76.35 %) | 129 (21.79 %) | 11 (1.86 %) |
| **all** | 1952 | 1445 (74.03 %) | 466 (23.87 %) | 41 (2.10 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
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
| | **total not auto-matched** | 367 | 140 | 507 |

Closed at step 4 by decision 1 and reopened at step 5: 0.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 41
- matched · none: 1445
- suggested_for_review · none: 466

## In memory (engine only): the blind month as shape D's files give it

### Totals-only settlement (as the browser test), flag off

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 993 (72.69 %) | 337 (24.67 %) | 36 (2.64 %) |
| ENT-US-SYN | 594 | 452 (76.09 %) | 129 (21.72 %) | 13 (2.19 %) |
| **all** | 1960 | 1445 (73.72 %) | 466 (23.78 %) | 49 (2.50 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
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
| | **total not auto-matched** | 373 | 142 | 515 |

Closed at step 4 by decision 1 and reopened at step 5: 0.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 49
- matched · none: 1445
- suggested_for_review · none: 466

### Totals-only settlement, flag on (check only)

| entity | payments | auto-match (matched + with difference) | review | exception |
|---|---|---|---|---|
| ENT-SG-SYN | 1366 | 993 (72.69 %) | 337 (24.67 %) | 36 (2.64 %) |
| ENT-US-SYN | 594 | 452 (76.09 %) | 129 (21.72 %) | 13 (2.19 %) |
| **all** | 1960 | 1445 (73.72 %) | 466 (23.78 %) | 49 (2.50 %) |

Blocking reasons (every payment that did not auto-match, by rule and the condition that failed):

| rule | condition that failed | ENT-SG-SYN | ENT-US-SYN | all |
|---|---|---|---|---|
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
| | **total not auto-matched** | 373 | 142 | 515 |

Closed at step 4 by decision 1 and reopened at step 5: 0.

Wrong matches against the generator's truth: **0**.

Decision · bank evidence level:

- exception · none: 49
- matched · none: 1445
- suggested_for_review · none: 466

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

