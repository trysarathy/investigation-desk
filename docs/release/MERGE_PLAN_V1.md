# Merge plan: getting Clearline v1 into `main`

Status: **plan only.** Nothing has been merged, retargeted, closed or changed on GitHub. Every fact below was read on 24 Nov 2026 with the REST API (`gh api repos/trysarathy/investigation-desk/pulls?state=all&per_page=100`, `.../branches/...`, `.../rules/branches/main`) and local `git merge-base --is-ancestor` checks against `release/v1` (727d4cf). Labels: [VERIFIED] read or run, [ASSUMPTION] reasoned, not tested.

## Recommendation

**Merge `release/v1` into `main` as one reviewed pull request once v1 is finished, after an independent review of the whole diff. Do not merge the 50 draft PRs #114–#163 one by one.** Close them afterwards with a link to the merge commit (their review threads stay readable).

Why, in one paragraph: the drafts are not 50 independent changes. They are a chain in which each PR's base is the previous PR's branch, and the chain does not even start at `main` (see "The stack" below: 18 more stacked PRs (#82–#90, #93–#96, #99, #102, #104, #106, #110) sit between `main` and #114). Merging them one by one means about 65 merges, each followed by retargeting the next PR, in an order where a single mistake (merging a PR into its *base branch* instead of `main`) silently lands code in the wrong place. Every intermediate `main` would also be a state that was never tested as a whole. `release/v1` is exactly the tip of that chain plus the demo work [VERIFIED: every open PR head in #114–#163 except #115 and #133 is an ancestor of 727d4cf], CI has run on it as a whole on every push of `demo/integrated` (the run at 727d4cf is not green: `control-db` passed 365/365 tests but failed on one unhandled database error, see `docs/ci/REQUIRED_CHECKS_PROPOSAL.md`), and one merge gives `main` one known, tested state.

What the one-PR route costs: the review is one large diff (main..727d4cf: 447 commits, 973 files, +222,190 / −1,469 lines [VERIFIED: `git rev-list --count`, `git diff --shortstat`]). Mitigation: review it **by slice**, using the existing PRs as the reading order (their descriptions and diffs remain on GitHub), and require the full verification list below on the final merge commit.

## The stack [VERIFIED]

| Range | PRs | Shape |
|---|---|---|
| Before rc5 | #82–#90, #93–#96, #99, #102, #104, #106, #110 (18 open, stacked) | `main` ← #82 funding/m1-inputs ← … ← #89 ← #90 demo/mentor-funding-desk ← #93 … #96 ← #99 trial ← #102 ← #104 ← #106 rc3/clearline-app ← #110 rc4/clearline-app. All 18 heads are in `release/v1`. |
| rc5 | #114–#125 | #114 rc5/ci-a11y (base rc4/clearline-app = #110) ← #116 rc5/lint ← #117 … ← #125 rc5/docs-final. Side branches: #115 rc5/audit-docs and #120 rc5/adapter-conformance (bases #114 / #116). |
| rc6 | #126–#138 (not #133) | #126 rc6/plan (base rc5/docs-final) ← … ← #138 rc6/docs. |
| rc7 | #139–#157 | #139 rc7/plan (base rc6/docs) ← … ← #157 rc7/docs. |
| rc8 | #158–#161 | **siblings**, not a chain: rc8/ci-checks, rc8/exact-close, rc8/access-setup, rc8/hardening-core all have base rc7/docs. |
| — | #162 (closed) | rc8/hardening, base rc8/hardening-core; closed as contained in #163. |
| demo | #163 | demo/integrated, base rc8/hardening, title "Demo build (integration of rc5–rc7), not for merge". It merges #158, #159, #160 into the chain (merge commits abf907c, c8520db, d6bcedc) and then demo/world, demo/screens, demo/presenter. |
| v1 | — | `release/v1` was created from demo/integrated at 727d4cf [VERIFIED: branch head 727d4cf]. |

Open PRs in the range that are **not** in `release/v1` [VERIFIED by ancestry]:
- **#115 rc5/audit-docs** (33288ba): five docs files (ADR 0004, ENGINEERING_AUDIT_RC5, IMPLEMENTATION_PLAN_RC5, VERTICAL_SLICE_1, THREAT_MODEL). None of the five paths exists in 727d4cf (later threat models `docs/security/SECURITY_THREAT_MODEL_RC5/6/7.md` do). **Decision needed:** merge it on its own (docs only), or close it as superseded.
- **#133 fix/playbooks-20261122** (base `ai-team`): unrelated to v1; not part of this plan.
- #91, #92, #97, #98 and the site PRs (#101, #103, #105, #107, #111): not in `release/v1`; not part of this plan.

Each PR's number, head branch, base branch and head sha:

| # | State | Head | Base | Head sha |
|---|---|---|---|---|
| 114 | open | rc5/ci-a11y | rc4/clearline-app | 9b7532c |
| 115 | open | rc5/audit-docs | rc5/ci-a11y | 33288ba (not in release/v1) |
| 116 | open | rc5/lint | rc5/ci-a11y | 9381834 |
| 117 | open | rc5/db-foundation | rc5/lint | fa3be5c |
| 118 | open | rc5/auth | rc5/db-foundation | e02204b |
| 119 | open | rc5/control-workflow | rc5/auth | 005c621 |
| 120 | open | rc5/adapter-conformance | rc5/lint | e2f3577 |
| 121 | open | rc5/csv-import | rc5/control-workflow | 388f08b |
| 122 | open | rc5/accounting-persist | rc5/csv-import | 81f271e |
| 123 | open | rc5/security-hardening | rc5/accounting-persist | 491a659 |
| 124 | open | rc5/control-ui | rc5/security-hardening | d199e0a |
| 125 | open | rc5/docs-final | rc5/control-ui | 0a3dab0 |
| 126 | open | rc6/plan | rc5/docs-final | bb8852b |
| 127 | open | rc6/merchant-schema | rc6/plan | 8c86335 |
| 128 | open | rc6/match-core | rc6/merchant-schema | aba3893 |
| 129 | open | rc6/match-bridge | rc6/match-core | 22aaf13 |
| 130 | open | rc6/match-partials | rc6/match-bridge | 0d1210d |
| 131 | open | rc6/merchant-journals | rc6/match-partials | 44e951f |
| 132 | open | rc6/merchant-ingest | rc6/merchant-journals | 77e8bb1 |
| 133 | open | fix/playbooks-20261122 | ai-team | 0e35cc4 (not in release/v1; unrelated) |
| 134 | open | rc6/merchant-ui | rc6/merchant-ingest | 5b1ca48 |
| 135 | open | rc6/provider-console | rc6/merchant-ui | 5bfc8be |
| 136 | open | rc6/cases-demo | rc6/provider-console | a9fbd4e |
| 137 | open | rc6/reconstruct | rc6/cases-demo | fdc48d7 |
| 138 | open | rc6/docs | rc6/reconstruct | 7d0e02c |
| 139 | open | rc7/plan | rc6/docs | 59ed795 |
| 140 | open | rc7/doc-a-tolerance | rc7/plan | 8d0d85a |
| 141 | open | rc7/ingest-parse | rc7/doc-a-tolerance | d8fb22d |
| 142 | open | rc7/bank-formats | rc7/ingest-parse | eb99abd |
| 143 | open | rc7/mapping | rc7/bank-formats | 2d38093 |
| 144 | open | rc7/uploads | rc7/mapping | a0e24af |
| 145 | open | rc7/normalise | rc7/uploads | 5bc90c3 |
| 146 | open | rc7/synthetic | rc7/normalise | e4c8227 |
| 147 | open | rc7/upload-ui | rc7/synthetic | 6d2d978 |
| 148 | open | rc7/upload-review-ui | rc7/upload-ui | 52501e6 |
| 149 | open | rc7/chain-readers | rc7/upload-review-ui | f82f64f |
| 150 | open | rc7/engine-speed | rc7/chain-readers | 9a7609f |
| 151 | open | rc7/chain-verify | rc7/engine-speed | 6f899b4 |
| 152 | open | rc7/pipeline-truth | rc7/chain-verify | 633b2b0 |
| 153 | open | rc7/runs-jobs | rc7/pipeline-truth | 6380d97 |
| 154 | open | rc7/ledger-exports | rc7/runs-jobs | e4311d8 |
| 155 | open | rc7/admin-bench | rc7/ledger-exports | f7a06a9 |
| 156 | open | rc7/blind-test | rc7/admin-bench | eefb899 |
| 157 | open | rc7/docs | rc7/blind-test | 87c5bf4 |
| 158 | open | rc8/ci-checks | rc7/docs | b6ac5e1 |
| 159 | open | rc8/exact-close | rc7/docs | fc74038 |
| 160 | open | rc8/access-setup | rc7/docs | 3daad2f |
| 161 | open | rc8/hardening-core | rc7/docs | 2c40a93 |
| 162 | closed | rc8/hardening | rc8/hardening-core | 3267096 |
| 163 | open | demo/integrated | rc8/hardening | 727d4cf |

## The two routes, side by side

| | A. One PR: `release/v1` → `main` (recommended) | B. 50 (really about 65) stacked PRs, one by one |
|---|---|---|
| Merges | 1 | 18 (#82–#90, #93–#96, #99, #102, #104, #106, #110) + 46 (#114–#161 without #115 and #133) + #163 or its demo commits |
| Order risk | none | each PR must be retargeted to `main` after the one below it merges; merging into the old base branch instead puts code where `main` never sees it |
| Tested state of `main` | the exact tree CI ran on | 60+ intermediate states, none tested as a whole; rc8's four siblings each lack the other three's fixes (e.g. #160 and #161 lack #158's funding-browser fix, and their funding-browser runs failed for that reason, see `docs/ci/REQUIRED_CHECKS_PROPOSAL.md`) |
| Review | one large diff, read slice by slice using the existing PRs as the outline | many small diffs, but each must be re-reviewed after retargeting changes its diff |
| History | one merge commit; the 447 commits stay reachable under it | the same commits, plus ~60 merge commits |
| Demo code | arrives with v1, but kept out of every production build by the build gate | the same; #163 says "not for merge", so in route B the demo commits would need their own decision |

### How demo code stays out of production in either route

The demo (`npm run demo`) lives in the same tree, but it can never be part of a deployed build:

1. **Build-time constants** [VERIFIED by reading `next.config.mjs` and `src/server/demo-build.ts`]: `CLEARLINE_DEMO_BUILD` and `CLEARLINE_TEST_BUILD` are inlined at `next build`. Without them every demo branch is the constant `false` and the bundler drops it, together with the demo-only modules it imports.
2. **The production-build gate** (`npm run build:prod-check`, a step of the required `ci` job): a plain `next build` with the demo/test switches stripped, then fails if any marker is in the server or client bundles: demo, recorded-chain, role switcher, presenter guide, feedback note, demo reset, demo calendar, demo seed. `npm run build:demo-check` builds a demo build and shows that each marker IS found there, so the gate is known to catch them.
3. **Start-up refusal** (`src/server/deploy-guard.ts`): a demo or test build refuses to start with `NODE_ENV=production` and `CLEARLINE_DEPLOY_ENV=staging|production`; `next.config.mjs` refuses to make one for those environments.
4. **Runtime gates already in place**: demo routes answer 404 outside a demo build; in a demo build every demo convenience applies only to an organisation whose `data_mode` is `demo`, which only the schema owner can set.

Set `CLEARLINE_DEPLOY_ENV=staging` (or `production`) on every real deployment so that check 3 is active. [ASSUMPTION: no deployment sets it today; it is new in v1.]

## Steps (founder, after independent review; Claude does not run these)

1. Finish v1 on `release/v1` (Phase 0+ branches stacked on it, each reviewed).
2. Decide #115 (merge docs-only, or close as superseded).
3. Open one PR `release/v1` → `main`, titled as the v1 release. Put the slice outline in the description (rc5, rc6, rc7, rc8, demo, v1 phases), linking the existing PRs.
4. Independent review of the whole diff, slice by slice. Required checks green on the PR head (see `docs/ci/REQUIRED_CHECKS_PROPOSAL.md`).
5. Merge with a **merge commit** (not squash: the 447 commits and their messages are the audit trail of each slice; not rebase: the merge commits from demo/integrated would be rewritten).
6. Run the verification below on the merged `main`.
7. Close #114 and #116–#163 (except #133), and the 18 earlier stacked PRs listed above (#82–#90, #93–#96, #99, #102, #104, #106, #110), with a comment pointing at the merge commit. Do not delete their branches until the founder decides; the hard rule is never to delete branches without that decision.

## Verifying `main` afterwards

On a clean checkout of the merged `main`, with PostgreSQL 16 (superuser via `PGHOST`/`PGPORT`/`PGUSER`) and Chromium for Playwright:

```bash
git fetch origin && git checkout --detach origin/main && git log -1 --format='%H %s'
npm ci

# 1. Types, lint, unit tests
npx tsc --noEmit
npm run lint
npx vitest run

# 2. Integration tests on a FRESH database (never reuse one)
DB=clearline_verify_$(date +%s)
scripts/db/setup-local.sh "$DB" verify-owner-pw verify-runtime-pw verify-jobs-pw
CLEARLINE_TEST_OWNER_URL=postgres://clearline_owner:verify-owner-pw@127.0.0.1:5432/$DB \
CLEARLINE_TEST_RUNTIME_URL=postgres://clearline_runtime:verify-runtime-pw@127.0.0.1:5432/$DB \
CLEARLINE_TEST_JOBS_URL=postgres://clearline_jobs:verify-jobs-pw@127.0.0.1:5432/$DB \
npm run test:control

# 3. The production-build gate (plain build; no demo, chain-recording, switcher, guide, feedback, reset, calendar or seed code)
npm run build:prod-check
node scripts/build/check-chain-recording.mjs --expect absent
node scripts/build/check-chain-recording.mjs --marker demo --expect absent
#    and its proof: a demo build contains every demo marker (builds into .next-demo, not .next)
npm run build:demo-check

# 4. Browser suites, as their workflows run them (each builds what it needs; run them one after another)
E2E=clearline_e2e_$(date +%s); scripts/db/setup-local.sh "$E2E" e2e-owner-pw e2e-runtime-pw e2e-jobs-pw
#    control-e2e (.github/workflows/control-e2e.yml)
CLEARLINE_CONTROL_PILOT=1 DATABASE_URL=postgres://clearline_runtime:e2e-runtime-pw@127.0.0.1:5432/$E2E \
  BETTER_AUTH_SECRET=test-only-e2e-secret-not-for-deploy-0001 CLEARLINE_ORIGIN=http://127.0.0.1:3197 npx next build
CLEARLINE_E2E_OWNER_URL=postgres://clearline_owner:e2e-owner-pw@127.0.0.1:5432/$E2E \
CLEARLINE_E2E_RUNTIME_URL=postgres://clearline_runtime:e2e-runtime-pw@127.0.0.1:5432/$E2E \
  npm run e2e:control -- --retries=0 --trace off
#    merchant-e2e (.github/workflows/merchant-e2e.yml): a TEST build; never deploy this .next
M=clearline_e2e_merchant_$(date +%s); scripts/db/setup-local.sh "$M" e2e-owner-pw e2e-runtime-pw e2e-jobs-pw
CLEARLINE_TEST_BUILD=1 CLEARLINE_CONTROL_PILOT=1 DATABASE_URL=postgres://clearline_runtime:e2e-runtime-pw@127.0.0.1:5432/$M \
  BETTER_AUTH_SECRET=test-only-e2e-secret-not-for-deploy-0001 CLEARLINE_ORIGIN=http://127.0.0.1:3207 npx next build
node scripts/build/check-chain-recording.mjs --expect present
CLEARLINE_MERCHANT_E2E_OWNER_URL=postgres://clearline_owner:e2e-owner-pw@127.0.0.1:5432/$M \
CLEARLINE_MERCHANT_E2E_RUNTIME_URL=postgres://clearline_runtime:e2e-runtime-pw@127.0.0.1:5432/$M \
  npx playwright test -c playwright.merchant.config.ts --retries=0 --trace off
#    clearline-browser and funding-browser (plain builds)
npx next build && npx playwright test --config=playwright.clearline.config.ts
npx next build && CLEARLINE_BROWSER_PASSWORD=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))') \
  npx playwright test --config=playwright.funding.config.ts

# 5. Leave a plain production build behind, never the test build from step 4
npm run build:prod-check
```

The env names for the merchant and control suites must match what each workflow sets; if a workflow changes, the workflow file is the source of truth. Record the exact pass counts of every suite in the release notes; a suite that was not run is reported as not run, never as green.
