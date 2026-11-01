# Prove the test fails without the fix

A test that passes with the bug still in the code proves nothing (Google: "Will the tests actually fail
when the code is broken?"; see `review-standard.md` §2). We check it mechanically on every PR that
changes `src/` (or `next.config.mjs`, `middleware.ts`) and adds or changes tests.

## 1. Set up a scratch checkout (never your `ai-team` working copy)
```bash
SP=<your scratchpad dir>; N=<pr number>
git clone --quiet --filter=blob:none https://github.com/trysarathy/investigation-desk "$SP/pr-$N"
cd "$SP/pr-$N"
git fetch --quiet origin "pull/$N/head:pr-$N" && git checkout --quiet --detach "pr-$N"
HEAD_SHA=$(git rev-parse HEAD)            # must equal the PR's head.sha from gh api pulls/$N
BASE=$(gh api repos/trysarathy/investigation-desk/pulls/$N --jq .base.ref)
git fetch --quiet origin "$BASE"
MB=$(git merge-base HEAD "origin/$BASE")  # the diff the PR shows = git diff $MB HEAD
npm ci
```
If `npm ci` cannot run (no network), say so in the comment and in the Log; you may reuse a
`node_modules` only if `package-lock.json` is byte-identical (compare `md5sum`), and say that you did.

## 2. Run everything at the head
`npx tsc --noEmit`, `npm run lint` (not required yet: report new errors only, compare with the base),
`npx vitest run`, `npx next build`. Record exit codes and the test counts line
(`Tests  N passed | M skipped`). Compare counts with the base (`git checkout $MB`, rerun) when tests
were removed or skipped.

## 3. Revert the fix, keep the tests, run the tests
```bash
git diff $MB HEAD --name-only                    # classify: src/config files vs tests/
git diff $MB HEAD -- src next.config.mjs src/middleware.ts | git apply -R   # remove ONLY the fix
npx vitest run <each new or changed test file>   # expect: the new/flipped tests FAIL, on the bug's own assertion
git checkout -- .                                 # restore; git status must be clean
```
Read the failure messages: a test that fails for the wrong reason (an import error because the new
helper no longer exists, a TypeError) does not prove the behaviour. Say which.

## 4. Read the result
| What you see with the fix removed | Meaning | Severity |
|---|---|---|
| Every new/flipped test fails on its assertion | Tests prove the fix | — (state it in the checks block) |
| A new test **passes** | It doesn't test the change (it tests old behaviour) | `issue (blocking)` if it is the only test for an acceptance criterion; otherwise `suggestion (non-blocking)`: keep it as a regression guard but don't count it |
| A test fails only by import/type error | Not proof | `issue (blocking)` unless another test proves the criterion |
| An existing `it.fails` case was **deleted** instead of flipped | The bug that case shows is probably still there: run the deleted case against the head | **BLOCK** if it guards a security gap; otherwise `issue (blocking)` |
| `it.fails` flipped to `it` but the test file also loosened an assertion | Weakened test | `issue (blocking)` (BLOCK for a security test) |

## 5. Probes for the code itself (not only the tests)
Write probes **in the scratch checkout only** (a temporary `tests/zz-probe.test.ts` you delete before
leaving), and paste inputs and outputs in the comment:
- **Money:** the exact boundary value of any threshold, a 6-decimal amount (USDC/USDT), a large amount
  (≥ 100,000.00), and the same difference at two magnitudes (a float result changes with magnitude; an
  exact one never does). Check that the posted lines add up, to the cent, to what the books will show.
- **Dates:** 23:59 SGT, 00:00 SGT, 07:59 SGT (UTC still the previous day), 07:30 SGT on the 1st (month
  end), the same instant in a non-Singapore org (New York), and the provider's real timezone string
  (Xero: `SINGAPORESTANDARDTIME`).
- **Guards:** every live spelling (`off`, `live`, `0`, `false`), the demo default (unset), and `on`.
- **CSV:** every case in `tests/security-csv-cell.test.ts`, more than one leading invisible character,
  other invisible format characters, and an ordinary customer reference in non-ASCII letters (it must
  come out unchanged apart from the neutralising prefix/quotes).

## 6. Worked run (2026-11-01, real branch)
`security/demo-reset-guard` (qa-security-engineer's test for gap #1, no fix yet): with the test as
`it.fails` the suite is green; changing it to `it`
(`sed 's/it\.fails(/it(/' tests/security-demo-reset.test.ts > tests/tmp-dr.test.ts && npx vitest run tests/tmp-dr.test.ts`,
then delete the temp file) gives 1 failed, `AssertionError: cases.json deleted: expected false to be true`:
it fails on the bug's own assertion, so a fix PR that flips it and goes green has proved the fix.
[VERIFIED: ran 2026-11-01]
