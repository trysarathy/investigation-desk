# Clearline unified customer-trial release — manifest (13 Nov 2026)

**Stage: fictional-data customer-trial candidate.** Not production payment infrastructure, not real-data-pilot
ready, not merged into `main`. Merging is approval-only (Aashmiin).

## Source
| Part | Branch (pushed once for preview) | Based on | Tested commit | Draft PR |
|---|---|---|---|---|
| Software (Connect + Control + Funding exposure) | `release/clearline-unified-20261113` | `trial/clearline-customer-preview-20261113` (PR #99 head `1bb8deb`) | code `5853620` (later commits are docs only) | into PR #99's branch |
| Website (`marketing/`) | `release/clearline-site-20261113` | `site/clearline-studio-v2` (PR #101 head `5544215`) | `ea02c56` | into PR #101's branch |

Product direction: Connect + Control, with the Funding Desk as a specialist funding-exposure workflow — **approved by
Aashmiin on 13 Nov 2026** (`docs/release/PRODUCT_DIRECTION_UPDATE.md`). Governance files are unchanged; updating them
needs her separate approval.

## Test outcomes (run by the integration lead, this session)
| Suite | Result |
|---|---|
| Software `npx tsc --noEmit` at 5853620 | clean |
| Software `npx vitest run` at 5853620 | **1034 passed, 57 skipped, 0 failed** (incl. 109 QA release tests and the review-fix regressions) |
| Software `npx next build` (clean `.next`) | succeeds |
| Console Playwright (`playwright.clearline.config.ts`, desktop + iPhone 13, retries 0) | **39 passed, 1 skipped** (keyboard walk is desktop-only) |
| Funding Desk regression (`playwright.funding.config.ts`) | 4 passed |
| Mentor demo regression (`playwright.mentor.config.ts`) | 6 passed |
| Website `npm test` / `tsc` / `next build` at ea02c56 | **20/20**, clean, static build succeeds |
| Website browser audit (website team) | 11 pages × 1440/768/390/320: no overflow, 0 axe violations, 31/31 internal links 200 |

Environment notes: the funding/mentor Playwright configs needed this session's installed Chromium (1194) and a dummy
`CLEARLINE_BROWSER_PASSWORD`; the configs themselves are unchanged. Lint was already failing on the base branches
before this work and was not part of these gates.

## Independent review
- **Code review** (`docs/release/CODE_REVIEW.md`): BLOCK on 6fb9433 (2 blockers, 10 majors) → CHANGES REQUESTED on
  cfadef9 (2 new majors) → **APPROVE 5853620** for a public synthetic-data customer-trial PR.
- **QA/security** (`docs/release/QA_SECURITY_REVIEW.md`): 3 High / 3 Medium / 8 Low on 6fb9433 → re-check: **ready
  for a public synthetic-data release**; residuals R3 and R1 since fixed (5853620).
- **Independence caveat:** reviewers were separate subagents that wrote none of the code, but they ran under the same
  orchestrating session. Aashmiin or a second reviewer should read B1, B2, N1 and N2 before any merge.

## Known limitations (disclosed)
- Sandbox only: fictional providers, quotes, webhooks, statements and Base Sepolia chain data. No real execution,
  custody, lending or compliance decisions. The test API is stateless; maker/checker there is a workflow rule, not
  authentication.
- Funding linkage is a tested **projection**, not a shared production ledger.
- Open minors: F1 (provider settlement report on a failed payout is recorded silently), F2 (under-amount provider report
  not flagged), m5/m11 (deferred engine minors), R2 (`script-src 'unsafe-inline'` — move to a nonce CSP before any
  real-data or logged-in deployment), R4 (chunked bodies read before the size check), no React error boundary in the
  console, per-scenario reset not implemented (whole-workspace reset only).
- Size: ~8.7k changed lines — far over the 300-line merge rule; split before merging to `main` (see CODE_REVIEW B3).
- External links between the website and the trial were **not verified live**: this session's network blocks
  `*.vercel.app`.

## Deployment
- Every push to this repository builds four Vercel projects (investigation-desk, clearline-connect-control-preview,
  clearline-customer-trial, clearline-marketing). The previous push was refused: "Deployment rate limited — retry in
  24 hours". Each release branch is pushed exactly once; the resulting preview statuses are recorded in the handoff.
- Production URLs (unchanged by this release): https://clearline-marketing.vercel.app and
  https://clearline-customer-trial.vercel.app/clearline. Which branch each project promotes to production is set in
  Vercel and could not be inspected from this session; promotion is left to Aashmiin.
- Required environment for the trial project: `CLEARLINE_CUSTOMER_PREVIEW=1` (route allow-list). No secrets are
  needed; the v1 test key is public by design.

## Rollback
- Nothing is merged or promoted by this release. To discard: close the two draft PRs and delete the
  `release/clearline-*-20261113` branches. PR #99 and #101 heads are untouched.
- If a release branch is later promoted in Vercel: use "Promote to Production" on the previous deployment (PR #99 head
  `1bb8deb`, PR #101 head `5544215`).

## How the work was done (agent completion report)
All roles ran as general-purpose subagents briefed with the repository's `.claude/agents/*.md` role files (the role
definitions could not be loaded as agent types in this session). The integration lead verified every result above.
| Workstream (roles) | Work | Review |
|---|---|---|
| Domain engine (tech-lead-architect, matching-engine, accounting-integrations, crypto-protocol) | `src/lib/clearline/**`, v1 test API, OpenAPI, architecture/data-model docs, 3 fix rounds | code review + QA |
| Product console (frontend-product-engineer, lead-designer, product-manager) | `src/app/clearline/**`, `src/components/clearline/**`, API reference, Playwright | QA (browser) |
| Website (lead-designer, content-marketer, frontend-product-engineer, gtm-strategist) | `marketing/**`, `docs/design/DESIGN_SYSTEM.md`, shared tokens | QA (read-only) |
| QA/security (qa-security-engineer) | review + 109 release tests + re-check | — |
| Code review (code-reviewer) | review, re-review, final check | — |
Not run as separate agents: devops-engineer (deployment checks done by the integration lead), chief-of-staff (this
manifest), crypto/accounting as standalone sessions (folded into the domain engine brief).

## Founder actions
1. Open the two preview deployments (links in the handoff) signed out, on desktop and phone; walk
   `docs/release/FOUNDER_DEMO_SCRIPT.md`.
2. Approve the About page wording (a short "evenings around classes" line was added — remove if wrong).
3. Decide promotion to the production URLs, and when to split and merge into `main`.
