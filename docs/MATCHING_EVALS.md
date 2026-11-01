# Matching evaluations

Owner: matching-engine-engineer. Updated after every change to matching, with the date, code sha and
n beside every number. Rules: `team/knowledge/matching-engine-engineer/metrics.md`.

**Baseline: 2026-11-01 SGT, `main` 0c7d9f1. No matching code has been changed by this role yet.**

## 1. Summary
| Question | Answer today |
|---|---|
| Is invoice-to-payment matching measured on labelled real data? | **A first small set only** (§8, 2026-11-01): 20 demo scenarios on 14 real public transfers with **sample (fictional) invoices**, all tuning, no held-out set. Too small for any per-type rate except exact; no held-out false-match rate exists. |
| What is measured on real data? | **Deposit diagnosis** (which D-code a transaction gets), on real transfers with a **fictional sample company's** deposit addresses and ledger. That is a different task from invoice matching. |
| Can I say "matching accuracy"? | No. |

## 2. What is measured: deposit diagnosis on real transfers (sample company records)
| Set | n | Result | 95% Wilson | When / how | Re-runnable offline? |
|---|---|---|---|---|---|
| Tuning (`tests/real_cases.json`), replayed by `npx vitest run` | **57** recorded (of 59; 2 are live captures) | **57/57** expected code + findings | 93.7%-100% | 2026-11-01, my run on 0c7d9f1 | yes |
| Tuning, before the 24-25 Oct fixes | 59 | 43/59 | 60.4%-82.6% | 2026-10-24, live app (`demo/results/results.md`) | no |
| Held-out (`tests/real_cases_holdout.json`) | **52** | **52/52** expected code + findings | 93.1%-100% | one run, label `holdout2`, 2026-10-25 ~00:53 SGT, live app, no keys (`demo/results/holdout-after.json`) | **no** (no recordings) |
| Held-out: false alarms on normal (credited) payments | 12 | 0/12 | 0%-24.2% (exact one-sided upper 22.1%) | same run | no |
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
Update 2026-11-01: a first small tuning-only set now exists (§8, n = 20). The table below is the
baseline as written before it; "not measured" still holds for every held-out figure.

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
*Note 2026-11-01: §8 now has a first small measurement. The outward wording below is unchanged and
stays as is until Aashmiin approves new wording (pending her approval); §8 figures are not for outward use.*

Aashmiin, 1 Nov 2026: the held-out deposit-diagnosis figure is **not** quoted in public or sales material, and
never as a matching or accuracy claim. Outward wording, no figure: "The checking engine is tested on recorded
real public transfers; invoice matching accuracy will be measured on 20 replayed real transfers (not yet
measured). Anything ambiguous goes to a person."

## 8. First invoice-matching measurement: the demo scenarios (2026-11-01 SGT)
Task: **invoice matching** (not deposit diagnosis). Set: `tests/fixtures/real/scenarios/catalogue.json`
(ADR 0003). **Real public transfers (not Clearline customers), sample invoices.** Code: `main` 82f8b4d;
this change adds data and tests only, no product logic. Run:
`SCENARIO_EVAL=1 npx vitest run tests/demo-scenarios-eval.test.ts` (offline replay; deterministic).

**What this is:** a first small evaluation set, **not a held-out benchmark**. All 20 cases are tuning
(they are shown in the demo and run by QA, so none can stay unseen); no held-out look was made. 21
slots: the 20 demo payments, all on real recordings, and **SCN-21 (still confirming), a gap**: no
recorded real Ethereum transfer has fewer than 12 confirmations, and the session could not reach an
Ethereum RPC to record one. The 20 cases use **14 distinct transfers**; 6 cases reuse a transfer with a
different sample invoice (over ×2, duplicate, ambiguous ×3), so cases are not independent. SCN-20 is an
adversarial check added after review: two open invoices on one address, only one equal to the amount
(must go to a person; an amount-only link counts as a false match there). Labels: one labeller
(matching-engine-engineer), second labeller pending; chain facts from `tests/real_cases.json` verified
facts (independent sources read 2026-10-24) [ASSUMPTION: not re-opened this run; explorers blocked].

A false match is counted on **any** invoice in the sample book (the system linked and matched it, or
the auto-rule marked it paid) that is not the labelled true invoice. Checked by a mutation probe on
2026-11-01: with `attribute()` changed to link by amount alone (scratch only, reverted), the eval
reported 1 false match (SCN-20) and four tests failed.

| Case type | n | Auto-matched correct | False matches | Sent to a person | Flagged on the invoice | Refused at lookup, nothing recorded | Missed (expected auto-match)¹ |
|---|---|---|---|---|---|---|---|
| exact | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| partial | 3 | 0 | 0 | 2 | 1 (wrong flag: SCN-08 is labelled "a person decides")² | 0 | 1 |
| over | 2 | 0 | 0 | 2 | 0 | 0 | 0 |
| duplicate (same transfer reported twice) | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| wrong token / counterfeit | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| wrong network | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| look-alike address | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| ambiguous (shared address / repeat payer) | 3 | 0 | 0 | 3 | 0 | 0 | 0 |
| still confirming | 0 | gap | | | | | |

¹ "Missed" overlaps the other columns (SCN-06 is also under "Sent to a person"); the other columns sum to n.
² Flagged "below minimum deposit"; it still reaches a person, but only "dismiss" is offered.

| Metric (all 20, tuning) | Value | 95% Wilson |
|---|---|---|
| False-match rate | 0 false of 6 auto-matches (n = 20); the 6 come from **5 distinct transfers** (SCN-11 replays SCN-03's) | 0%-39.0% (exact one-sided upper 39.3%) |
| False matches per case | 0/20 | 0%-16.1% |
| Abstain rate (sent to a person to decide) | 7/20 | 18.1%-56.7% |
| Recall on exact | 5/5 | 56.6%-100% |
| Recall on all cases labelled auto-match (5 exact, SCN-06 rounding, SCN-11 duplicate) | 6/7 | 48.7%-97.4% |
| Per-type rates for every type other than exact | too few to report (n < 5) | — |

Read it as: on these 20, nothing was auto-matched that should not have been, and the bound the n
supports is wide (a false-match rate up to about 39% per auto-match is not ruled out). Because cases
share transfers, the Wilson intervals assume an independence the cases do not have, so they are, if
anything, too narrow. 18 of the 20 sample books hold a single open invoice, so 0/6 says little about
picking the wrong one of several; only SCN-18 and SCN-20 test that. Intervals:
[VERIFIED: computed 2026-11-01, Wilson as in statsmodels; z = 1.959964].

Where the product's outcome differs from the label today (tests are `it.fails`, product unchanged):
- **SCN-06** short by 0.000117 (≤ 0.01): label auto-match with a rounding line (POSTING_RULES R3d,
  decision 3); product sends it to a person as "short" (miss, not a false match). Planned in D5.4 (AO).
- **SCN-08** 0.001 USDT on a 250.00 invoice: label "a person decides" (ask for balance or accept);
  product flags it "below minimum deposit" (D08 from the sample deposit minimums) and blocks those
  choices. Needs decision: does a deposit minimum apply to invoice payments?
- **SCN-14/15** wrong network (Tron, BNB Chain): label flagged on the invoice; product refuses the hash
  with "Found on tron/bsc, not Ethereum" and records nothing (gap K5, plan D6.2).
- **SCN-16/17** look-alike address (real poisoning): label flagged as look-alike; product says only "no
  token transfer to the request's receiving address" and records nothing (D07b off on the request path).
