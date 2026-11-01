# Task 2: Red build triage — branch `fee-tolerance` @ 4b1e9c2

Inputs: `fixtures/task2/run-1.log`, `run-2.log`, `run-3.log`, `branch-log.txt`. No re-runs possible
for this task, so every call below rests on those four files plus reading `main` @ fd9b992 code.

## Triage

| # | Test | Runs failed | Call | Severity |
|---|---|---|---|---|
| 1 | `tests/requests.test.ts` > the demo week > **b. Brightline: short by 50.00…** (`requests.test.ts:162`) | **3 of 3**, identical assertion `expected 'matched' to be 'needs_review'` | **Real**: caused by commit 4b1e9c2 | **High** (money: a short payment is treated as paid in full) |
| 2 | `tests/qa-fixes.test.ts` > P2 import performance > **5,000 instruction rows … in under 10 s** (`qa-fixes.test.ts:144`) | **1 of 3** (run 2 only: 11,796 ms vs 10,000 budget) | **Environment-induced flake** (wall-clock budget on a loaded shared runner) | Low (no product defect shown); process issue |

### 1. Brightline: real, introduced by 4b1e9c2
- **Evidence.** Fails in all three runs with the same diff (`- needs_review / + matched`) at the same
  line, 9 ms each time. Not timing-dependent.
- **Cause (file:line).** 4b1e9c2 changes `deriveRequest` in `src/lib/requests/lifecycle.ts` (hunk
  `@@ -341,7 +341,13 @@`): when any confirmed transfer comes from a sender labelled `exchange`, and
  the shortfall is ≤ `mulBps(amount, 100)` (1%), it sets `cmp = 0`, i.e. "exactly paid". The demo's
  Brightline case is 4,950.00 of 5,000.00 from Coinbridge (labelled exchange in
  `src/lib/requests/demo.ts:85`): a 1.0% shortfall, so it is now `matched` instead of `needs_review`/`short`.
  `mulBps` and `senderLabel` both exist on main (`money.ts:55`, `lifecycle.ts:105`), so it compiles
  and only the behaviour changes [VERIFIED: read on main @ fd9b992].
- **Why it's High, not just a broken demo.** `matched` is the state the auto-mark rule acts on
  (`autoMark` in `lifecycle.ts`: `if (v.state !== "matched") continue;`). On a request with
  auto-mark on, a payment up to 1% short from an exchange is **marked paid with no person
  involved**, and the commit message says that's the intent ("so they tick off automatically"). It
  also breaks the product rule in the edge-case catalogue (E2: "fee cause never auto-settles") and
  the voice-of-customer ask from 28 Oct ("985.00 … don't call that paid … let me decide"). Downstream,
  `planPosting` would see a matched request where received < invoice [ASSUMPTION: I didn't trace
  the posting path for this branch; needs checking before any version of this ships].
- **The test is right, the code is wrong.** The fix is to revert the hunk, not to edit the test.
  A tolerance like this is a product decision (Aashmiin), and if wanted it should be a person's
  one-click "accept as fee" (which already exists: `accept_short`), not a silent `cmp = 0`.
- **Not a qa-fix PR**: it touches attribution/marking-paid rules (playbook §3 "Not for"). Bug row
  instead.
