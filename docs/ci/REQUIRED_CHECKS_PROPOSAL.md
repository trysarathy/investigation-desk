# Proposal: required checks on `main` (v1)

Status: **proposal only.** Nothing has been changed on GitHub: no branch protection, no ruleset, no rerun.

What `main` has today [VERIFIED on 24 Nov 2026 with the REST API]:
- **Classic branch protection: none.** `GET /repos/trysarathy/investigation-desk/branches/main/protection` returns 404 "Branch not protected".
- **A repository ruleset named `main`** (id 26284409, enforcement `active`, target `~DEFAULT_BRANCH`), from `GET /repos/.../rules/branches/main`:
  - no deletion;
  - no force push (`non_fast_forward`);
  - a pull request is required, with 0 approving reviews.
  - Repository admins may bypass it through a pull request.
  - It has **no required status checks**: a red PR can be merged today.

## The five checks to require

| Check (job name) | Workflow file | What it runs |
|---|---|---|
| `ci` | `.github/workflows/ci.yml` | Typecheck; unit tests; **the v1 production-build gate** (`npm run build:prod-check`: a plain `next build`, then no demo, recorded-chain, role-switcher, presenter-guide, feedback, reset, demo-calendar or demo-seed code in the server or client bundles); the rc8 recorded-chain and demo checks as separate steps |
| `lint` | `.github/workflows/ci.yml` | ESLint |
| `control-db` | `.github/workflows/ci.yml` | `npm run test:control` on a fresh PostgreSQL 16 |
| `control-e2e` | `.github/workflows/control-e2e.yml` | Control browser journeys (desktop and phone), `--retries=0` |
| `merchant-e2e` | `.github/workflows/merchant-e2e.yml` | Merchant and provider browser journeys on a TEST build (`--retries=0`). It also proves the recorded-chain marker is found in a test build. |

**Why the production-build gate is a step of `ci`, not its own job:** `ci` is already required, and `ci` already makes the production build. The gate replaces that build step (`npx next build` → `npm run build:prod-check`, which builds once with the demo and test switches removed). So the gate adds about 1 s of scanning and no second build. A demo or test build can never satisfy it.

**Proof that the gate catches what it looks for:**
- `npm run build:demo-check` builds a demo build into `.next-demo` and requires every demo marker to be FOUND there.
- The demo seed must still be absent, even in a demo build: it is never bundled.
- The merchant-e2e test build already proves the recorded-chain marker (`check-chain-recording.mjs --expect present`).

The demo-check is not proposed as a required check: it is a second full build (about 2 minutes), and it proves the markers rather than the product. Run it whenever a marker or a demo-only module moves. `tests/server/prod-build-gate.test.ts` checks, on every `ci` run, that each marker is still in its module's source.

**Why these five can be required [VERIFIED by reading the workflows]:** all five run on every pull request, with no `paths:` filter. A required check that does not run leaves the PR waiting forever.

**Not proposed as required:**
- `clearline-browser` (`clearline-browser.yml`) and `funding-browser` (`funding-browser.yml`): path-filtered, so they do not run on every PR. See also the flaky test below.
- `replay` (`funding-replay.yml`) and `Mentor demo browser acceptance`: path-filtered or not part of v1.
- The Vercel preview.

## Flaky and failing checks: the evidence

**Sample:**
- The 300 most recent workflow runs, 13 Nov to 24 Nov 2026, from `GET /repos/.../actions/runs?per_page=100&page=1..3`.
- Within those, the 50 most recent (23 Nov 12:41 to 24 Nov 15:46 UTC), with the job conclusions of each from `GET /repos/.../actions/runs/{id}/jobs`.
- The logs of every failed job in the 50, and of the `clearline-browser` jobs, read from `GET /repos/.../actions/jobs/{id}/logs`.

### The 50 most recent runs [VERIFIED]

**Runs:** 47 success, 3 failure. Every run is attempt 1: nobody re-ran anything in this window.

| Job | Success | Failure |
|---|---|---|
| `ci` | 11 | 0 |
| `lint` | 11 | 0 |
| `control-db` | 10 | 1 |
| `control-e2e` | 10 | 0 |
| `merchant-e2e` | 10 | 0 |
| `clearline-browser` | 5 | 0 (but 2 contain a flaky test; see below) |
| `funding-browser` | 6 | 2 |
| `replay` | 6 | 0 |

### Failed, then passed on rerun, same sha

There is **exactly one** case in all 300 runs [VERIFIED: one run has `run_attempt` > 1]:

- Run 44986494101, `funding-browser`, branch rc5/lint at 9381834 (22 Nov):
  - attempt 1 failed (step "Run desktop and phone journeys");
  - attempt 2 passed.
- No other check failed and then passed for the same sha, by rerun or by a later run of the same workflow.

### 1. `funding-browser`: the funding store read race. Fixed; not quarantined.

