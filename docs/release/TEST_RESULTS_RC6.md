# rc6 test results (22 Nov 2026)

Test mode · illustrative data.

- **What was seen:** every result below was seen in this session, on fictional data.
- **"Local":** this container, with PostgreSQL 16, Node 22 and Chromium 1243.
- **"CI":** GitHub Actions on each PR head, read from the check-runs API.
- **Reviews were not independent.** Every review in rc6 was done by agents launched from the same session that wrote the code.

## Local: integrated stack (`rc6/reconstruct` at `fdc48d7`, which contains every rc6 PR and rc5 #114–#125 plus #120)

| Suite | Command | Passed | Failed | Skipped |
|---|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 | — | — |
| Lint | `npm run lint` | 0 errors (63 warnings, same as rc5) | 0 | — |
| Engine and legacy unit suite | `npx vitest run` | **2122** | 0 | 57 (all in `tests/real-record.test.ts`, which runs only with `RECORD_REAL`) |
| Control integration, real PostgreSQL 16 | `npm run test:control` | **194** in 12 files (rc5: 137 in 7) | 0 | 0 |
| Pilot build | `CLEARLINE_CONTROL_PILOT=1 … npx next build` | exit 0 | — | — |
| rc5 control end-to-end, desktop + iPhone 13 | `npm run e2e:control -- --retries=0 --trace off` | **24** | 0 | 0 |
| rc6 merchant and provider end-to-end, desktop + iPhone 13 | `npx playwright test -c playwright.merchant.config.ts --retries=0 --trace off` | **25** | 0 | 1 (the load-time check, desktop only by design) |
| Public demo build | `CLEARLINE_CUSTOMER_PREVIEW=1 npx next build` | exit 0 | — | — |
| Public demo browser suite, including `/clearline/cases` | `npx playwright test --config=playwright.clearline.config.ts --retries=0 --trace off` | **291** (rc5: 261) | 0 | 11 (`test.skip(isMobile, …)`) |

### rc6 unit files (run again for this document: `npx vitest run <files>`, 302 passed, 0 failed)

| File | Tests | PR |
|---|---|---|
| `tests/clearline/merchant/rules-steps1-4.test.ts` | 31 | #128 |
| `tests/clearline/merchant/case1.test.ts` | 11 | #128 |
| `tests/clearline/merchant/properties.test.ts` | 25 | #128–#130 |
| `tests/clearline/merchant/rules-step5.test.ts` | 8 | #129 |
| `tests/clearline/merchant/case2.test.ts` | 10 | #129 |
| `tests/clearline/merchant/rules-partials.test.ts` | 5 | #130 |
| `tests/clearline/merchant/case3.test.ts` | 7 | #130 |
| `tests/clearline/merchant/journal.test.ts` | 24 | #131 |
| `tests/clearline/merchant/adapters.test.ts` | 20 | #132 |
| `tests/clearline/merchant/adapter-conformance.test.ts` | 25 | #132 |
| `tests/clearline/merchant/cases-demo.test.ts` | 23 | #136 |
| `tests/clearline/merchant/reconstruct.test.ts` | 21 | #137 |
| `tests/clearline/connect-conformance.test.ts` | 92 | rc5 #120 (merged into the rc6 base) |

The rc6 control files are `merchant-schema` (9), `merchant-ingest` (14), `merchant-security` (11), `merchant-ui` and `provider-console`; the latter two are counted only in the 194 total, not per file. Rule proofs: each of the 42 rule IDs has a test that fails when that rule alone is disabled (`docs/plan/RC6_RULE_PROOFS.md`).

### What the merchant end-to-end journey proves (desktop and phone)

