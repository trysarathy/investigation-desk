# Clearline release candidate 4 — manifest (15 Nov 2026)

**Stage: fictional-data customer-trial release candidate.** Not production payment infrastructure, not
enterprise-production-ready, not real-data-pilot ready, **0 customers**, not merged into `main`, nothing promoted.
Merging and promotion are approval-only (Aashmiin). rc3 (PRs #106/#107, plus the founder's merged #108) is untouched;
rc4 is built on top of it as separate branches.

## Source and links
| Part | Branch | Based on | Tested commit |
|---|---|---|---|
| Software (Connect + Control + Accounting Bridge + Funding exposure, engine, v1 test API, research) | `rc4/clearline-app` | rc3 `a7e37c5` (PR #106 head) | see "Test results" (final code commit recorded in the PR) |
| Website (`marketing/`) | `rc4/clearline-site` | rc3 `f58416b` (PR #107 head incl. founder PR #108) | see PR |

| What | rc4 preview (paired by `clearline-release.json`) | Production (unchanged; older release until promoted) |
|---|---|---|
| Software | https://clearline-customer-trial-git-rc4-clearline-app-sarathyv2.vercel.app/clearline | https://clearline-customer-trial.vercel.app/clearline |
| Website | https://clearline-marketing-git-rc4-clearline-site-sarathyv2.vercel.app | https://clearline-marketing.vercel.app |
| Funding Desk | `/mentor-demo` on the same software deployment | same |

Size over rc3 (software): 74 commits, 110 files, +15.1k / −0.1k lines (src +5.1k, tests +5.0k, docs +5.0k). Far over
the 300-line merge rule — split into engine (Accounting Bridge), engine (Connect), console, docs/research before `main`.

## What rc4 adds
- **Research** (`docs/research/`, primary sources opened with labels per COMPANY_RULES rule 2):
  `ACCOUNTING_SYSTEMS_AND_RILLET.md` (Rillet deep study, NetSuite, Sage Intacct, Zoho Books, TallyPrime, Cryptio,
  Cryptoworth, AI authority vs assistance; 100 verified claims), `PAYMENTS_AND_STABLECOIN.md` (Modern Treasury, Stripe,
  Nium, Thunes, Airwallex, Primer, Gr4vy, Formance, Finmo, Circle, BVNK, Bridge, Fireblocks, BitGo, Zero Hash; 19-column
  capability matrix; ~110-source register), `GLOBAL_MARKETS.md` (SG, US, UK, EU, India, UAE, HK; India section with
  RBI-verified PA-CB, export-realisation and localisation facts), `CUSTOMER_VALIDATION_PLAN.md` (6 weeks,
  pre-registered confirm/kill thresholds).
- **Strategy** (`docs/strategy/CLEARLINE_PRODUCT_STRATEGY_RC4.md`): differentiation thesis — **not proven**; unified
  architecture (Connect / Control / Accounting Bridge, one evidence vocabulary); build-decision table (BUILD NOW / NEXT /
  RESEARCH FIRST / DO NOT BUILD); AI guard design; market choice (test first: Singapore major payment institutions using
  ≥2 payout rails).
- **Accounting Bridge** (engine CHANGE 15–20, `docs/clearline/ACCOUNTING_BRIDGE.md`): accounting-ready reconciliation
  export; proposed balanced journal entries **only from independent evidence**, traced to evidence + rule; maker ≠ checker
  approval; CoA mapping by posting role (a code change supersedes approvals); open/closed periods with prior-period
  items; content-hashed idempotent exports; "posted" only via `record_posting` with a person's own ledger reference;
  `confirm_not_imported`; returns never show the supplier as paid; amount-only and unrelated receipts never produce an
  entry; stablecoin route clears the payable once (on-ramp funding to stablecoin clearing; FX not proposed); load-time
  validation and reported migrations for saved workspaces. **No accounting system is connected; Clearline posts nothing.**
- **Connect provider adapter framework** (`docs/clearline/CONNECT_ADAPTERS.md`, engine-only, three fictional
  providers): raw status verbatim; provider "done" is a claim with a confidence that can never verify; order-independent
  conflict rule (success reversed / status regressed / claims differ); pluggable webhook verification (constant-time,
  key rotation, 300 s replay window, `test_` keys only; unknown schemes never applied — poll instead); dedupe/ordering
  independent of arrival; simulated polling (`poll_provider`); evidence classes. **No real provider is connected.**
- **Console**: Control › Accounting (proposed entries, periods and mapping, exports), audit history (workspace and per
  payment), an "Accounting outcome" section on every investigation, the sign-off caveat on every accounting surface, and
  the founder's **18-step journey** as one end-to-end browser test (desktop + phone).
- **Website**: the founder's simplified homepage kept (one caption corrected for accuracy); Platform lifecycle with
  "not proven"; Control Accounting Bridge; Connect adapter principles (engine-only); Developers actions; 18-step trial;
  updated "not built" list; accuracy guards (no posting/approved-rules/competitor/superiority claims).

## Test results (run by the integration lead, this session)
| Suite | Commit | Result |
|---|---|---|
| `npx tsc --noEmit` | dc4d39a | clean |
| `npx vitest run` (engine, accounting, Connect, reconciliation, funding, chain, API, QA rc2–rc4) | dc4d39a | **1820 passed, 57 skipped, 0 failed** |
| `npx next build` | dc4d39a | exit 0 |
| Console browser suite (18-step + 20-step journeys, accounting specs, QA rc3/rc4 specs, axe) desktop 1440 + iPhone 13, `--retries=0` | dc4d39a | **261 passed, 7 skipped (desktop-only), 0 failed** |
| Platform/security browser suite | dc4d39a | 28 passed |
| Funding Desk regression | dc4d39a | 4 passed |
| Mentor demo regression | dc4d39a | 6 passed |
| Website `npm test` / tsc / static build / audit | see PR #(website) | recorded at release |

Environment note: Chromium profile, caches and Playwright output were placed on `/dev/shm` because the session's disk
allowance was nearly exhausted; earlier attempts on the root disk crashed the renderer (resource errors, not assertion
failures).

## Independent review (separate subagents that wrote none of the reviewed code, under the same orchestrating session — not external auditors)
- **Accounting Bridge** (`CODE_REVIEW_RC4_ACCOUNTING.md`): **BLOCK** a91dd11 (stablecoin payable double-debit, debit
  booked as cash-in, forged exports, journal id reuse, reversal double count) → APPROVE 466d42a → APPROVE CHANGE 17
  (genuine a91dd11 fixtures generated in a separate frozen copy) → APPROVE CHANGE 18 → CHANGES REQUESTED CHANGE 19 (N1
  lock-up) → **APPROVE CHANGE 20**.
- **Connect** (`CODE_REVIEW_RC4_CONNECT.md`): CHANGES REQUESTED (order-dependent regressions, hold release, receipt) →
  **APPROVE** with follow-ups RR-1–RR-4 (done; RR-4 found the G1 engine gap, fixed in CHANGE 17).
- **Console** (`CODE_REVIEW_RC4_CONSOLE.md`): CHANGES REQUESTED (posted-then-changed entry still "supplier paid") →
  fixes in c95a9db; re-review result recorded in the PR.
- **QA/security** (`QA_SECURITY_REVIEW_RC4.md`): OK for a public fictional-data trial once M1 (forged repayment / early
  chain finality) is fixed → fixed in CHANGE 19/20; QA's tests are in the suite and pass.

## Known limitations
- Sandbox only: fictional providers, statements, chain data and accounts. No real execution, banking/wallet
  credentials, custody, lending, compliance decisions, accounting connections or ledger posting.
- **Posting rules are sandbox rules pending the founder's sign-off** — especially the stablecoin route (payable cleared
  in USDC against what may be an SGD invoice; stablecoin clearing keeps an SGD debit and a USDC credit until the
  accountant books the conversion). FX, fees, GST and rounding entries are never proposed. Reopening a period is not
  supported.
- The workspace lives in the visitor's browser: approver identity is not authenticated, and a well-formed forged record
  (e.g. a fake bank debit with the right reference, an allocation id chosen between two obligations' sequences) cannot
  be detected without server-side state. Stored statuses above their evidence are capped; malformed records are refused.
- A contradiction opening on a posted entry proposes a reversal (churn; flagging only may be better). Two theoretical
  `worsenedIssues` gaps the engine cannot produce today.
- Connect: three narrow arrival-order dependencies documented in CONNECT_ADAPTERS §4/§15; RSA/JWS schemes unimplemented
  (always confirmed by polling); the provider status history panel is not in the console (no Connect events in the
  sample).
- Acceptance and bridge actions are reachable through the generic `POST /actions`; the bridge exports have no dedicated
  v1 endpoint.
- Cases that cannot close in the sandbox: currency-mismatched debit, a debit for two payouts, a short debit after a
  case exists, a statement line that never arrives.
- Research: MAS and NPCI pages could not be fetched (maintenance page / HTTP 403), so the Singapore MPI count and UPI
  figures stay secondary; Sage Intacct and parts of NetSuite/Cryptio stayed secondary (403 / no response); Finmo from
  marketing pages only. The differentiation thesis is unproven and there is no demand evidence.
- AI assistance is designed (strategy §4), not built; no model provider or key is configured.
- axe-core is not a pinned dependency (checks run when the env var is set; every run above set it). Lint not a gate.
- Out of scope: the daily digest's open High on `main` ("live-mode demo reset deletes case data", fix #47) concerns the
  separate investigation-desk app.

## Governance and deployment
- PAUSE checked at the start of this session: Settings!B2 `FALSE`; no PAUSE reply. Company HQ Log rows are written for
  PRs.
- Each rc4 branch is pushed once. Every push builds four Vercel projects; `clearline-marketing` fails when built from a
  software branch (pre-existing). The deployment-configuration check stops a build with an inconsistent environment.
- This session's network allowlist was widened (with the founder's approval prompts) to the exact Clearline preview
  hosts and the official documentation sites researched. No billing, domains or production promotion were changed.
- Founder decisions surfaced: beachhead (S5 payment providers/remitters vs the earlier Web3-on-Xero hypothesis);
  pricing for this buyer; posting-rule sign-off; whether ≤1% acceptances need a second person; updating
  `PRODUCT_FACTS.md` / `AGENTS.md` (governance — her approval).

## Rollback
Nothing is merged or promoted. To discard rc4: close the rc4 draft PRs and delete `rc4/clearline-app` and
`rc4/clearline-site`. rc3 (`a7e37c5`, `f58416b`), v2 and v1 branches and their rollback paths are unchanged. If an rc4
preview is later promoted: "Promote to Production" on the previous production deployment.

## Founder actions
1. Open both rc4 previews signed out on desktop and phone; walk `docs/release/FOUNDER_DEMO_SCRIPT_RC4.md`.
2. Read `docs/strategy/CLEARLINE_PRODUCT_STRATEGY_RC4.md` and the BLOCK findings in `CODE_REVIEW_RC4_ACCOUNTING.md`.
3. Sign off (or change) the sandbox posting rules in `docs/clearline/ACCOUNTING_BRIDGE.md`.
4. Decide the beachhead and run `docs/research/CUSTOMER_VALIDATION_PLAN.md`.
5. Decide promotion, PR splitting and merging into `main`.
