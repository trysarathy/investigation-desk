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
| 2 Real data connections | integrated (wave 2), not merged | w2-01 … w2-22, w2-55, w2-56 | camt.054/BAI2 (0070); TRON/ETH primary+fallback, Polygon/Base/Arbitrum/Solana behind flags (OFF), chain data conflicting (0071); Xero/QBO stand-in+sandbox, draft journals only under d2's sign-off (0072–0073); SFTP/e-mail pickup, allowlist, malware scan, orphans (0074); provider REST pull + webhooks (0075–0076, flag CLEARLINE_PROVIDER_API) |
| 3 Volume and workers | integrated (wave 2), not merged | w2-27 … w2-31 | worker, dead-letter, run manifests (0079), period close (0080); full month 167 s met, daily 177 s missed (d1's own bench, not re-run) |
| 4 Accounting workflow | integrated (wave 2), not merged | w2-23 … w2-26 | posting-rules sign-off (0077), month-end PDF/XLSX, Auditor role (0078; 0085–0086) |
| 5 Security, privacy, ops | integrated (wave 2), not merged | w2-32 … w2-50 | CSP/HSTS, one safe outbound client, fuzz, security CI, ASVS L2 map; logger/PII scrubber, alerts, health/status (0081), restore drill; export/deletion/retention (0082), DRAFT legal docs; field encryption expand (0083–0084) |
| 6 Deployment (ready, not provisioned) | integrated (wave 2), not merged | w2-51 … w2-54 | S3 store, prod-local, CI/CD with gated deploys, HOSTING_PROPOSAL (nothing provisioned, nothing paid) |
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

## Wave 2 stack (local branches, not pushed; each based on the previous one, the first on adb2c3f)

Twelve branches cherry-picked in the order c5, c4, c3, c1, c2, d2, d1, e1, e4, e3, e2, f1; every commit keeps its
subject and author, with an "Integration (wave 2)" note where it was adapted. A slice is one or a few source commits
(about 400 changed lines); larger units are single commits or units that only typecheck together (w2-26: d2's Auditor
database half does not typecheck without its app half; w2-29: d1's 0079 run manifests do not typecheck without the
worker commit — true on d1's own branch too). Integration fixes are w2-55 onwards.

| Slice | Head | +/− | Commits | Last commit (purpose) | Approval-only |
|---|---|---|---|---|---|
| w2-01-camt054-parser | cd6c5e1 | +541 −202 | 1 | feat(ingest): camt.054 debit/credit notification parser sharing the camt.053 reader | no |
| w2-02-bai2-parser | 4a135e3 | +581 −0 | 1 | feat(ingest): strict BAI2 parser (control totals, record counts, structure) | no |
| w2-03-bank-formats-pipeline | 8d2535e | +458 −19 | 3 | docs: bank API / open banking options note for Singapore and the UAE (no integration) | no |
| w2-04-evm-solana-readers | 2ade96e | +435 −27 | 1 | feat(chain): EVM reader for Polygon/Base/Arbitrum One and a Solana reader, behind per-network flags (default OFF) | no |
| w2-05-chain-conformance | 84eb8b1 | +457 −0 | 1 | test(chain): conformance suites for Polygon, Base, Arbitrum One and Solana | no |
| w2-06-chain-fallback | 8dafcd9 | +630 −38 | 1 | feat(chain): ChainReader interface and primary/fallback provider per network | yes |
| w2-07-chain-conflicting | 89e2824 | +208 −6 | 2 | fix(db): 0061 adds no index (the partition checks pin each partition's index set) | yes |
| w2-08-ledger-tables | ea0dce5 | +321 −1 | 1 | feat(ledger): connection, OAuth state, account map and draft-journal tables (0059-0060) | yes |
| w2-09-ledger-client | af22fe1 | +678 −0 | 1 | feat(ledger): token sealing, OAuth providers, rate limiter and draft-only API client | yes |
| w2-10-ledger-service | 61d96c9 | +662 −0 | 1 | feat(ledger): connect, refresh, read and draft-journal service and routes | yes |
| w2-11-ledger-tests | 4b8fc15 | +823 −0 | 1 | test(ledger): local Xero/QuickBooks stand-ins, control tests and route-level end to end | no |
| w2-12-ledger-page | 962b6c0 | +295 −2 | 1 | feat(ledger): Ledger page with connect/reconnect, organisation choice and drafts; docs | no |
| w2-13-upload-parser-hardening | adb44bd | +468 −19 | 2 | exports: one formula-injection rule for every CSV writer, with a property test | no |
| w2-14-upload-allowlist-malware | d916196 | +459 −3 | 1 | uploads: strict file allowlist, optional local malware scan, two-way orphan cleanup | yes |
| w2-15-pickup-sources | 37cc117 | +410 −3 | 1 | pickup: PickupSource interface, local SFTP and Maildir stand-ins, bounded MIME reader | no |
| w2-16-pickup-scheduled | d984592 | +637 −5 | 1 | pickup: scheduled, per-merchant pickup into the normal upload pipeline (0055) | yes |
| w2-17-pickup-docs | 3b4df70 | +164 −2 | 2 | tests: entity-scope policy count includes the two pickup tables (0055) | no |
| w2-18-provider-api-client | 86c81a9 | +338 −0 | 1 | feat(provider-api): an SSRF-safe HTTP client for provider APIs | yes |
| w2-19-provider-api-pull-webhook | b0e709f | +554 −0 | 1 | feat(provider-api): generic REST pull and webhook verification | yes |
| w2-20-provider-api-db | 0f73629 | +373 −0 | 1 | feat(db): provider API connections, pulls and webhook events (0057-0058) | yes |
| w2-21-provider-api-service | 60c21cd | +439 −1 | 1 | feat(provider-api): connections, pulls into the upload pipeline, webhook receiver | yes |
| w2-22-provider-api-tests | 0693b04 | +301 −2 | 2 | test(control): entity scope covers the provider API tables | no |
| w2-23-posting-rules-catalogue | 7e39911 | +202 −0 | 1 | feat(accounting): posting-rules catalogue with engine-generated worked examples | no |
| w2-24-posting-rules-signoff | 130fca8 | +505 −1 | 1 | feat(accounting): an Admin signs a posting-rules version after a fresh MFA step-up; postingRulesSigned fails closed | yes |
| w2-25-month-end-pack | 1834a6f | +521 −18 | 1 | feat(accounting): month-end pack as PDF and XLSX, with totals that reconcile across sections | no |
| w2-26-auditor | 561ed6e | +664 −17 | 5 | fix: keep the month-end view's shape; pin the Auditor policies on chain_reads | yes |
| w2-27-engine-volume-index | 6740af2 | +361 −25 | 2 | perf(bench): a volume benchmark against PostgreSQL, run stages and a stored-results digest | no |
| w2-28-bulk-statements | bc3ca29 | +110 −43 | 1 | perf(runs): bulk statements and one array parameter for a month of rows | no |
| w2-29-worker-runs | c7777ec | +1008 −88 | 3 | test(runs): idempotent runs, input manifests, the fingerprint guard, closed payments untouched | yes |
| w2-30-period-close | abd1c82 | +562 −10 | 1 | feat(period-close): maker-checker month lock, DB-enforced; corrections go to the next open month | yes |
| w2-31-volume-docs | 038c3a0 | +141 −3 | 2 | fix(0064): job_events entity_scope gets a WITH CHECK; the entity-scope test counts 36 policies | no |
| w2-32-csp-headers | 4615543 | +132 −12 | 1 | feat(security): tighten the CSP and add HSTS, COOP, CORP and a deny-all Permissions-Policy | yes |
| w2-33-safe-fetch | 30c8f2d | +435 −22 | 1 | feat(security): route every outbound request through one SSRF-safe client | yes |
| w2-34-parser-fuzz | cb9b7f0 | +337 −0 | 1 | test(security): fuzz every input parser on this base | no |
| w2-35-security-ci | c87d8cf | +593 −0 | 1 | ci(security): dependency audit gate and an offline secret scanner | no |
| w2-36-asvs-l2 | b61fc82 | +440 −0 | 1 | docs(security): map every ASVS 4.0.3 Level 2 requirement to code and tests | no |
| w2-37-logger-pii | 8343224 | +591 −1 | 1 | ops: one structured logger with a PII scrubber, a Sentry-shaped error tracker with a local file sink, and a CI check against logging request bodies | no |
| w2-38-ops-runbooks | eb08a74 | +410 −0 | 1 | docs: operations runbooks (deploy, rollback, incident response, key compromise, chain provider outage, restore) and the backup/PITR proposal | no |
| w2-39-alerts | 5557382 | +413 −0 | 1 | ops: alert rules engine and alert sinks (log, file, e-mail through the existing EmailSender) | no |
| w2-40-health-status | b1e84de | +635 −6 | 1 | ops: worker heartbeat, /api/health and /api/ready, a public status page, and the worker evaluating alert rules | yes |
| w2-41-backup-drill | 36c68a8 | +391 −1 | 3 | test: the jobs login's allowed grants include its heartbeat table (drizzle/0075, approval-only) | no |
| w2-42-merchant-deletion | 162afb7 | +654 −30 | 1 | privacy: merchant deletion keeps only minimal retained audit and approvals, leaves no trace | yes |
| w2-43-data-export | ece4476 | +494 −0 | 1 | privacy: signed, encrypted per-merchant data export | yes |
| w2-44-retention | a5b0eea | +303 −0 | 2 | privacy: merchant deletion also clears the outbox folder stand-in | yes |
| w2-45-privacy-docs | d09f385 | +442 −2 | 2 | test(privacy): retention test looks only at its own deletion receipts | no |
| w2-46-encryption-db | 51ddc81 | +233 −0 | 1 | db: org_data_keys and sealed/blind-index columns, expand step (0071-0072) | yes |
| w2-47-kms-cipher | b1cf7b0 | +582 −0 | 1 | crypto: KMS interface, local stand-in, envelope field cipher and blind index | yes |
| w2-48-seal-on-write | 40abcb0 | +69 −37 | 1 | encryption: seal addresses and references on write, read them from sealed copies | yes |
| w2-49-key-rotation | c02f8b1 | +620 −2 | 1 | crypto: backfill, lazy re-encrypt, data and master key rotation; control tests | yes |
| w2-50-encryption-docs | bb0a9ad | +253 −2 | 3 | tests: compare rows without their sealed copies where two organisations or copied rows are compared | yes |
| w2-51-s3-store | e0c5223 | +510 −18 | 1 | storage: S3-compatible upload store (SigV4, same sealed bytes), local signature-checking stand-in | no |
| w2-52-prodlocal | abf1506 | +727 −0 | 1 | ops: prod-local (production build, worker, PG16, S3 stand-in), Dockerfile.prod, smoke test | no |
| w2-53-cicd | 3ee87d7 | +591 −41 | 1 | ci/cd: every PR runs every suite, expand/contract migration lint, staging and gated production deploys | yes |
| w2-54-hosting | 7c0b6f4 | +709 −3 | 2 | docs(ops): prod-local runs after the restart, including one failed run under load | yes |
| w2-55-outbound-integration | 10f97a3 | +104 −6 | 1 | integration(wave 2): S3 store and ledger connection through the safe outbound client | yes |
| w2-56-ledger-posting-contract | 7cd863b | +57 −40 | 1 | integration(wave 2): the ledger drafts only under d2's posting-rules contract; ledger connection needs an unscoped Admin | yes |
| w2-57-scope-auditor-0085 | c178e1b | +79 −2 | 2 | integration(wave 2): the merchant-deletion test seeds every wave 2 table | yes |
| w2-58-runtime-grants | 5c59d77 | +434 −2 | 1 | integration(wave 2): runtime-grants snapshot regenerated on the integrated stack | yes |
| w2-59-docs-renumber-encryption | 8b29c7b | +43 −22 | 1 | docs(wave 2): migration numbers as renumbered on the integrated stack; encryption coverage of wave 1's secret tables | no |
| w2-60-deletion-seed-encryption | c6aa066 | +1 −1 | 1 | integration(wave 2): the deletion seed's data-key row tolerates keys made by field encryption | no |
| w2-61-merchant-e2e-text | e123295 | +1 −1 | 1 | merchant-e2e reads c5's statement-format wording | no |
| w2-62-auditor-predicates-0086 | 356d58e | +118 −22 | 1 | 0086: the Auditor's predicates run only for an Auditor (demo pages back under 1 s) | yes (security control re-expressed) |
| w2-63-progress-decisions | (this commit) | docs | 1 | this file and the decisions log | no |

## Test counts on the stack top (wave 2)

Local runs, 26 Nov 2026, fresh databases (PostgreSQL 16), retries 0, quiet machine (load ≈ 1–1.8 on 4 cores; nothing
else of mine running). Revision: 356d58e (w2-62) unless noted; w2-63 changes docs only.

| Check | Result |
|---|---|
| `npx tsc --noEmit` (every slice w2-01 … w2-62 on its own, and the top) | 0 errors [VERIFIED] (each slice checked out and checked on its own; [VERIFIED] for all 62) |
| lint (shared config) | 0 errors, 68 warnings [VERIFIED] |
| `npx vitest run` | 3,199 passed, 57 skipped (3,256), 183 files passed, 1 skipped [VERIFIED] |
| `npm run test:control` | 654 / 654, 65 files [VERIFIED] (second run; the first run on 356d58e: 653/654, chain-reads-partitioning's EXPLAIN test saw a bitmap scan instead of an index scan, a planner choice; alone 10/10 three times, then the full suite 654/654) |
| `npm run test:control` with `CLEARLINE_TEST_ENCRYPTION=on` (e2's variant) | 654 / 654, 65 files [VERIFIED] |
| migrations | fresh migrate and upgrade from wave 1's schema (adb2c3f's 53 migrations, then 0070–0086): 70 applied, schemas identical (pg_dump, 6,577 lines) [VERIFIED] |
| control-e2e (pilot build) | 34 / 34 [VERIFIED] |
| merchant-e2e (TEST build, `check-chain-recording --expect present`: 1 file) | 37 passed, 1 skipped [VERIFIED] |
| onboarding Playwright spec (desktop + mobile) | 2 / 2 [VERIFIED] (CLEARLINE_DEPLOY_ENV=local in the shell) |
| `npm run build:prod-check` | every marker absent (9), chain and demo included [VERIFIED] |
| security headers (e1, `headers.spec.ts`, plain build) | 2 / 2 [VERIFIED] |
| public demo browser (`playwright.clearline.config.ts`, plain build) | 291 passed, 11 skipped [VERIFIED]; docs/trial/screenshots restored |
| funding-browser (random CLEARLINE_BROWSER_PASSWORD) | 4 / 4 [VERIFIED] |
| `npm run demo -- --fresh --no-start` (private PostgreSQL 16, removed after) | ok, 126 s; demo marker present, `mfa` marker present in `.next-demo` [VERIFIED] |
| demo suite (`playwright.demo.config.ts`) | 28 / 28 [VERIFIED] (before w2-62: 25/28 — two page-budget failures, the notifications count 537 ms, and one mobile hydration error #418 on the upload page that passed alone) |
| `demo:reset` × 3 | 214 ms, 241 ms, 194 ms |
| `npm run e2e:blind` | 1 passed: matched 1,445 (74.03 %), review 466 (23.87 %), exception 41 (2.10 %), **wrong matches 0** (both entities, flag off and on); idempotent — identical to wave 1 [VERIFIED] |
| wave 2 checks | secret scan 0 open (18 allow-listed); `check-log-safety` ok; `check-migrations --base adb2c3f` 16 new, 0 failures [VERIFIED] |
| not run | f1's prod-local (`scripts/prodlocal/run.sh`), e4's restore drill, d1's volume bench, e1's `npm audit` gate (needs the registry feed) |

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
Review the approval-only slices of both waves; push wave 1 then wave 2 as stacked draft PRs when asked; run the four wave 2 checks not run here (prod-local, restore drill, volume bench, audit gate); then Phase 7.