- **Symptom:** `tests/browser/funding.spec.ts:45`, "prepare, approve, record payout, flag late repayment and export evidence", fails with `TypeError: Cannot read properties of undefined (reading 'advances')`. The API answered 500.
- **Cause [VERIFIED in #158]:** `FundingStore.load()` read the store file without the store's lock, so a read that overlapped a write was refused as an unsafe file.
- **Fix:** b6ac5e1 (#158 rc8/ci-checks). `load()` now takes the same lock as every other read and write. `tests/funding/store-concurrency.test.ts` fails without the fix.
- **Evidence it is the same flake, and that the fix holds [VERIFIED by checking whether each run's sha contains b6ac5e1]:**
  - Of the 59 `funding-browser` runs in the 300, the 14 failures are all on shas WITHOUT the fix.
  - These include the two in the last 50: rc8/access-setup 3daad2f (run 45308334965, 1 of 4 tests failed) and rc8/hardening-core 2c40a93 (run 45313271624, 2 of 4 failed). Both branches are siblings of #158, so neither has the fix.
  - The 5 runs on shas WITH the fix all passed. [ASSUMPTION: 5 runs is a small sample; keep watching.]
- `release/v1` contains the fix.

### 2. `clearline-browser`: an axe check hidden by `retries: 1`. Flaky; not quarantined.

- **Symptom:** `tests/browser/clearline-accounting.spec.ts:659`, "accounting and audit pages: axe 0 violations and no horizontal overflow …", failed its first attempt and passed on Playwright's automatic retry.
- **Where [VERIFIED in the job logs]:**
  - 0a79e37: `document-title (serious, 1)` at 1024 px;
  - 2184ac0: the same rule at 390 px.
- **How often:** 2 of the 5 most recent `clearline-browser` runs report "1 flaky"; 727d4cf, d6bcedc and fc74038 report none. The job still passed every time, because `playwright.clearline.config.ts` sets `retries: 1`. Run conclusions alone do not show this flake.
- **Suspected cause [GUESS]:** axe runs before the page's `<title>` is set after a client-side navigation or resize.
- **Proposal:**
  - Fix the wait in the test (wait for `document.title` to be non-empty before running axe).
  - Then set `retries: 0` like every other suite, so a flake fails loudly.
  - Do not quarantine it: it checks accessibility, and quarantining it would hide a real `document-title` violation if one appeared.

### 3. `control-db` at 727d4cf (the tip of `release/v1`): one unhandled database error. Not yet classified.

- **Symptom:** run 45429403352, job `control-db`:
  - **365 of 365 tests passed (33 files)**, but vitest reported **1 unhandled error**, so the job failed with exit code 1.
  - The error was `terminating connection due to administrator command` (57P01) on an idle `clearline_owner` pool connection.
  - Vitest attributes it to `tests/control/demo.test.ts`, "restores the seeded database exactly, in under 30 s, and a live pool recovers". That test ends every session on the copied database on purpose, then checks that the app's pool recovers.
- **Not shown to be a flake:**
  - It failed once and was not re-run.
  - The same job passed at 2184ac0 and 0a79e37, but `tests/control/demo.test.ts` changed between those runs and 727d4cf (commits 4d050ca and fd10723). So this may be a regression in the test rather than chance.
- **What would settle it [ASSUMPTION]:** run `npm run test:control` several times on a fresh database. The likely fix is in the test: give the owner pool an `error` listener, or end it before the reset terminates its connection.
- **Until it is settled:** `control-db` is not reliably green on `release/v1`. Requiring it would block the v1 merge PR, so this must be fixed (not quarantined) before the v1 PR.
- One local run on branch v1/p0-release-guard (727d4cf plus this phase's commits), fresh database, 24 Nov 2026 [VERIFIED]: 34 files, 372 of 372 tests passed, no unhandled error. One green run does not prove the failure was chance.

### 4. Not flaky: real failures

- `merchant-e2e` at e4311d8 (rc7/ledger-exports, run on 23 Nov): axe violations on four merchant pages, in a run with `--retries=0`. Later shas pass. This was a defect at that commit, fixed later, not a flake.
- The 27 `CI` failures in the 300 runs are on site, rc3, rc4 and early rc5 branches from before the lint baseline (#116) and the rc5 fixes. None of them is on a sha that later passed unchanged.

### Quarantined or excluded tests

- **None are quarantined.** No test is skipped for flakiness [VERIFIED: every `test.skip` in `tests/` is a documented project or viewport condition, for example "runs on desktop only"].
- The only retry in any suite is `retries: 1` in `playwright.clearline.config.ts`; see item 2.

## How the founder would apply this (not run by Claude)

`main` is already governed by the ruleset `main`, so the simplest change is to add a required-status-checks rule to that ruleset.

1. Read the ruleset first. A `PUT` replaces the rules list, so the existing three rules must be sent again:

```bash
gh api repos/trysarathy/investigation-desk/rulesets/26284409 > ruleset-main.json   # keep a copy
```

2. Then send the same ruleset with one more rule. Put this in `rules` next to the existing `deletion`, `non_fast_forward` and `pull_request` rules:

```json
{
  "type": "required_status_checks",
  "parameters": {
    "strict_required_status_checks_policy": true,
    "do_not_enforce_on_create": false,
    "required_status_checks": [
      { "context": "ci" },
      { "context": "lint" },
      { "context": "control-db" },
      { "context": "control-e2e" },
      { "context": "merchant-e2e" }
    ]
  }
}
```

```bash
gh api -X PUT repos/trysarathy/investigation-desk/rulesets/26284409 --input ruleset-main-with-checks.json
```

- `strict_required_status_checks_policy: true`: the PR branch must be up to date with `main` before merging.
- The existing `pull_request` rule requires 0 approvals. For the v1 merge, the founder may want 1, so that the independent review is recorded in GitHub.

**Order:** fix item 3 (`control-db` on `release/v1`) first. Otherwise the v1 merge PR is blocked by its own required check.
