# rc7 test results (23 Nov 2026)

Test mode · illustrative data. Labels: **[VERIFIED]** seen in a recorded run; **[ASSUMPTION]** reasoned, not tested; **[GUESS]** an estimate.

- **Source:** every number below is copied from the PR bodies of #139–#156 (and `docs/release/BLIND_TEST_RC7.md`). This document re-ran nothing.
- **"Local":** a build container with PostgreSQL 16; each `test:control` run used a fresh database.
- **"Agent run":** run by the agent that wrote the PR and not re-run by the lead. Everything else was re-run by the lead of the session.
- **Reviews were not independent.** Every rc7 PR was written and reviewed by agents of the same session.
- **Fictional data only.** No real customer file, key or chain read was used.

## Local counts per PR head

`vitest` is `npx vitest run` (the full unit suite) unless it says `tests/clearline`. Skipped tests (57) are all in `tests/real-record.test.ts`, which runs only with `RECORD_REAL` (as in rc6). Lint is 0 errors with the 63-warning baseline wherever it was reported.

| PR | Branch @ head | tsc | lint | vitest | test:control | merchant e2e (desktop + iPhone 13) |
|---|---|---|---|---|---|---|
| #139 | `rc7/plan` @ 59ed795 | — (docs and CI only) | — | — | — | (ran on #140) |
| #140 | `rc7/doc-a-tolerance` @ 8d0d85a | 0 | 0 | `tests/clearline` 1105 passed | 194 | 25 passed, 1 skipped; public `/clearline/cases` spec 30 passed, 4 skipped |
| #141 | `rc7/ingest-parse` @ d8fb22d | 0 | — | `tests/clearline` 1278 passed (ingest suite 173); agent full run 2295 passed, 57 skipped | — | — |
| #142 | `rc7/bank-formats` @ eb99abd | 0 | — | `tests/clearline` 1278 passed | — | — |
| #143 | `rc7/mapping` @ 2d38093 | 0 | 0 | 2317 passed, 57 skipped | 200 | — |
| #144 | `rc7/uploads` @ a0e24af | — | — | 2320 passed, 57 skipped | 211 | — |
| #145 | `rc7/normalise` @ 5bc90c3 | — | — | 2320 passed, 57 skipped | 220 | — |
| #146 | `rc7/synthetic` @ e4c8227 | — | — | synthetic suite 126 passed | — | — |
| #147 | `rc7/upload-ui` @ 6d2d978 | 0 | 0 | 2446 passed, 57 skipped | 221 | 29 passed, 1 skipped |
| #148 | `rc7/upload-review-ui` @ 52501e6 | — | — | 2446 passed, 57 skipped | 221 | 31 passed, 1 skipped |
| #149 | `rc7/chain-readers` @ f82f64f | 0 | — | 2492 passed, 57 skipped (seen on the #150 head, which adds only the speed change); 42 new chain tests | — | — |
| #150 | `rc7/engine-speed` @ 9a7609f | 0 | — | 2492 passed, 57 skipped | — | — |
| #151 | `rc7/chain-verify` @ 6f899b4 | 0 | 0 | 2496 passed, 57 skipped | 228 (18 files) | 31 passed, 1 skipped (agent run) |
| #152 | `rc7/pipeline-truth` @ 633b2b0 | 0 | 0 | 2514 passed, 57 skipped | 248 (19 files) | 31 passed, 1 skipped (agent run) |
| #153 | `rc7/runs-jobs` @ 6380d97 | 0 | 0 | 2514 passed, 57 skipped | 262 (21 files) | 33 passed, 1 skipped (agent run); pilot build exit 0 (agent run) |
| #154 | `rc7/ledger-exports` @ e4311d8 | 0 | 0 | 2527 passed, 57 skipped | 293 (25 files) | **expected to fail** at this head (bell's accessible name fails axe); fixed in #155 |
| #155 | `rc7/admin-bench` @ f7a06a9 | 0 | 0 | 2527 passed, 57 skipped | 299 (27 files) | 35 passed, 1 skipped (agent run); pilot and public demo builds exit 0 (agent run) |
| #156 | `rc7/blind-test` @ eefb899 | 0 | 0 | 2528 passed, 57 skipped | 300 | 35 passed, 1 skipped (agent run); `npm run e2e:blind` 1 passed, 1.8 min (agent run) |

"—" means the PR body did not report that suite. It does not mean it passed or failed. The one merchant e2e skip is the desktop-only load-time check, by design.

## Rule proofs (each change's test fails without it)

