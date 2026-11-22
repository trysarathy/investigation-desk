# rc5 test results (22 Nov 2026)

All results below were seen in this session, on fictional data. "Local" means this container: PostgreSQL 16.15, Node 22, Chromium 1243. "CI" means GitHub Actions, using a `postgres:16` service container.

## Local — integrated stack (`rc5/control-ui` at `d199e0a`, which contains every rc5 backend PR)

| Suite | Command | Passed | Failed | Skipped |
|---|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 | — | — |
| Lint | `npm run lint` | 0 errors (63 warnings) | 0 | — |
| Engine and legacy unit suite | `npx vitest run` | **1820** | 0 | 57 (all in `tests/real-record.test.ts`, a network recorder that runs only with `RECORD_REAL`) |
| Control integration, real PostgreSQL 16 (schema, auth, workflow, imports, accounting, hardening, API) | `npm run test:control` (`CLEARLINE_TEST_OWNER_URL` / `_RUNTIME_URL` set) | **137** in 7 files | 0 | 0 (never skipped; prints BLOCKED without a database) |
| Control end-to-end, desktop 1440 + iPhone 13 | `CLEARLINE_CONTROL_PILOT=1 … npx next build`, then `npm run e2e:control` (`--retries=0 --trace off`) | **24** (12 + 12) | 0 | 0 |
| Public demo browser suite (customer-preview build), desktop + iPhone 13 | `CLEARLINE_CUSTOMER_PREVIEW=1 npx next build`, then `npx playwright test --config=playwright.clearline.config.ts --retries=0 --trace off` | **261** | 0 | 7 (`test.skip(isMobile, …)`, desktop-only by design) |
| Pilot build | `CLEARLINE_CONTROL_PILOT=1 DATABASE_URL=<runtime> BETTER_AUTH_SECRET=<test> CLEARLINE_ORIGIN=http://127.0.0.1:3197 npx next build` | exit 0 | — | — |

Separate branch (`rc5/adapter-conformance` at `e2f3577`; engine only):

| Suite | Command | Passed | Failed | Skipped |
|---|---|---|---|---|
| Connect adapter conformance (3 fictional adapters) | `npx vitest run tests/clearline/connect-conformance.test.ts` | **92** | 0 | 0 |
| Full default suite with conformance | `npx vitest run` | **1912** | 0 | 57 |

### What the e2e journey proves

1. **Ops sees the Redwood payment.**
   - Payment Ops signs in and opens Redwood Supplies (`INV-2026-188`).
   - The provider reported it *completed* and later *returned*.
   - The statement shows −12,784.90 and +12,784.90, net 0.00, and **"Supplier still unpaid"**.
2. **Ops prepares the case.**
   - Ops assigns the case to themselves.
   - Ops sets the priority, next action and due date, then adds a note.
   - Ops attaches the funds-returned confirmation.
   - Ops requests the resolution, citing evidence.
3. **Ops cannot approve.**
   - No approve control is shown to ops.
   - A direct API approval by ops gets a 403.
4. **A different person approves.**
   - The Approver signs in and approves with the payload hash shown.
   - The exception is resolved, and the **supplier is still unpaid**.
5. **The report is downloadable.** The approver downloads the JSON report, which contains the approval and the evidence references.
6. **State persists:**
   - across logout, login and reload;
   - across a real `next start` restart.
7. **Organisations are isolated.** A Harbour user cannot select Lumen (404), and the API returns 404 for Lumen's data.
8. **Unauthenticated and cross-origin requests are refused.**
   - A page without a session redirects to sign-in.
   - An API call without a session gets 401.
   - A foreign-Origin POST gets 403.
9. **The pages pass accessibility and layout checks.**
   - axe reports 0 violations on every page, desktop and mobile.
   - No page overflows horizontally at 320, 390, 768 or 1440.

## CI — GitHub Actions (per PR head; observed)

| PR head | ci | lint | control-db | clearline-browser | funding-browser |
|---|---|---|---|---|---|
| #114 `9b7532c` | ✅ | ❌ (expected: fixed by #116) | — | ✅ | ❌ flaky* |
| #116 `9381834` | ✅ | ✅ | — | — | ❌ then ✅ on re-run (flaky*) |
| #117 `fa3be5c` | ✅ | ✅ | ✅ | ✅ | ✅ |
| #118 `e02204b` | ✅ | ✅ | ✅ | ✅ | ❌ flaky* |
| #119 `005c621` | ✅ | ✅ | ✅ | — | ✅ |
| #120 `e2f3577` | ✅ | ✅ | — | ✅ | ❌ flaky* |
| #121 `388f08b` | ✅ | ✅ | ✅ | — | ✅ |
| #122 `81f271e` | ✅ | ✅ | ✅ | — | ✅ |
| #123 `491a659` | ✅ | ✅ | ✅ | — | ✅ |
| #124 `d199e0a` | ✅ | ✅ | ✅ | ✅ | ✅ — and **`control-e2e` ✅ (24 passed in GitHub Actions)** |

\* **`funding-browser` (the separate Funding Desk app; not touched by rc5)** fails intermittently on one test. The failure is an HTTP 500 in `tests/browser/funding.spec.ts:45`.
- **Why I call it flaky:** heads that contain the same code pass. The rc4 baseline `280fcd2` and the #113 head `e318145` pass too.
- **Status:** not investigated further, and not counted as passing.

The `control-e2e` workflow (`.github/workflows/control-e2e.yml`, with a `postgres:16` service container) ran on #124: **24 passed**. It is not a required check (branch protection is the founder's setting).

## Not run / blocked

- **Hosted staging:** BLOCKED. There is no approved hosted database or host; running one costs money and needs founder approval.
- **Independent review:** BLOCKED. Every review in rc5 was done by agents launched by the implementing session. They are useful, but they are **not independent**.
- **Each regression test failing before its fix:** I verified this for the Connect reconciler defect (recorded as `it.fails` in `2c35478`) and for the rc5 CI accessibility fix. I did **not** verify it for every hardening test.
