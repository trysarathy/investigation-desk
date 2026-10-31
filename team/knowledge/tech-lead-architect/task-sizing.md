# Task sizing: from a roadmap item to PR-sized tasks

Basis: Google "Small CLs" (one self-contained change; ~100 lines reasonable, ~1000 too large; split
by stacking, files, horizontally or vertically) [VERIFIED:
https://raw.githubusercontent.com/google/eng-practices/master/review/developer/small-cls.md opened
2026-11-01], and our gate: < 300 changed lines (company/OPERATING_MODEL.md §2).

## The rules
1. **One task = one PR = one concern**, < 300 changed lines including tests and fixtures
   (GitHub additions + deletions). Target 100-200. If your estimate is > 250, split it now.
2. **Tests first in the same PR.** A bug task's first step is the failing test (or flipping an
   existing `it.fails`). A feature task names the test that will pass when done.
3. **One owner, one file set.** At most one open PR per collision hot-spot file per night
   (`codebase-architecture.md` §8). Two tasks touching the same file → sequence them (dependency).
4. **Interface first.** If two tasks share a new type or field, the first task adds it with its
   first use; the second depends on it. The tech lead writes the exact signature in both tasks.
5. **Approval-only flagged at planning time** using the path map (`codebase-architecture.md` §7).
   Approval-only tasks are still planned and built; they just never auto-merge, and their
   Approval Queue row is drafted in the task.
6. **No task needs a secret in the PR.** If a task needs a Xero app, a key or a wallet, the
   dependency is "Aashmiin: <exact action>", and the PR uses recorded fixtures or mocks.
7. **Every task fits one night.** If it can't be done, tested and opened in one engineer run,
   split it.

## Split patterns that fit this codebase
| Pattern | Use for | Example |
|---|---|---|
| Pure → service → route → UI (horizontal) | Any new capability | Watched address: (1) `requests/watch.ts` pure filter of transfers to `TransferEvent` + tests; (2) service using chain readers + replay test; (3) route; (4) "Check for payments" button |
| Data first, then behaviour | Scenario sets, fixtures | Batch 1: 10 recorded fixtures + expected file; Batch 2: 10 more; then the test that runs all 20 |
| Flip-the-failing-tests | Bugs with `it.fails` branches | ADR 0002 PR (a): remove `.fails`, add `orgTimeZone`, add fail-closed test |
| Read before write (provider) | New provider calls | Xero `GET /Organisation` read + mapping table (no change to posting) before the PR that uses it |
| Stacked docs | DEMO.md | script skeleton → screenshots → final run log |

## Estimating
Estimate in **changed lines** and **engineer-runs** (one nightly run ≈ one task). Use the closest
precedent in the repo, e.g. `tests/posting-date-timezone.test.ts` = 119 lines alone. Say how you
estimated ("similar to X"). Never invent velocity numbers; after 7 days, use the measured median
from the task files ("PRs that fit first time", cycle time).

## The task file: `team/plan/tasks-<YYYY-MM-DD>.md` (date = the night it is written, SGT)
Header: date, inputs read (roadmap rows with ids, PLAN_14_DAY day, open PRs with head sha, last
night's results), PAUSE check result, branch-rule check result.
Then one block per task:
```
### T<date>-<n>: <imperative title>
- Owner: <one of crypto-protocol-engineer | accounting-integrations-engineer | matching-engine-engineer |
  frontend-product-engineer | devops-engineer | qa-security-engineer | lead-designer>
- Plan step / roadmap row: <PLAN_14_DAY D<n>.<m> and/or roadmap row id>
- Why: <one line>
- Acceptance criteria: <numbered, each testable; name the test file/test>
- Files likely touched: <paths>  (hot spots marked ⚠)
- Interface contract: <exact signatures/fields this task adds or relies on, or "none">
- Estimate: <~N changed lines; basis>
- Approval-only: yes (<§2 category>) | no
- Depends on: <task ids / PR numbers / "Aashmiin: …"> | none
- Branch: <fix|feat|docs>/<slug>
- Demo/live check: <what to run in each mode>
- Not in scope: <what the engineer must not do>
```
End with: tasks deferred and why; questions for Aashmiin (→ Approval Queue).

## Worked split: target item 4 (correct Xero posting)
1. accounting-integrations-engineer: `PlanOptions.orgTimeZone` + `day()` + flip 17 `it.fails` +
   blocked-when-missing test (~160 lines; approval-only: posting).
2. accounting-integrations-engineer: Xero `GET /Organisation`, CLDR-derived map, scope
   `accounting.settings.read`, store `{xeroTimezone, ianaTimeZone, readAt}` (~220 lines incl.
   table; approval-only: permissions + posting). Depends on 1 merged, and Aashmiin approving ADR 0002.
3. frontend-product-engineer: account-code settings on `/books` (~200 lines; approval-only:
   posting rules). Depends on Aashmiin naming the Demo Company accounts.
4. frontend-product-engineer: request page shows "Posts as <date> (<org> time)" (~60 lines; not
   approval-only: display only, reads the plan).
5. qa-security-engineer: Xero Demo Company verification script: GET each posted Payment and compare
   amount (cents), account code, date with the plan (~150 lines; read-only). Depends on Aashmiin
   connecting the Demo Company.