| PR | Change reverted | Result |
|---|---|---|
| #140 | band forced back to `min` | `case3.test.ts`: 2 failed, 7 passed |
| #140 | `J.writeoff.on_approval` disabled | 4 failed, 27 passed (31), own test among them |
| #140 | `J.settlement.refund_netted` disabled | 2 failed, 29 passed (31), own test among them |
| #140 | `J.confirmation.chain_evidenced` disabled | 1 failed, 30 passed (31) |
| #140 | `J.confirmation.overpayment_liability` disabled | 2 failed, 29 passed (31) |
| #149 | `M1.chain.unavailable` disabled | 3 of its 4 tests fail |
| #151 | engine reads provider claims as transfers | 3 failed, 4 passed (7) |
| #151 | cache disabled | 2 failed, 5 passed (7) |
| #151 | no second read before finalising | 3 failed, 4 passed (7) |
| #151 | USDT on Ethereum not seeded | 1 failed, 8 passed (9) |
| #152 | `M3.quote.terms_unknown` disabled | unit 4 failed, 6 passed (10); truth 16 failed, 2 passed, 2 skipped (20) |
| #152 | log index never resolved from chain | 2 failed, 8 passed (10), plus truth tests |
| #152 | fee lines ignored by normalise | zero-wrong-match (SG, US) and clearing-nets-to-zero tests fail across variants |
| #152 | generator without fee lines | 1 failed, 8 passed (9) |
| #152 | negative deductions refused | 2 failed, 6 passed (8) |
| #152 | other-entity rows not skipped | US truth and clearing tests fail (4 variants) |
| #152 | token default not applied | 3 failed, 5 passed (8) |
| #153 | each of 22 guards removed one at a time (no-change, closed-payment lock, error code only, append-only, isolation, rule-set version, `SKIP LOCKED`, dead after max attempts, backoff, enqueue once, schedule identity, `safeLog`) | the named test failed each time; the policy-revision guard needed a stronger test first (commit 6380d97) |
| #154 | ledger branch in normalise / demo-company check / fixed demo label / export permission / draft-only filter / audience-role policy | 4 / 3 / 2 / 1 / 1 / 5 failed |
| #154 | preparer check in the server | the database trigger still refused it (defence in depth) |
| #155 | table list missing one table / storage not cleaned / membership check on sign-out | delete blocked by foreign keys / 1 failed / 1 failed |

**Gap [VERIFIED, #155]:** the bulk-normalise fallback path has no test of its own. A control test shows decisions and rows are identical either way.

`M3.provider.transfer_ambiguous` is covered by the #152 log-index proof above. Its separate disable-only proof is not reported in a PR body.

## Agreement with generator truth (#152, small preset, seed 40)

12 variants (shapes A, B, C and A+quotes; per-line and totals settlement; CSV, MT940 and camt.053 statements; SG and US entities): **0 wrong matches and 0 mismatches in every variant** [VERIFIED]. Most orders were "rule-adjusted" or abstained, because shapes A–C carry no quote rate or window. Each variant also passed: every bank line tied or explained; no settlement verified with the flag off; clearing nets to zero per tied batch with the flag on; every exception has an owner, reason and next step; shuffled rows give identical results; a re-run writes nothing.

## Performance

| Measure | Result | Source |
|---|---|---|
| Engine only, 10,000 payments (`reconcile` + `proposeJournals`) | 16.0 s before, **1.3 s** after; output byte-identical (35.8 MB) | [VERIFIED] #150, local container |
| End to end, `npm run bench:e2e`: 10,000 payments, **536 bank lines**, 64 uploads, about 51,000 rows, through the real upload steps, then reconciliation with chain verification and database writes | **57.1 s, seen by the lead** (target 60 s). Agent runs: 56.7, 58.1 and 58.3 s. **The margin is small.** | [VERIFIED] #155 |
| Benchmark decisions (flag off) | 9,627 for review, 133 exceptions, 0 matched. It measures throughput, not the auto-match rate. | [VERIFIED] #155 |

## Blind test (#156; full write-up `docs/release/BLIND_TEST_RC7.md`)

A month in a format the code had never seen (JSON with separate payments and payouts lists), through the UI only. 2,000 orders, 1,982 provider payments, 62 batches, 68 bank lines; seed 20261100, month 2026-10.

| Measure | Result (flag off, on, and off again: identical) |
|---|---|
| Wrong matches | **0** |
| Auto-match rate | **0.00%** |
| Suggested for review | 1,911 (97.9%) |
| Exceptions | 41 (2.1%), each with owner, reason and next step |
| Unpaid | 48 |
| Abstained for lack of quote terms | 1,895 |
| Bank lines tied or explained | 34 of 34 per account |
| Re-run | "Nothing changed" |

**This test was not independent:** the same agent wrote the fix, the spec, the judge and the report. A person who has not seen the format should repeat it.

## CI on the PR heads

Read from the GitHub check-runs API on 23 Nov 2026. "In progress" means not seen green.

| PR | Head | lint | ci | control-db | control-e2e | merchant-e2e | clearline-browser | funding-browser |
|---|---|---|---|---|---|---|---|---|
| #139 plan | 59ed795 | ✓ | ✓ | ✓ | ✓ | ✓ | not run | not run |
| #140–#149 | (each head) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ or not run | ✓ |
| #150 engine speed | 9a7609f | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (flaky, see below) |
| #151 chain verify | 6f899b4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #152 pipeline truth | 633b2b0 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #153 runs and jobs | 6380d97 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (flaky) |
| #154 ledger and exports | e4311d8 | ✓ | ✓ | ✓ | ✓ | **✗** (expected: the bell's accessible name; fixed in #155) | ✓ | ✓ |
| #155 admin and bench | f7a06a9 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #156 blind test | eefb899 | ✓ | ✓ | ✓ | ✓ | in progress | in progress | ✗ (flaky) |

- **`merchant-e2e` runs in CI** from #139 onward (added in Phase 0) and passed on every head except #154.
- **`funding-browser` is the pre-existing flaky Funding Desk suite** described in TEST_RESULTS_RC6. rc7 changes no Funding file, and it passes on the heads stacked above #150 and #153.
- **The `docs` PR head** is listed in that PR, not here.

## Not run

- `npm run chain:smoke` against mainnet: never run (the container cannot reach those hosts).
- A real import of the draft Xero or QuickBooks files: not tried [ASSUMPTION that the layouts are right].
- The merchant e2e at #154's head: not run, expected to fail (see above).