- Side note: the fixture's `requests.test.ts:160-163` and `qa-fixes.test.ts:143-144` don't match
  the same tests on main (main's Brightline test has no `v.state` assertion at that point; main's
  perf test uses `performance.now()` at lines 138–145). Either `e01a7d3` also edited tests, or CI
  ran a different revision. Check `git diff origin/main...origin/fee-tolerance -- tests/` once the
  branch is fetchable (it isn't on origin in this session) [ASSUMPTION].

### 2. "5,000 rows in under 10 s": environment flake, not a product regression
- **Evidence.** Passed in run 1 (file 8,814 ms) and run 3 (file 8,650 ms); failed only in run 2
  (test 11,822 ms, measured 11,796 ms). The CI note in `run-2.log` says another job
  (`website-build`) shared the 2-vCPU runner from 23:15:40 to 23:17:05, which covers run 2
  (started 23:16:11, 19.40 s). Run 2's total time is also the slowest (19.40 s vs 14.92 s / 15.10 s).
  The branch's only code change (`deriveRequest`) isn't on the payments-import path the test
  measures (`importFile` → `refreshMatching`) [VERIFIED: commit stat touches only
  `src/lib/requests/lifecycle.ts`].
- **Cause.** The test asserts a wall-clock budget. On this runner it uses 87–88% of the budget even
  when it passes (8.65–8.81 s file time), so any neighbour job pushes it over. On my machine tonight
  the whole file took 5.9–6.3 s (task 1), so it's runner-dependent.
- **What I'd do (no retry, no skip, no raised budget):**
  1. devops-engineer: don't co-schedule jobs on `shared-small` during the vitest step, or run the
     suite on a dedicated runner. (Hand-off.)
  2. Proposed deterministic replacement for the test, for the owner to decide: keep the 5,000-row
     correctness assertions, and replace the absolute 10 s with a linearity check (time for 5,000
     rows ≤ ~6× time for 1,000 rows in the same process), so it catches an O(n²) regression without
     depending on the machine. That's a test-design change, not a loosening; it goes as a bug row to
     crypto-protocol-engineer rather than a qa-fix, because changing a test's assertion needs the
     owner's agreement.
  3. If someone wants proof beyond 1 of 3: `for i in $(seq 10); do npx vitest run tests/qa-fixes.test.ts …; done`
     on an idle runner and on a loaded one. Not done here (no re-runs allowed in this task).

## WOULD SEND: triage section of tonight's health email

```
RED — PR fee-tolerance 4b1e9c2: 1 real failure (money), 1 flaky.

Branches
- fee-tolerance 4b1e9c2 (vs main): vitest 3 runs NOT identical: run 1 & 3: 1 failed | 561 passed | 57 skipped (619); run 2: 2 failed | 560 passed | 57 skipped (619). tsc/build/e2e: not in the logs I was given → not run.
Triage
- requests.test.ts "b. Brightline: short by 50.00…": REAL, High — 3/3, expected needs_review got matched (requests.test.ts:162) — cause 4b1e9c2 lifecycle.ts deriveRequest: exchange payments ≤1% short now count as paid, so auto-mark ticks them off — next: do not merge; revert the hunk; bug row to crypto-protocol-engineer; tolerance is your product call (today's rule: a person accepts a fee shortfall).
- qa-fixes.test.ts "5,000 rows … under 10 s": FLAKY (environment), Low — 1/3 (11,796 ms vs 10,000), only in the run that overlapped the website-build job on the same 2-vCPU runner; passes use 8.65–8.81 s — next: devops isolates the runner; owner considers a machine-independent linearity check. No retry/skip added.
Flaky: qa-fixes.test.ts P2 1 of 3 (shared-runner load, per CI note) 
Merge first: not fee-tolerance.
```

## WOULD WRITE: Product roadmap rows

| status | owner | title | link/details |
|---|---|---|---|
| bug | Product (→ crypto-protocol-engineer) | fee-tolerance 4b1e9c2: exchange payments ≤1% short are treated as paid and auto-marked | `lifecycle.ts` deriveRequest hunk @@ -341; failing test `requests.test.ts` "b. Brightline" 3/3; decision on any tolerance → Aashmiin |
| bug | Product (→ crypto-protocol-engineer) | qa-fixes.test.ts P2 wall-clock budget flakes on shared CI runner | 1/3 on fee-tolerance CI 27 Oct (11,796 ms); propose linearity assertion; runner isolation → devops-engineer |

## WOULD WRITE: Log rows

| agent | action | ids | details |
|---|---|---|---|
| qa-security-engineer | triage | fee-tolerance@4b1e9c2 | RISK: real money failure — short exchange payments marked paid (requests.test.ts:162, 3/3). Not mergeable. Bug row filed. |
| qa-security-engineer | triage | fee-tolerance@4b1e9c2 | flaky: qa-fixes P2 1/3, environment (website-build on same runner 23:15:40–23:17:05). Hand-off devops-engineer. |

## Notes
- I didn't call the Brightline failure flaky just because another test in the same suite was. They
  differ in pattern (3/3 vs 1/3), timing (9 ms vs 11.8 s) and cause.
- I'd also check the claims audit: the commit message's "tick off automatically" is the wording
  already marked FALSE outside the demo on the website. This branch would make it worse, not true.
- Task 4's new test "one base unit short (999.999999)" fails against this exact change (I applied
  the hunk temporarily in scratch and reverted it: 4 failures incl. the existing Brightline test and
  2 in `requests-edge.test.ts`). So once task 4's file lands, the regression is caught in two places.
