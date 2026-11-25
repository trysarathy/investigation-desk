# Clearline v1: progress

Updated after every PR. If a session is interrupted, resume from the "Next" line.

Base: Phase 0 stack #164–#175 on `release/v1` (top `v1/p0-12-settlement-numbers`, 6352925). Nothing is merged.

## Phase 0 (done, reported 24 Nov 2026)
12 stacked draft PRs #164–#175. Founder decisions on them (25 Nov 2026): #167, #171, #173, #174 approved; #170 approved
once the existing isolation tests pass unchanged on it — shown 25 Nov: the pre-#170 versions of
`chain-reads-partitioning.test.ts`, `chain-verify.test.ts` and `provider-console.test.ts` ran on #170's code on a fresh
database: 3 files, 18/18 passed [VERIFIED]; the full control suite on the stack top: 414/414 [VERIFIED].

## v1 continuous build

| Phase | Status | PRs | Notes |
|---|---|---|---|
| 0.5 Matching useful | integrated (wave 1), not merged | w1-02, w1-03, w1-22 … w1-26, w1-33, w1-36 | blind breakdown, evidence-level split (12–16), unlinked-grouping match (guarded), other-currency accounts, fiat rates, revaluation proposals, property tests |
| decision follow-ups | integrated (wave 1), not merged | w1-01, w1-04 … w1-06 | CI flake + retries 0, #115 docs, needs-a-rate, IAS 21 draft, refund rows (0046), partitions 24 months (0047), deploy-env required |
| 1 Accounts, security, access | integrated (wave 1), not merged | w1-07 … w1-21, w1-27 … w1-32, w1-35 | onboarding + provisioning role (0048–0049), MFA/passkeys/reset/sessions/limits (0050–0051), entity scoping (0053–0054), access review; one EmailSender (0068), setup needs an unscoped Admin (0069). OIDC SSO not built |
| 2 Real data connections | not started | | |
| 3 Volume and workers | not started | | |
| 4 Accounting workflow | not started | | |
| 5 Security, privacy, ops | not started | | |
| 6 Deployment (ready, not provisioned) | not started | | |
| 7 Prove it | not started | | |
| 8 Go-live gate | not started | | |

## Wave 1 stack (local branches, not pushed; each based on the previous one, the first on 6352925)

