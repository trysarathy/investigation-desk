# CI baseline and the failed browser run (rc5 PR 1, 21 Nov 2026)

## The failure: run 43730455949

- **Workflow:** "Clearline customer-preview browser acceptance" (`.github/workflows/clearline-browser.yml`).
  Pull-request event, `rc4/clearline-app` at `280fcd2`.
- **Failing step:** "Test customer journeys on desktop and mobile" — 256 passed, **1 failed**, 11 skipped. It failed
  again on retry #1.
- **The failing test:** `tests/browser/clearline-accounting.spec.ts` › "accounting and audit pages: axe 0
  violations and no horizontal overflow …".
- **The error:** `set CLEARLINE_AXE_PATH or QA_AXE_PATH` (`expect(axe).not.toBeNull()`).

### Root cause

1. **axe-core was not a dependency.** CI ran `npm ci` and set neither env var, so the accounting spec, which
   *requires* axe, failed. The rc4 manifest says so: "axe-core is not a pinned dependency (checks run when the env
   var is set; every run above set it)".
2. **The other axe tests passed without running axe.**
   - `clearline-console.spec.ts` and `clearline-journey.spec.ts` resolved `axe-core` if it happened to be
     installed, and otherwise only added an annotation.
   - `clearline-qa-rc3.spec.ts` and `clearline-qa-rc4.spec.ts` called `test.skip` when `QA_AXE_PATH` was unset.

   So in CI, no axe check ran at all; the one honest test was the one that failed.
3. **There is a real violation behind the gap.** With axe actually running (axe-core 4.14.0), the console and
   journey axe tests fail on almost every page:
   - **Rule:** `label-content-name-mismatch`, serious, WCAG 2.5.3 *Label in Name*.
   - **Element:** the sidebar brand link (`AppShell.tsx`). Its `aria-label="Clearline console overview"` replaced
     the visible text "clearline.".
   - **Why now:** axe 4.14 runs this rule by default; it no longer carries the `experimental` tag.

### Fix (no assertion weakened, no test disabled)

- **Pinned axe-core:** `axe-core` is an exact devDependency at **4.14.0**, released 2026-10-05. I did not use
  4.14.1: it was released 2026-11-16, under two weeks old.
- **One shared loader:** `tests/browser/axe-source.ts` resolves the package. `CLEARLINE_AXE_PATH` and
  `QA_AXE_PATH` still override it. The loader **throws** if axe cannot be loaded, and the
  skip/annotation-when-absent paths are removed from all five specs.
- **QA specs:** in the two QA specs, only the axe source and the skip changed. Their assertions are untouched.
- **The UI fix:** the brand link's accessible name now starts with its visible word. The decorative period is
  `aria-hidden`, and a visually hidden " console overview" follows it.
- **Workflow:** `clearline-browser.yml` now also runs when any `tests/browser/clearline-*.spec.ts`, the axe loader
  or `package*.json` changes. Before, only `clearline-console.spec.ts` triggered it.
- **Chromium fallback:** `playwright.clearline.config.ts` falls back to the current sandbox Chromium
  (`chromium-1243`) as well as the stale `chromium-1194`. CI is unaffected; it installs Playwright's own browser.

## Results (this session; fictional data)

| Check | Commit / state | Result |
|---|---|---|
| Baseline browser suite, `--retries=0`, no axe env, sandbox Chromium 1243 | 280fcd2 + only `axe-core` present as an *unpinned* leftover in `node_modules` | **251 passed, 6 failed, 11 skipped**. The 6 failures: the accounting test (no env var) and 5 console/journey axe tests (`label-content-name-mismatch`). The 11 skips: 7 desktop-only plus 4 QA axe tests skipped for lack of `QA_AXE_PATH`. |
| Browser suite after the fix, `--retries=0`, no axe env, config fallback Chromium | working tree of this PR | **261 passed, 7 skipped, 0 failed** (4.5 min). The 7 skips are the `test.skip(isMobile, …)` desktop-only checks. |
| Negative control: `QA_AXE_PATH=/nonexistent/axe.min.js`, rc4 axe test, desktop | this PR | **fails** with "axe override … does not exist". Before the fix, the same run skipped. |
| `npx tsc --noEmit` | this PR | exit 0 |
| `npx vitest run` | this PR | **90 files passed, 1 skipped; 1820 passed, 57 skipped, 0 failed**. All 57 skips are in `tests/real-record.test.ts`, a legacy-app network recorder that is skipped unless `RECORD_REAL` is set. |
| `npx next build` | this PR | exit 0 |
| `npm run lint` | this PR | **331 errors, 62 warnings**, unchanged from 280fcd2. None is in a file this PR touches. This job is not a required check. |

### First local attempt

My first local reproduction is void. Playwright 1.65 looked for `chromium_headless_shell-1254`, but this container
has build 1243, so every test failed at browser launch before any assertion ran. I reran it with the installed
browser, and that rerun is the baseline row above.

## The lint job (not fixed in this PR)

`npm run lint` fails on `280fcd2` with 331 errors and 62 warnings:

- `prefer-const`: 311 errors, of which 288 are in `tests/clearline`.
- `@typescript-eslint/no-require-imports`: 15 errors, all in `team/**` knowledge scripts.
- `react/no-unescaped-entities`: 4 errors.
- `@next/next/no-html-link-for-pages`: 1 error.

The last two (5 errors) are the ones in `src/app/settings`, `src/app/books` and `src/components/Investigation.tsx`.
The planned fix is a separate PR (1b) that fixes the code rather than disabling rules.
