# Labelled data that exists today, and what it measures

Read from `origin/main` 0c7d9f1 on 2026-11-01. Counts [VERIFIED: computed 2026-11-01 from the JSON files].

## The two real-transfer sets (deposit diagnosis, not invoice matching)
| | `tests/real_cases.json` (tuning) | `tests/real_cases_holdout.json` (held-out) |
|---|---|---|
| Generated | 2026-10-24T15:33:43Z | 2026-10-24T16:43:35Z |
| Cases | **59** (57 recorded + 2 `dynamic` live captures LIVE-T, LIVE-E) | **52** |
| Chains | ethereum 26, tron 21, bsc 7, bitcoin 2, polygon/arbitrum/base 1 each | tron 20, ethereum 20, bsc 7, bitcoin 2, polygon/arbitrum/base 1 each |
| Expected codes | D13 12, D03 11, D06 7, D09 6, D12 4, D08 3, D04 3, D05 2, D07b 2, D01 2, D02 2, D07/D14/D16/D17/D18 1 each | D13 12, D03 10, D06 6, D09 5, D12 4, D08 3, D04 3, D05 2, D01 2, D07/D14/D16/D17/D18 1 each |
| Uses SAMPLE (fictional) company data | 46 of 59 | 40 of 52 |
| Recorded chain responses in repo | yes, `tests/fixtures/real/<id>.json` (58 files) | **none** |
| Replayed by `npx vitest run` | yes, `tests/real-cases.test.ts` | **no** |
| Tx overlap with the other set | 0 | 0 |

Missing from the held-out set: D02 (confirmations) and D07b (poisoning) — so the held-out set never
tested the look-alike rule.

**Unit of a case:** one real transaction hash (+ optional reporting customer) → one expected D-code and
expected findings. **Labels:** chain facts (status, contract, from/to, amount, freeze) come from sources
independent of the product: Tronscan API, Blockscout, a second RPC, issuer `AddedBlackList`/`Blacklisted`
events, issuer contract lists, Bitquery write-up for poisoning (`demo/REPORT.md` "What was tested";
`tests/real-data/tools/build_cases.py`, `build_holdout.py`, `chain.py`). **Company-record labels**
(D12, D13, D14, D16, D17, D18, D08, D05, D04 context) are **constructed**: the builder wrote a fictional
File A / File B (`tests/real-data/SAMPLE-*.csv`) so that the expected code follows. They test the rule
logic on real transfers, not the judgment of a real finance team.

## How the split was made, and its limits
- Tuning set: collected 24 Oct, product run, fixes made against it ("before 43/59 → after 59/59",
  `demo/results/results.md`).
- Held-out set: "built after the fixes, from transactions the fixes never saw" (`about` field), newer
  transactions, same categories. Built by a script with the same selection rules (`build_holdout.py`).
- Run once against the live app with no keys, label **`holdout2`**, 2026-10-25 ~00:53 SGT
  (`demo/results/holdout-after.json` `summary.label`). Result: 52/52 expected code, 0/12 false alarms
  on normal, 0 wrong-and-High, 0 paused.
- **Not logged:** how many times the held-out set was looked at. The label `holdout2` suggests at least
  a second run; no `holdout1` result is in git history [ASSUMPTION: inferred from the label]. The commit
  that added the held-out set (6f5f393) also changed a rule (D17 → Medium when the reporting customer has
  no File A address). Whether that change followed a held-out look is not recorded. Treat the 52/52 as
  "probably clean, not provably clean". From now on every look is logged (playbook §1.6).
- Engine commits after that run: bdb3bab and 418a639 (2026-10-25, minutes later: history limits, replay
  badge). The held-out result has **not been re-run on today's code** and cannot be re-run offline
  (no recordings; chain state such as "frozen now" can change).

## What "52 of 52 on held-out" actually measured
Deposit **diagnosis**: given a hash, did the engine return the expected D-code and findings, on a
fictional company's records. It did **not** measure invoice-to-payment matching, partial/overpayment
handling, multi-invoice ambiguity, the auto-mark rule, `suggestMatches` scores or three-way payments
matching. `demo/REPORT.md` says so: "The payments matching side and the AI explanations have not been
tested on real data." Never call it "matching accuracy". "111 of 111" adds the tuned set to the held-out
set and must not be quoted (`team/CLAIMS_REVIEW.md` B3).

Honest wording: "On 52 real transfers collected after the last fix, the deposit check gave the expected
diagnosis on all 52 (95% Wilson interval 93.1%-100%, one run on 25 Oct, sample company records). Invoice
matching has no labelled real-data evaluation yet."

## Test run on 2026-11-01 (main 0c7d9f1, my run)
`npx vitest run`: 21 files, **619 tests: 562 passed, 57 skipped, 0 failed** (the 57 skipped are
`tests/real-record.test.ts`, network re-recording, off unless `RECORD_REAL=1`)
[VERIFIED: computed 2026-11-01 from the vitest JSON report]. `tests/real-cases.test.ts`: 62 passed = 1
count check + **57/57 recorded tuning cases** at the expected code + 4 outage tests. This is the tuning
set replayed: it shows no regression, it is not an estimate of accuracy on new data.

## Invoice-matching labelled data: none
The request tests (`tests/requests.test.ts`, 23) and the demo week (`src/lib/requests/demo.ts`, seven
cases a-g) are **fictional** scenarios with hash prefix `0x00000000` by design. Useful as unit tests,
not as evaluation data. The harness in `team/playbooks/matching-engine-engineer.md` §1 builds the first
labelled set.