| Slice | Purpose | Approval-only |
|---|---|---|
| w1-01-ci-docs | clearline-browser flake fixed, retries 0, #115 docs, PROGRESS/DECISIONS files (A4) | no |
| w1-02-bank-fingerprint-currency | bank account in a statement line's fingerprint; other-currency batches tie in their own currency, mismatch is an exception (A2) | yes (matching) |
| w1-03-fiat-rates-revaluation | fiat_rates (0044); revaluation proposals; FX posting rules DRAFT; journal "when" values ordered (A2 + integration) | yes (FX rules) |
| w1-04-needs-a-rate-ias21 | token-priced invoices "needs a rate", never 0; IAS 21 DRAFT (A3) | no (draft doc) |
| w1-05-refund-rows | refund rows in per-payment files (0046, #174) (A3) | yes (draft) |
| w1-06-partitions-deploy-env | partitions 24 months (0047); CLEARLINE_DEPLOY_ENV required (A3) | yes (deploy guard) |
| w1-07-provisioning-db | clearline_provisioning role, onboarding tables, prov_* (0048–0049) (B1) | yes (new role) |
| w1-08-onboarding-services | email sender, provisioning connection, console, invitations, wizard services, CLI (B1) | no |
| w1-09-onboarding-tests | provisioning role, runtime grants, wizard, console, invite-only tests (B1) | no |
| w1-10-onboarding-ui | console, invitation page, wizard UI (B1) | no |
| w1-11-onboarding-e2e | onboarding Playwright suite and runbook (B1) | no |
| w1-12-auth-db-outbox | MFA/passkey/token/outbox/limit tables (0050–0051); trusted address, limits, outbox, verification (B2) | yes (security) |
| w1-13-passkeys | passkeys as a second factor, hand-written WebAuthn verifier (B2) | yes (review) |
| w1-14-mfa-gate | TOTP required for Admin/Approver, gate, endpoint allow-list, reset, limits (B2) | yes (security) |
| w1-15-sessions-api | own sessions, revoke, step-up, org MFA policy (B2) | yes (security) |
| w1-16-auth-ui | sign-in second step, reset, verification, Security page (B2) | no |
| w1-17-auth-tests | login security unit and control tests (B2) | no |
| w1-18-auth-e2e | login security in the browser; deployment note (B2) | no |
| w1-19-entity-scope | per-entity scope, restrictive RLS (0053), access-review columns (0054), server enforcement (B3) | yes (security) |
| w1-20-entity-scope-tests | entity scope control tests (B3) | no |
| w1-21-access-review | access review, CSV/PDF; settings and sample lists scoped; e2e (B3) | no |
| w1-22-blind-breakdown | blind breakdown by blocking reason, BEFORE numbers (A1) | no |
| w1-23-evidence-split-engine | evidence-level split in the engine and store (0042) (A1) | yes (matching, decisions 12–16) |
| w1-24-evidence-level-ui | evidence level shown everywhere; MATCHING_RULES (A1) | no |
| w1-25-grouping-unlinked-matched | a proposed grouping no longer blocks matched; blind breakdown after (A1) | yes (matching) |
| w1-26-split-refund-control-test | #174 control test under the evidence split (integration) | no |
| w1-27-one-email-sender | one EmailSender, outbox table; invitation email in its transaction (0068) (integration) | yes (new prov function) |
| w1-28-mfa-test-fixtures | fictional Admins/Approvers get a known test TOTP; onboarding enrols the new Admin (integration) | no |
| w1-29-demo-mfa | demo authenticator; switcher session MFA-proved in a demo build only; marker `mfa` (integration) | yes (security, demo only) |
| w1-30-access-review-mfa | access review reads users.two_factor_enabled and passkeys (integration) | no |
| w1-31-entity-scope-coverage | setup needs an unscoped Admin (0069); catalogue test of entity policies (integration) | yes (tightens) |
| w1-32-runtime-grants-snapshot | runtime-grants snapshot regenerated (integration) | yes (review the grant list) |
| w1-33-unlinked-grouping-guard | the unlinked-grouping match never closes a refunded, part-paid or different order (integration) | yes (matching, tightens) |
| w1-34-merchant-setup-timeout | one control test's timeout 60 → 180 s (integration) | no |
| w1-35-merchant-header-security-link | Security link contrast in the merchant header (integration) | no |
| w1-36-chain-unavailable-perf | step 1a no longer quadratic; identical results (found by e2e:blind) (integration) | no (same outputs; matching code touched, review) |
| w1-37-progress-decisions | this file and the decisions log | no |
| w1-38-evidence-chip-wraps | the bank evidence chip wraps at 390 px (found by the demo suite) (integration) | no |
| w1-39-demo-analyze | the seeded demo is analysed before its template (Approvals page 4 s → fast) (integration) | no |
| w1-40-test-counts | the counts below | no |

## Test counts on the stack top (wave 1)

Local runs, 25 Nov 2026, fresh databases (PostgreSQL 16), retries 0. Revision: top of the stack (w1-39, 41f4652) unless
noted; "w1-37" = 26e2c14, which differs from the top only by the evidence-chip CSS (w1-38) and the demo script (w1-39).

| Check | Result |
|---|---|
| `npx tsc --noEmit` (every slice w1-01 … w1-39 on its own, and the top) | 0 errors [VERIFIED] |
| lint (shared config) | 0 errors, 68 warnings [VERIFIED] |
| `npx vitest run` | 2,823 passed, 57 skipped (2,880), 159 files passed, 1 skipped [VERIFIED]. An earlier full run under load timed out one rc4 property test (5 s); alone it passed 25/25 |
| `npm run test:control` (with the provisioning URL) | 510 / 510, 48 files [VERIFIED] |
| control-e2e (pilot build), incl. login-security spec | 34 / 34 (w1-37) [VERIFIED] |
| merchant-e2e (CLEARLINE_TEST_BUILD build, `check-chain-recording --expect present`: 1 file) | 37 passed, 1 skipped [VERIFIED] |
| onboarding Playwright spec (desktop + mobile) | 2 / 2 (w1-37) [VERIFIED] |
| `npm run build:prod-check` | every marker absent, `mfa` included; chain and demo checks absent [VERIFIED] |
| public demo browser (`playwright.clearline.config.ts`, plain build) | 291 passed, 11 skipped (w1-37) [VERIFIED] |
| funding-browser (random CLEARLINE_BROWSER_PASSWORD) | 4 / 4 (w1-37) [VERIFIED] |
| `npm run demo -- --fresh --no-start` (private PostgreSQL 16) | ok, 2 min 31 s; 2 demo Admin/Approver logins enrolled; ANALYZE; demo marker present, `mfa` marker present in `.next-demo` |
| `demo:reset` × 3 | 678 ms, 369 ms, 308 ms |
| demo suite (`playwright.demo.config.ts`) | 28 / 28 [VERIFIED] (before w1-38/w1-39: 24 passed, 4 failed — chip overflow and the 4 s Approvals page) |
| `npm run e2e:blind` (fresh database, w1-37) | 1 passed (2.1 min): matched 1,445 (74.03 %), review 466 (23.87 %), exception 41 (2.10 %), **wrong matches 0** (both entities, flag off and on); idempotent [VERIFIED] |

## Next
Review the approval-only slices; push the wave 1 stack as stacked draft PRs on #175 when asked; then Phase 2.
