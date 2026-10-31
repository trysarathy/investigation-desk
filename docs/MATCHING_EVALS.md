# Matching evaluations

Owner: matching-engine-engineer. Updated after every change to matching, with the date, code sha and
n beside every number. Rules: `team/knowledge/matching-engine-engineer/metrics.md`.

**Baseline: 2026-11-01 SGT, `main` 0c7d9f1. No matching code has been changed by this role yet.**

## 1. Summary
| Question | Answer today |
|---|---|
| Is invoice-to-payment matching measured on labelled real data? | **No.** There is no labelled invoice-matching set. False-match rate, recall on exact cases and abstain rate by case type are **not measured**. |
| What is measured on real data? | **Deposit diagnosis** (which D-code a transaction gets), on real transfers with a **fictional sample company's** deposit addresses and ledger. That is a different task from invoice matching. |
| Can I say "matching accuracy"? | No. |

## 2. What is measured: deposit diagnosis on real transfers (sample company records)
| Set | n | Result | 95% Wilson | When / how | Re-runnable offline? |
|---|---|---|---|---|---|
| Tuning (`tests/real_cases.json`), replayed by `npx vitest run` | **57** recorded (of 59; 2 are live captures) | **57/57** expected code + findings | 93.7%-100% | 2026-11-01, my run on 0c7d9f1 | yes |
| Tuning, before the 24-25 Oct fixes | 59 | 43/59 | 60.4%-82.6% | 2026-10-24, live app (`demo/results/results.md`) | no |
| Held-out (`tests/real_cases_holdout.json`) | **52** | **52/52** expected code + findings | 93.1%-100% | one run, label `holdout2`, 2026-10-25 ~00:53 SGT, live app, no keys (`demo/results/holdout-after.json`) | **no** (no recordings) |
| Held-out: false alarms on normal (credited) payments | 12 | 0/12 | 0%-24.3% (exact one-sided upper 22.1%) | same run | no |
| Held-out: wrong **and** High confidence | 52 | 0/52 | 0%-6.9% (exact one-sided upper 5.6%) | same run | no |

Intervals: [VERIFIED: computed 2026-11-01, Wilson formula as in statsmodels `proportion_confint`].
The 57/57 is the tuning set replayed (no regression), **not** an estimate of performance on new data.
The tuning set was used to find and fix the bugs behind the 16 wrong answers (43/59 → 59/59).

Caveats on the held-out 52/52:
- It measured deposit diagnosis, not invoice matching. 40 of 52 cases depend on fictional company
  records built so the expected code follows; the chain facts are independently verified.
- It has **no** look-alike/poisoning case and **no** confirmations (D02) case.
- It was run once on 2026-10-25, before two later engine commits that day (bdb3bab, 418a639); it has
  not been re-run on today's code and cannot be re-run offline.
- The number of looks is not recorded (label `holdout2`); a rule change (D17 cap) landed in the same
  commit as the held-out set. Treat it as probably, not provably, clean.
- Do not combine with the tuning set ("111/111" is not a valid figure).

Full test suite, 2026-11-01, 0c7d9f1: 21 files, 619 tests: **562 passed, 57 skipped** (network
re-recording, off by default), **0 failed** [VERIFIED: computed 2026-11-01 from the vitest JSON report].
The matching-related unit tests in it (`tests/requests.test.ts` 23, `tests/payments.test.ts` 24,
`tests/payments-review.test.ts` 20, `tests/payments-redirects.test.ts` 7) use fictional or hand-built
inputs: they check rules, they are not an evaluation.

## 3. What is NOT measured yet (invoice matching)
| Case type | What the code does today (main 0c7d9f1) | Labelled real cases | FMR | Recall (exact) | Abstain rate |
|---|---|---|---|---|---|
| exact | one open request on the address → attributed; `matched` at exact amount; marked paid automatically **only in demo** (`service.ts:36`) | 0 | not measured | not measured | not measured |
| partial | `review: "short"` | 0 | not measured | — | not measured |
| overpayment | `review: "over"` / paid twice | 0 | not measured | — | not measured |
| multiple invoices | ≥ 2 open requests on one address → ambiguous, never by amount; one transfer for several invoices not modelled | 0 | not measured | — | not measured |
| wrong token | flagged `wrong_token` / `counterfeit` | 0 (D05/D06 cases exist on the deposit path only) | not measured | — | — |
| wrong network | flagged `wrong_network` (requests are Ethereum only) | 0 | not measured | — | — |
| look-alike address | `wrong_address` only; D07b off on the request path | 0 | not measured | — | — |
| unidentified + suggestions | `suggestMatches` 40/35/15/10 points, Strong ≥ 80 / Possible ≥ 50, shown ≥ 40; a person confirms | 0 | — | — | — |

The suggestion score and its Strong/Possible/Weak cut-offs, and the three-way `similarity` weights, have
**never been measured** on labelled data. They are hand-set ranks, not probabilities.

## 4. Harness plan (playbook `team/playbooks/matching-engine-engineer.md` §1)
1. PR 1: `tests/matching/` schema, loader, scorer, held-out guard and look log. No cases.
2. PRs 2+: batches of real transfers (two independent sources each, recorded responses) with SAMPLE
   invoice books; split at intake by `sha256(group)` (25% held-out) plus time order; stratified, ≥ 5
   tuning and ≥ 5 held-out cases per case type before a row is reported; two labellers.
3. First report: per case type, tuning and held-out separately, n + Wilson 95% + zero-event bound.
4. Size needed: to show a false-match rate under 1% at 95% with zero errors needs about **300
   auto-matches** in the held-out set [VERIFIED: computed 2026-11-01, 1 − 0.05^(1/300) ≈ 0.99%].
   Until then, say the bound the n supports.

## 5. Held-out look log
| When (SGT) | Who | Set | Code sha | Reason | Result |
|---|---|---|---|---|---|
| 2026-10-25 ~00:53 | (founder session, run_cases.py `holdout2`) | deposit-diagnosis held-out, n=52 | after a7d61c4 / at 6f5f393 [ASSUMPTION: inferred from commit times] | post-fix check | 52/52 |
| earlier look(s)? | unknown | same | unknown | not recorded | not recorded |
| 2026-11-01 | matching-engine-engineer | — | 0c7d9f1 | baseline: **no held-out run made**; counts read from the stored result file only | — |

## 6. Incidents (false matches found)
None recorded.

## 7. How to quote this (for sales and content; Aashmiin approves outward use)
"On 52 real transfers collected after our last fix, the deposit check gave the expected diagnosis on all
52 (one run, 25 Oct, sample company records; 95% interval 93-100%). We have not yet measured invoice
matching on real data. Anything ambiguous goes to a person."
