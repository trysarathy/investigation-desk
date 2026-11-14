# Clearline release candidate 3 — manifest (14 Nov 2026)

**Stage: fictional-data customer-trial release candidate.** Not production payment infrastructure, not
enterprise-production-ready, not real-data-pilot ready, not merged into `main`. Merging is approval-only (Aashmiin).
v1 (PRs #102/#103) and v2 (PRs #104/#105) are untouched; rc3 is built on top of v2 as separate branches.

## Source
| Part | Branch | Based on | Tested commit |
|---|---|---|---|
| Software (Connect + Control + Funding exposure, engine, v1 test API) | `rc3/clearline-app` | v2 `3f4a1b4` (PR #104 head) | **`c0b3fcb`** (code identical to `fa303fd`; later commits are docs) |
| Website (`marketing/`) | `rc3/clearline-site` | v2 `82e1733` (PR #105 head) | **`efd9b8e`** |

Size over v2: software 100+ commits, 121 files, +12.2k / −0.4k lines (src +3.5k, tests +6.2k, the rest docs);
website 10 commits, 33 files, +1.8k / −0.3k. Far over the 300-line merge rule — split by engine / platform / console /
docs before any merge to `main`.

## Links (one configurable source: `clearline-release.json`, identical on both branches)
| What | Preview (rc3 branches) | Production (unchanged; serves an older release until promoted) |
|---|---|---|
| Software | https://clearline-customer-trial-git-rc3-clearline-app-sarathyv2.vercel.app/clearline | https://clearline-customer-trial.vercel.app/clearline |
| Guided trial | …/clearline/trial on the preview | …/clearline/trial |
| Website | https://clearline-marketing-git-rc3-clearline-site-sarathyv2.vercel.app | https://clearline-marketing.vercel.app |
| Funding Desk | `/mentor-demo` on the same software deployment | same |

On an rc3 Vercel preview the website links to the paired software preview and the software links back to the paired
website; every other build uses production URLs. Live verification results are recorded in the PRs and the handoff.

## What rc3 adds
- **Engine (financial correctness).** Adversarial audit of every invariant (exact money; three separate truths; returns
  never delivered, net zero vs beneficiary unpaid; no amount-only allocation; stablecoin identity/finality/reorg; funding
  50,000 / 30,000 / 20,000; maker ≠ checker; holds never auto-release; nothing closes without evidence) — 9 real gaps
  fixed, then five review rounds of fixes. New: synthetic case report (JSON/CSV, marked fictional), per-case reset,
  load-time migration of workspaces saved by earlier versions (reported to the person, never upgrades evidence),
  bounded acceptance of disagreeing bank debits (≤1% one person; >1%–50% second, different person; late date ≤60 days;
  currency mismatch never), structural and role checks on stored workspaces. Invariant table:
  `docs/clearline/ARCHITECTURE.md` §4. API: `docs/clearline/ENGINE_API.md` (CHANGE 5–14), `openapi.yaml`, `DATA_MODEL.md`.
- **Returned-payout sample** now shows the outgoing debit and the return credit: "net to zero on the statement. The
  beneficiary was not paid."
- **Platform/security.** Bounded v1 request bodies with all deployment gates enforced in the route (20 MB upload now
  costs ~1 MB instead of ~70 MB); per-request nonce Content-Security-Policy (no `'unsafe-inline'` scripts; injected
  scripts blocked, 0 violations across every page); fail-fast deployment-configuration check
  (`docs/release/SECURITY_PLATFORM_RC3.md`).
- **Console.** The founder's 20-step journey works by clicking and is tested end to end on desktop and phone; URL-backed
  filters and search; owner assignment; source on every evidence item; case report; per-case and whole resets with
  backups; migration notice; acceptance UI with second approval and "awaiting second approval" status everywhere;
  "Simulated role — not sign-in or access control" on every role selector; loading/pending/error states; no swallowed
  or doubled link clicks; Funding Desk linked from Treasury & Funding.
- **Website.** All 11 pages refined in the approved Midnight & Electric Blue identity; product view generated from the
  tested engine; one "works today / not built" disclosure; labels identical to the engine; guards against real
  institution names and unsupported claims.

## Test results (run by the integration lead on clean builds, this session)
| Suite | Commit | Command | Result |
|---|---|---|---|
| TypeScript | fa303fd | `npx tsc --noEmit` | clean |
| Engine, reconciliation, funding, chain, Connect API, QA v2 + rc3, platform unit | c0b3fcb | `npx vitest run` | **1503 passed, 57 skipped, 0 failed** |
| Production build | fa303fd | `npx next build` (empty `.next`) | exit 0 |
| Console browser suite incl. 20-step journey, QA rc3 spec, axe | fa303fd | `npx playwright test -c playwright.rc3-console.config.ts --retries=0` (desktop 1440 + iPhone 13, `CLEARLINE_AXE_PATH`/`QA_AXE_PATH` set) | **202 passed, 6 skipped, 0 failed** (skips: desktop-only checks on mobile) |
| Platform/security browser suite | ef3e59f (no platform change since) | `playwright.platform.config.ts` | 28 passed |
| Funding Desk regression | ef3e59f | `playwright.funding.config.ts` (Chromium 1194 wrapper) | 4 passed |
| Mentor demo regression | ef3e59f | `playwright.mentor.config.ts` | 6 passed |
| Website content tests / tsc / static build | efd9b8e | `npm test` · `npx tsc --noEmit` · `npx next build` | **47/47**, clean, exit 0 |
| Website audit | efd9b8e | 11 pages × 1440/768/390/320 | 0 overflow, 0 axe violations, 16/16 internal links 200 |

Console agent's independent runs: three consecutive full suites at 67e8fc7 (198/6/0 each) and two at c3ad58d
(200/6/0). axe-core is not a pinned dependency: axe checks run only when the env var is set (all runs above set it).

## Independent review (separate subagents that wrote none of the reviewed code, under the same orchestrating session)
- **Engine** (`CODE_REVIEW_RC3_ENGINE.md`): BLOCK efabe6a → BLOCK 725c3a1 → CHANGES REQUESTED 7e521f5 → BLOCK 3e66fa7 →
  **APPROVE 668e4ca** → **APPROVE 942d421** → **APPROVE 8c8ee72** (final engine). Engine change after that: CHANGE 14
  (case-report status), reviewed in the console last check.
- **Console** (`CODE_REVIEW_RC3_CONSOLE.md`, `…_CONSOLE_FINAL.md`): CHANGES REQUESTED 8ca3f36 → APPROVE e023174 →
  APPROVE 0fd7861 → CHANGES REQUESTED ef3e59f (freeze) → **APPROVE fa303fd**. The freeze fix was written by the
  integration lead and reviewed independently.
- **QA/security** (`QA_SECURITY_REVIEW_RC3.md`): no Critical/High; M1, M2, L1–L4 fixed (QA's own tests now in the suite
  and passing).
- Reviewers are not external auditors. Aashmiin or a second human should read the BLOCK findings before any merge.

## Known limitations
- Sandbox only: fictional providers, quotes, webhooks, statements and Base Sepolia data. No real execution, banking or
  wallet credentials, custody, lending, or compliance decisions. Role switching is simulated, not access control.
- The workspace lives in the visitor's browser. A well-formed forged record (e.g. a fake bank debit with the right
  reference, or a forged second approval naming another real staff member) cannot be detected without server-side
  state; status claims above the evidence are capped.
- Cases that cannot close in the sandbox: a currency-mismatched debit (no FX evidence), a batched debit covering two
  payouts, a short debit after a case exists, a statement line that never arrives (no manual-allocation action yet).
- An over-amount ≤1% can be accepted by the same person who ingested the line (documented policy choice).
- v1 API: acceptance flags work through the generic `POST /actions`, not `POST /exceptions/{id}/resolve`.
- `style-src 'unsafe-inline'` remains (React style attributes); `'strict-dynamic'` trusts our own scripts.
- Large POSTs to ordinary pages are still read and discarded by Next; an older 404-shell quirk predates rc3.
- axe-core is not a pinned dependency. Lint was not a gate (already failing on the base branches).
- PAUSE checked this session: Settings!B2 `FALSE` on 13 and 14 Nov; no PAUSE reply. Out of scope here: the daily
  digest's open High on `main` ("live-mode demo reset deletes case data", fix #47) concerns the separate
  investigation-desk app.

## Deployment
Each rc3 branch is pushed once. Every push builds four Vercel projects; the `clearline-marketing` project fails when
built from a software branch (pre-existing since v1; the website builds from its own branch). The new deployment
check stops a build whose environment is inconsistent (e.g. a mode value other than `"1"`, or a preview password under 12
characters); the previous deployment then stays live. Required trial environment: `CLEARLINE_CUSTOMER_PREVIEW=1`.
No billing, domains or production promotion were changed.

## Rollback
Nothing is merged or promoted. To discard rc3: close the two rc3 draft PRs and delete `rc3/clearline-app` and
`rc3/clearline-site`. v2 (`3f4a1b4`, `82e1733`) and v1 (`13e2a34`, `ea02c56`) branches and their rollback paths are
unchanged. If an rc3 preview is later promoted: "Promote to Production" on the previous production deployment.

## Founder actions
1. Open both rc3 previews signed out on desktop and phone; walk `docs/release/FOUNDER_DEMO_SCRIPT_RC3.md`.
2. Read the BLOCK findings in the two code reviews and the QA report; decide the acceptance policy (≤1% one person;
   >1% two people; never FX) and whether the ≤1% case also needs a second person.
3. Decide promotion to the production URLs, and how to split the work into small PRs before any merge into `main`.
