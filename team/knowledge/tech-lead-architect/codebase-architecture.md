# Codebase architecture, from the tech lead's seat

Read from `origin/main` @ `0c7d9f1` on 2026-11-01 SGT by tech-lead-architect. Every code fact is
[VERIFIED: code read 2026-11-01] at the file named unless labelled otherwise. The full narrative is
`docs/ARCHITECTURE.md`; protocol detail is in `team/knowledge/crypto-protocol-engineer/codebase-map.md`
(read 2026-10-29 at an older commit: check before relying on it). This file adds what a tech lead
needs to plan and integrate: **who owns what, the shared seams, what collides, and what is
approval-only by path.**

Baseline checks on a clean `npm ci` of `0c7d9f1`: `npx tsc --noEmit` exit 0; `npx vitest run`
20 files passed / 1 skipped, 562 tests passed / 57 skipped (11.3 s) [VERIFIED: run 2026-11-01].
`next build` not run for this file.

## 1. Modules and default owner

| Area | Paths | Default owner (assign tasks here) |
|---|---|---|
| Chain reads, address formats, providers, confirmations, replay recordings | `src/lib/chain/`, `src/lib/address.ts`, `src/lib/contracts.ts`, `src/lib/demo/transport.ts`, `scripts/record-*.ts`, `tests/fixtures/real/` | crypto-protocol-engineer |
| Deposit engine (D01-D18), catalogue, templates | `src/lib/engine/`, `src/lib/catalogue.ts`, `src/lib/templates.ts` | crypto-protocol-engineer (rules) / matching-engine-engineer (explanations) |
| Payment requests: attribution, matching, issue classification, verdict text | `src/lib/requests/lifecycle.ts`, `check.ts`, `present.ts`, `demo.ts`, `ui.ts` | matching-engine-engineer |
| Payment records / three-way matching / inbox | `src/lib/payments/` | matching-engine-engineer |
| Posting rules, approve-and-post, books adapters, Xero OAuth | `src/lib/accounting/**` | accounting-integrations-engineer (**approval-only**) |
| Pages and components | `src/app/**/page.tsx`, `src/components/**` | frontend-product-engineer (design: lead-designer) |
| Routes | `src/app/api/**/route.ts` | owner of the service it calls; auth/CSRF aspects → qa-security-engineer review |
| Preview gate | `src/middleware.ts` | **approval-only** (auth) |
| CI, Docker, build config, env | `.github/workflows/`, `Dockerfile`, `next.config.mjs`, `.env.example`, `package.json` scripts | devops-engineer |
| Security tests (`it.fails` on `security/*` branches), e2e | `tests/security-*.test.ts`, `tests/e2e/` | qa-security-engineer |
| Docs | `docs/ARCHITECTURE.md`, `docs/adr/`, `docs/PLAN_14_DAY.md`, `docs/DEMO.md` | tech-lead-architect (DEMO.md content: qa + lead-designer) |

## 2. Shared seams (the interfaces parallel PRs must agree on)

| Seam | Defined in | Used by | Rule for the 14 days |
|---|---|---|---|
| `PlanOptions {threshold, price?}` | `accounting/rules.ts` | `engine.ts approveAndPost`, `service.ts planFor/approvePosting`, tests | Add only `orgTimeZone?: string` (IANA), per ADR 0002 |
| `PostingLine`, `PostingPlan`, `PlanStatus` | `accounting/types.ts` | rules, engine, all providers, `/books` UI | No new status or field without an ADR |
| `BooksAdapter.post(link, lines, key)` | `accounting/types.ts` | `providers/*.ts`, `engine.ts` | Unchanged; the timezone read is a separate adapter method or connection data |
| `TransferEvent` → `ingest()` | `requests/types.ts`, `lifecycle.ts` | `SimulatedProvider`, `LiveHashProvider`, any watcher/replay | New sources emit the same shape as `LiveHashProvider` |
| `Observation.key = chain:hash:logIndex` | `requests/types.ts` | dedupe, idempotency key, posting | Never change format (it is inside posted idempotency keys) |
| `RequestState`, `ProblemKind` | `requests/types.ts:31`, `lifecycle.ts:277` | UI, posting rules | Adding a kind changes posting (`neverKinds` in `rules.ts`) → approval-only |
| `Facts` / `Verdict` | `src/lib/types.ts` | engine, check, chain | crypto-protocol-engineer owns |
| Store shapes `RequestsData`, `AccountingData` | `requests/types.ts`, `accounting/types.ts` | stores | **No migrations exist**: loads spread `{...empty(), ...file}`. New fields optional with safe defaults; never rename or retype a field |

## 3. Data store facts that shape every plan

- JSON files under `dataDir()` (`$DESK_DATA_DIR` or `.data/`): `requests.json`, `accounting.json`,
  `xero-tokens.json`, `workspace.json`, `cases.json`, `bulk/`, plus the payments store
  (`payments/live.ts`).
