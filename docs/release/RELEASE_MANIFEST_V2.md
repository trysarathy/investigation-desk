# Clearline v2 release candidate — manifest (13 Nov 2026)

**Stage: fictional-data customer-trial release candidate.** Not production payment infrastructure, not enterprise
production-ready, not real-data-pilot ready, not merged into `main`. Merging is approval-only (Aashmiin). The v1
release (`release/clearline-unified-20261113`, PR #102; `release/clearline-site-20261113`, PR #103) is untouched; v2 is
built on top of it as separate branches.

## Source
| Part | Branch | Based on | Tested commit |
|---|---|---|---|
| Software (console + engine + v1 test API) | `release/clearline-v2-20261113` | PR #102 head `13e2a34` | **`8ca3f36`** (later commits docs only) |
| Website (`marketing/`) | `release/clearline-site-v2-20261113` | PR #103 head `ea02c56` | **`82e1733`** |

Size: software 96 files, +4,856 / −683 lines over `13e2a34`; website 39 files, +1,324 / −631 over `ea02c56`. Both exceed
the 300-line merge rule; the commits are grouped by engine / console / docs so they can be split before any merge to
`main`.

## What changed
- **Engine:** F1 (a settlement report or bank debit on a failed, cancelled, expired or returned payout is a
  contradiction, in either arrival order), F2 (under-amount reports raise a structured difference: expected, reported,
  difference, currency, source, next action), returned payouts never verified, outstanding vs resolved differences,
  held payouts never "supplier paid", human label API for every state/code/error, streamed body limit, OpenAPI schemas.
- **Console:** new navigation (Overview, Payments, Investigations, Reconciliation, Treasury & Funding; then Routes &
  Providers, Compliance Holds, Reports, Developers, Settings); old URLs 308-redirect; investigation page with summary,
  three separate truths, evidence timeline, findings and engine-gated actions only; Midnight & Electric Blue from the
  shared tokens; console-wide error boundary; no swallowed link clicks.
- **Website:** Midnight & Electric Blue redesign with the approved hero, the 12 homepage sections and all 11 pages;
  the product view is rendered from the engine's sample data; status labels are the engine's own strings.
- **Shared identity:** `marketing/app/tokens.css` v2.0 is copied verbatim to `src/app/clearline/tokens.css`;
  `docs/design/DESIGN_SYSTEM.md` v2.1 documents palette, semantic colour rules and 38 contrast pairs (founder
  approval pending).

## Test outcomes (run by the integration lead on clean builds, this session)
| Suite | Commit | Result |
|---|---|---|
| `npx tsc --noEmit` | 8ca3f36 | clean |
| `npx vitest run` (engine, reconciliation and chain regressions, Connect API, QA v2) | 8ca3f36 | **1137 passed, 57 skipped, 0 failed** |
| `npx next build` (empty `.next`) | 8ca3f36 | exit 0 |
| Console Playwright, desktop 1440 + iPhone 13, `--retries=0` | 8ca3f36 | **76 passed, 4 skipped** (desktop-only checks on mobile) |
| QA v2 browser spec | 8ca3f36 | 5 passed |
| Funding Desk regression | 8ca3f36 | 4 passed |
| Mentor demo regression | 8ca3f36 | 6 passed |
| Website `tsc` / `next build` / `npm test` (with built output) | 82e1733 | clean / exit 0 / **30 passed, 0 skipped** |
| Website audit: 11 pages × 1440/768/390/320 | 82e1733 | no horizontal overflow, axe-core 0 violations (1440, 320), 13 internal links 200 |
| Website → software link targets on the local software build | 8ca3f36 | `/clearline`, `/clearline/trial`, `/clearline/docs`, `/clearline/docs/openapi.yaml`, `/mentor-demo` all 200 |

Console agent (reported, not rerun by the lead): the full console suite three consecutive times at dd52f88, 68/2/0
each; axe 0 violations on all 20 console pages at 1440 and 390 at 8ca3f36. Environment notes: funding/mentor configs
need this session's Chromium 1194 and a dummy `CLEARLINE_BROWSER_PASSWORD` (configs unchanged). Lint was not a gate
(already failing on the base branches).

## Independent review
- **Code review** (`CODE_REVIEW_V2.md`): CHANGES REQUESTED on c498da6 (3 Major) → CHANGES REQUESTED on dd52f88 (N1) →
  **APPROVE `ce96a35`** for the public fictional-data trial PR. Minors C1/C2 raised there were fixed in `e4c90b0`
  (tests fail without each fix); the console commit `8ca3f36` was **not** code-reviewed (covered by QA's tests and the
  browser suite).
- **QA/security** (`QA_SECURITY_REVIEW_V2.md`, `tests/qa-release-v2/`): on c498da6, nothing blocks a public
  fictional-data trial; 1 Medium + 5 Low. M1 and L1 fixed (engine), L2 and L4 fixed (console, tests added), L5 already
  aligned on the website, L3 open (below).
- **Independence caveat:** reviewers were separate subagents that wrote none of the code, but they ran under the same
  orchestrating session. The repo's `.claude/agents` roles could not be loaded as agent types; general-purpose agents
  were briefed with the role files. Aashmiin or a second human reviewer should read M1–M3 and N1 before any merge.

## Known limitations
- Sandbox only: fictional providers, quotes, webhooks, statements and Base Sepolia data. No real execution, custody,
  lending, keys or compliance decisions. The v1 test API is stateless and public; simulated maker/checker roles are a
  workflow rule, not authentication.
- Funding linkage is a tested projection, not a shared production ledger. Workspace state lives in the visitor's
  browser; reset is whole-workspace only (R7).
- **L3:** Next.js middleware copies request bodies (up to 10 MB) and drains the rest before the API's 512 KB streamed
  limit runs. Oversized bodies are still rejected (422) but are read first. Fix options (need the owner of
  `middleware.ts`/`next.config.mjs`): move the preview gates into the v1 route and exclude it from the middleware
  matcher, or lower `middlewareClientMaxBodySize`. The host's own request-size limit also applies (not verified).
- **R2:** CSP still allows `'unsafe-inline'` scripts; move to a nonce CSP before any real-data or logged-in deployment.
- Code-review L1: on a server slower than 2.5 s, a link click can cause one extra full page load of the same page.
- An unreadable stored workspace is kept for the person to download or replace; nothing is auto-repaired.
- Design system v2.1 and the hero line ("Every payment. One clear answer.") await founder sign-off; "Every payment"
  describes the product's intent within the sandbox, not a coverage claim.
- External links were **not verified live**: this session's network blocks `*.vercel.app`. The website links to the
  production trial URL, which keeps serving the previous release until a v2 deployment is promoted.
- PAUSE check: the Company HQ sheet and Gmail connectors returned 502 throughout this session, so PAUSE could not be
  read; work proceeded under the standing rules (no merge, no outbound messages, no real money).

## Deployment
Each v2 branch is pushed exactly once. Every push builds four Vercel projects (investigation-desk,
clearline-connect-control-preview, clearline-customer-trial, clearline-marketing); the Hobby rate limit was hit earlier
in this release. Preview URLs and the deployed SHA are taken from GitHub commit statuses and recorded in the handoff.
No billing, domains or production promotion were changed. Required trial environment: `CLEARLINE_CUSTOMER_PREVIEW=1`.

## Rollback
- Nothing is merged or promoted. To discard v2: close the two v2 draft PRs and delete
  `release/clearline-v2-20261113` and `release/clearline-site-v2-20261113`. The v1 branches (PR #102 head `13e2a34`,
  PR #103 head `ea02c56`) and their own rollback paths are unchanged.
- If a v2 preview is later promoted in Vercel: "Promote to Production" on the previous production deployment (v1 heads
  above, or PR #99 `1bb8deb` / PR #101 `5544215`).

## Founder actions
1. Open the two v2 previews signed out on desktop and phone; walk `docs/release/FOUNDER_DEMO_SCRIPT_V2.md`.
2. Approve or amend the design system (`docs/design/DESIGN_SYSTEM.md` v2.1) and the hero line.
3. Decide on L3 and R2 before any non-fictional deployment; decide promotion, splitting and merging into `main`.