- **Merchant journey:** Finance signs in, reconciles and opens the daily report, then opens BK-24817 and sees the five records side by side, the rule and the difference.
- **Write-off approval:** a different Approver approves the write-off. The preparer has no approve control and gets a 403 from the API.
- **Exceptions:** each exception shows an owner, a reason and a next step.
- **Batches:** each batch bridge line can be clicked through to its payment.
- **Month-end:** month-end shows the receivable from the provider. Evidence downloads as PDF, CSV and JSON.
- **Provider without a grant:** the provider sees aggregates only, and gets a 403 on merchant rows.
- **Provider with a grant:** after the merchant grants full access, the provider can read rows (read-only); revoking the grant closes access again.
- **Provider invitations:** the provider can invite Viewers only.
- **Checks on every page:** accessibility (axe), no horizontal scroll at 390 px, and the label "Test mode · illustrative data".

## Runbook verified end to end on a fresh database (`clearline_rc6_smoke`)

Every step in `docs/runbooks/DEPLOYMENT_RUNBOOK_RC6.md` was run against a new database, using a pilot build served by `next start` on port 3209:

| Step | Result |
|---|---|
| `setup-local.sh` and `drizzle-kit migrate` (0000–0014) | applied |
| `control:admin seed-merchant-cases` | "seeded a fictional provider, 2 fictional merchants (ENT-SG-01, ENT-SG-02, ENT-US-02, ENT-AE-03) and 10 fictional users" |
| Pilot build | exit 0 |
| Sign-in as finance@straits-demo, finance@dunehaven-demo and admin@northwind-pay | 200 ×3 |
| `POST /api/control/merchant/reconcile` for each of the four entities | 200 ×4 |
| `GET /api/control/merchant/payments` (SG) | BK-24817 matched_with_difference [sender_side_fee] · BK-24823 exception [underpayment] · BK-24830 exception [overpayment] · BK-24836 suggested_for_review [requote_after_expiry] · BK-24871 exception |
| `GET /api/control/merchant/payments` (AE) | BK-25102 matched_with_difference |
| SG user reads the AE payment | 404 |
| Provider `GET …/provider/merchants` | aggregates only, labelled "Test mode · illustrative data", provider theme |
| Provider reads merchant payments without a grant | 403 |

The server was then stopped by its PID, after its working directory and environment were checked.

## CI on the PR heads (read 22 Nov 2026)

| PR | Head | lint | ci | control-db | control-e2e | clearline-browser | funding-browser |
|---|---|---|---|---|---|---|---|
| #126 plan | bb8852b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #127 schema | 8c86335 | ✓ | ✓ | ✓ | ✓ | not run | ✗ (flaky, see below) |
| #128 match-core | aba3893 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #129 match-bridge | 22aaf13 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #130 match-partials | 0d1210d | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| #131 journals | 44e951f | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (flaky) |
| #132 ingest | 77e8bb1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (flaky) |
| #134 merchant UI | 5b1ca48 | ✓ | ✓ | ✓ | in progress | in progress | ✓ |
| #135 provider console | 5bfc8be | ✓ | ✓ | ✓ | ✓ | not run | ✗ (flaky) |
| #136 cases demo | a9fbd4e | ✓ | ✓ | ✓ | ✓ | in progress | ✓ |
| #137 reconstruct | fdc48d7 | ✓ | ✓ | ✓ | ✓ | in progress | ✓ |

- **`funding-browser` is a pre-existing flaky test, not an rc6 regression:**
  - It belongs to the separate Funding Desk (`tests/browser/funding.spec.ts`), and rc6 changes no Funding file.
  - It failed the same way on rc5 #118 and #120.
  - Each failure is different: phone or desktop; a deep-equality mismatch, a timeout, or `undefined.advances`.
  - It passes on the stacked heads above each failure (#128, #136, #137).
  - It is reported here, not fixed.
- **The merchant end-to-end suite is not in CI.** `playwright.merchant.config.ts` runs locally only. The rc6 control integration tests do run in CI, inside `control-db`. Adding a `merchant-e2e` job is proposed; it costs no money on GitHub's free runners but changes CI, so it is listed for the founder.
- **"In progress" means not seen green.** These checks are not reported as passing.