- One writer per file per process (`lock.ts`), atomic rename. One server process per data dir.
- "Migration" in a task file means: a change to a store shape. Each must say the default for old
  files and include a test that loads an old-shape file.
- Tests run the real routes on a scratch `DESK_DATA_DIR`.

## 4. Request flow in one line each (for reading PR diffs)
import (`api/accounting/import`) → `createRequest` → transfer (`SimulatedProvider` / `attach_hash`
→ `LiveHashProvider` → `fetchFacts`) → `ingest`/`attribute` → `checkObservation` (engine) →
`transferIssue` → `deriveRequest` state → `planPosting` → `POST /api/accounting/<id> {actor,key}`
→ `approveAndPost` → adapter → audit.

## 5. Demo mode
`isDemoMode()` (`src/lib/mode.ts`) default ON. Demo = fictional labelled "Demo data" (Northwind
Pay Pte Ltd, 7 cases a-g in `requests/demo.ts`), demo books always (`accounting/service.ts
activeProvider`), auto-mark-paid on. Live = `DEMO_MODE=off`; Ethereum requests only; hash pasted by
a person. Replay of real recorded responses: `OFFLINE_REPLAY_DIR=tests/fixtures/real` (58 files).
Every PR that touches a flow states a demo-mode and a live-mode check (OPERATING_MODEL §2 item 7).

## 6. Money and dates (approval-only zone)
- Money: `src/lib/decimal.ts`, `src/lib/payments/money.ts`, `accounting/rules.ts` (`floorCents`,
  `toCents`, `cmp`, `DEPEG_LIMIT`, `parPrice`), provider `num()/amt()`.
- Dates: `rules.ts:137 day()` (UTC bug, ADR 0002); providers pass `line.date` through
  (`xero.ts:33`, `quickbooks.ts:28`); block time from chain fetchers.

## 7. Approval-only path map (used by the merge gate; a match = approval-only, no arguing it down)

| Pattern | Why (OPERATING_MODEL §2 category) |
|---|---|
| `src/lib/accounting/**` | posting to Xero/QuickBooks, money amounts |
| `src/lib/decimal.ts`, `src/lib/payments/money.ts` | money amounts |
| `src/middleware.ts`, anything adding/changing auth, CSRF, sessions, preview gate | auth |
| `**/xero-auth.ts`, any OAuth scope, any token/secret handling, `src/lib/lock.ts` file modes | secrets, permissions |
| `src/app/api/accounting/**`, `src/app/api/demo/**`, `src/app/api/requests/demo/**`, `src/app/api/uploads/**`, `src/app/api/payments/clear/**`, `src/app/api/payments/export.csv/**` | posting, deletions, customer data |
| `src/lib/demo/reset.ts`, `src/lib/data-dir.ts`, `src/lib/*/store.ts`, `src/lib/csv/cell.ts`, `src/lib/payments/export.ts` | customer data, deletions |
| `.github/workflows/**`, `Dockerfile`, `next.config.mjs`, `vercel.json`, `.env.example`, host settings | production/deploy settings |
| Any deleted file (`git diff --diff-filter=D`) or deleted data/branch | deletions |
| Any price, plan or offer text (`US$`, "pilot", "per month") | pricing |
| Any wallet, key, signing, seed, `privateKey`, `mnemonic` string | keys, wallets |
| `requests/lifecycle.ts` changes to `ProblemKind`, attribution or what is counted; `rules.ts neverKinds` | what reaches the books (posting) |

Content check too: a PR outside these paths that changes an amount, a rounding, a date sent to a
provider, a scope, or customer-data handling is approval-only. When unsure: approval-only.

## 8. Collision hot spots (assign at most one open PR per file per night)

| File | Why it collides |
|---|---|
| `src/lib/requests/lifecycle.ts` (593 lines) | attribution, issues, state derivation, decisions all live here |
| `src/lib/accounting/rules.ts` (232 lines) | timezone fix, account settings, any posting change |
| `src/lib/requests/types.ts` | shared types for every request PR |
| `src/lib/payments/match.ts` (1,102 lines) | large; any matching change |
| `src/app/requests/[id]/page.tsx`, `src/app/books/page.tsx` | UI for the queue, posting date display, settings |
| `tests/requests.test.ts`, `tests/accounting.test.ts` | everyone adds cases; prefer new test files per task |
| `CHANGELOG.md` | every PR adds an entry: always rebase-conflicts; resolve by keeping both entries |

## 9. Known gaps that matter for the 14-day target
See `docs/ARCHITECTURE.md` §3 (K1-K14). The four that block the demo outright: K1+K2 (posting
date + timezone scope), K3 (no address watching), K4 (no testnet / scenario source decided), K7
(account codes by hand-editing JSON).
