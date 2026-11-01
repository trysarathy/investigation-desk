# Task 1: Nightly health report on main (fd9b992)

## WOULD SEND: email

**To:** aashmiin@gmail.com
**Subject:** Clearline product health 2026-10-29

```
GREEN — main fd9b992: tsc, vitest x3 (identical), next build and e2e demo cases a–g all passed tonight. Tests only: 1 High security gap is still open (below), so not "safe for a live pilot".

RISK (security, not a test failure): POST /api/demo/reset has no demo-mode guard. On a live (DEMO_MODE=off) server it replaces the real workspace with demo Files A/B and deletes cases and bulk runs. Re-probed tonight on a local scratch server: the pilot File A I uploaded was replaced by demo-file-a.csv. src/app/api/demo/reset/route.ts. Fix: refuse unless isDemoMode() (403), plus a test. Owner: crypto-protocol-engineer.

Branches
- main fd9b992: npm ci ok (127 packages, 10.2 s) · tsc 0 errors (8.5 s) · vitest 3/3 identical: 20 files passed + 1 skipped (21); 562 passed, 57 skipped (619); 8.66 s / 6.80 s / 7.22 s · next build ok (44.4 s, no warnings printed) · e2e 14 of 14 checks passed (tests/e2e/demo_cases.py, Python Playwright, 1280x720 + pay page at 390x844), 0 console/page errors, 36.8 s
- No PR branches in scope tonight.
Flaky: none seen (3 runs identical). Watch: qa-fixes.test.ts "5,000 rows in under 10 s" took 6.06 / 5.90 / 6.32 s for the whole file; wall-clock budget, a candidate on a slow runner.
Bugs: found 0 new · fixed 0 · still open: test-map gaps G1 (High), G16 (Medium) and the rest as listed in the pack.
Security: new 0 · open by severity C0/H1/M-/L- [Risks tab not read tonight] · secret scan tree: 0 hits (strong patterns, generic assignments, Clearline patterns); only .env.example tracked; fixtures apikey=REDACTED x64 · history (118 commits, all refs): 0 hits · npm audit prod 2 (1 moderate, 1 high: postcss via next), all 5 (2 moderate, 1 high, 2 critical: tinypool via vitest, dev only). Same as the 29 Oct pack: no new advisories.
Claims: unchanged since 29 Oct (not re-run tonight; no copy branch in scope).
Merge first: nothing tested tonight besides main.
Couldn't check: Settings PAUSE and the Gmail PAUSE search (live tools off; task says PAUSE off); Product roadmap/Risks/Log rows (Sheets off); npm audit signatures ("Failed to download", proxy/environment); e2e at 1280x800 (the script uses 1280x720) and phone width on pages other than /pay; npm run qa does not exist on main (it is on qa-polish, PR #31).
Metrics: main green 1/7 this week [only tonight seen this session] · escaped defects this month: unknown (Sheets off) · open security issues C/H/M/L: not read (Sheets off) · claims audit: not re-run tonight.
```

## WOULD WRITE: Log rows (Company HQ → Log)

| timestamp SGT | agent | action | ids | details |
|---|---|---|---|---|
| 2026-10-29 17:20 | qa-security-engineer | nightly QA | main@fd9b992 | tsc ok, vitest 3/3 562 pass 57 skip, build ok, e2e 14/14 (demo_cases.py). Logs in scratch qa-logs/ |
| 2026-10-29 17:20 | qa-security-engineer | security quick check | main@fd9b992 | secret scan tree+history 0 hits; npm audit prod 2 (1H), all 5 (2C dev) unchanged |
| 2026-10-29 17:20 | qa-security-engineer | product health email sent | — | GREEN, branches 1, bugs 0 |

(Risks row for G1 not re-written: it should already exist from 29 Oct; I couldn't read the Risks tab to confirm. If it's missing: `security · High · src/app/api/demo/reset/route.ts:7 · add isDemoMode() guard + live-mode 403 test`.)

## Evidence (commands run this session, scratch worktree of origin/main = fd9b992)

```
$ git log -1 --format=%h origin/main          → fd9b992
$ npm ci --no-audit --no-fund                  → added 127 packages in 10s
$ npx tsc --noEmit                             → exit 0, real 0m8.519s
$ npx vitest run  (x3)
 run 1 exit 0  Test Files 20 passed | 1 skipped (21)  Tests 562 passed | 57 skipped (619)  Duration 8.66s
 run 2 exit 0  Test Files 20 passed | 1 skipped (21)  Tests 562 passed | 57 skipped (619)  Duration 6.80s
 run 3 exit 0  Test Files 20 passed | 1 skipped (21)  Tests 562 passed | 57 skipped (619)  Duration 7.22s
$ npx vitest run --reporter=json               → 562 passed, 57 pending, 0 failed, 619 total
  per file: engine 145, real-cases 62, live 55, ai 33, inbox 31, chain 28, payments 24, accounting 23,
  requests 23, polish 22, csv 20, payments-review 20, inbox-review 15, ledger 14, qa-fixes 12,
  inbox-rereview 11, payments-redirects 7, export 6, real-rules 6, bulk 5; real-record 57 skipped
$ npx next build                               → exit 0, "Compiled successfully in 17.4s", real 0m44.4s
$ DESK_DATA_DIR=<tmp> npx next start -p 3300 ; python tests/e2e/demo_cases.py <out>
  PASS at a glance … PASS a. Acme … b. Brightline … c. Orbit counterfeit … d. Meridian … e. Unidentified …
  f. Fernhill look-alike … g. Kestrel duplicate … a repeated event counts once … reload identical …
  no horizontal scroll at 1280x720 and on a phone … pages load in under 1 s … no dead links …
  no console or page errors
  FAILS: 0 of 14   (exit 0, real 0m36.8s)
$ npm audit --omit=dev → 2 vulnerabilities (1 moderate, 1 high)
$ npm audit            → 5 vulnerabilities (2 moderate, 1 high, 2 critical)
$ npm audit signatures → npm error Failed to download   (environment)
```

## Notes
- e2e: the pack said Python Playwright wasn't installed. I installed `playwright==1.56.0` into a
  throwaway venv outside the repo (/tmp/claude-0/pwvenv); it used the preinstalled Chromium build
  1194 (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Nothing added to the repo. Devops could add this
  to the environment so the nightly run doesn't depend on it.
- GREEN is for the test gate only (the definition's "main green" metric). I kept the open High
  security gap in the second line so GREEN isn't read as "ready for a live pilot" (see task 8).
- Today's 562 matches the pack's 29 Oct number; that is tonight's own count, not a carry-over (logs
  saved in the scratchpad `qa-logs/`).
- Servers I started were stopped; temp data dirs deleted; worktree removed.
- Run time was 09:10–09:20 UTC (17:10–17:20 SGT), an on-demand eval run, not the 22:53 slot; Log
  timestamps reflect that.
