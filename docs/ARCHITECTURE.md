# Clearline architecture

Owner: **tech-lead-architect**. Last checked: **2026-11-01 SGT** against `origin/main` @ `0c7d9f1`
(merge of PR #43). Everything under "Today" was read in the code at that commit [VERIFIED: code read
2026-11-01, file paths given]. `npx tsc --noEmit` exit 0 and `npx vitest run` = 20 files passed,
1 skipped; 562 tests passed, 57 skipped [VERIFIED: run by tech-lead-architect 2026-11-01 on a clean
`npm ci` of `0c7d9f1`]. `npx next build` was **not** run for this document.

This file is the truth about the system. If code and this file disagree, the code wins and this file
is fixed in the same PR. `docs/SPEC.md` wins over any architecture idea here unless Aashmiin changes
it. Big choices are recorded as ADRs in `docs/adr/`.

---

## 1. Today: the shape of the system

One Next.js 15.5 app (React 19, TypeScript 5.9, Vitest 3.2), one Node 22 process, no database.
State is JSON files in a data directory. Read-only on every chain. Write access exists in one place
only: posting an approved plan to the books.

```
Browser (pages in src/app/*)                    Public payer page (src/app/pay/[publicId])
   │  fetch POST/GET                                  │ POST /api/pay/<id>/check
   ▼                                                  ▼
src/middleware.ts  optional HTTP Basic preview gate (PREVIEW_USER/PASSWORD); lets /pay/* through
   ▼
src/app/api/**/route.ts  thin handlers: parse, call a service, return JSON
   ▼
Services (server-only, take the store lock, call pure functions, write the store)
   requests/service.ts   accounting/service.ts   payments/live.ts   workspace/live.ts   bulk/jobs.ts
   ▼                              ▼
Pure logic (no clock, no network: the clock and adapters are passed in)
   requests/lifecycle.ts  ← requests/check.ts → engine/run.ts (D01-D18 rules)
   accounting/rules.ts planPosting()  →  accounting/engine.ts approveAndPost()
   payments/match.ts, payments/exceptions.ts
   ▼                              ▼
Chain reads (read-only HTTP/JSON-RPC)          Books adapters (write, only after Approve)
   chain/evm.ts, chain/tron.ts, chain/http.ts     providers/demo.ts | xero.ts (+ xero-auth.ts)
   chain/sources.ts, chain/investigate.ts         quickbooks.ts (not offered) | netsuite.ts (interface only)
   ▼
Data directory: $DESK_DATA_DIR or ./.data  (src/lib/data-dir.ts)
```

### 1.1 Three products in one app

| Product | Code | Pages | State today |
|---|---|---|---|
| **Payment requests + accounting sync** (what the demo shows) | `src/lib/requests/`, `src/lib/accounting/` | `/requests`, `/requests/new`, `/requests/[id]`, `/requests/payments/[key]`, `/pay/[publicId]`, `/books` | Demo mode: simulated transfers. Live mode: **Ethereum only**, USDC/USDT, a person pastes a tx hash (`attach_hash`); **no address watching or polling** (`src/lib/requests/provider.ts:7`) |
| **Deposit investigation desk** (the D01-D18 engine) | `src/lib/engine/`, `src/lib/chain/`, `src/lib/workspace/`, `src/lib/bulk/` | `/investigate`, `/cases/[id]`, `/bulk`, `/settings` | Live lookups on Tron, Ethereum, BNB Chain (+ cross-check Polygon, Base, Arbitrum, Optimism); hidden from nav in demo mode |
| **Payment records, three-way matching, exception inbox** | `src/lib/payments/` | `/payments`, `/payments/[id]`, `/inbox`, `/inbox/[itemId]` | CSV imports (BVNK preset), exact-identifier matching, exceptions, PDF evidence packs |

The payment-request flow reuses the engine: `requests/check.ts checkObservation()` turns one
observed transfer into engine `Facts` and calls `engine/run.ts investigate()`.

### 1.2 Data store

`src/lib/data-dir.ts`: `dataDir() = $DESK_DATA_DIR || <cwd>/.data` (comment: "until the database
lands (week 5)"). Files:

| File | Written by | Holds |
|---|---|---|
| `requests.json` | `requests/service.ts` | payment requests, observations (key `chain:hash:logIndex`), decisions, business wallets |
| `accounting.json` | `accounting/service.ts` | provider, invoice links, account codes, append-only audit array, demo books |
| `xero-tokens.json` | `accounting/providers/xero-auth.ts` | Xero access + refresh token, tenant id/name (file mode not set: SECURITY_GAPS #6) |
| `workspace.json` | `workspace/live.ts` | deposit desk Files A/B |
| `cases.json`, `bulk/` | `bulk/cases.ts`, `bulk/jobs.ts` | deposit desk cases and bulk runs |
| payments store | `payments/live.ts` (under `dataDir()`) | payment records, imports, inbox, audit JSONL |

Concurrency: `src/lib/lock.ts` serialises read-modify-write per file inside **one process**
(locks on `globalThis`) and writes atomically (temp file + rename). "They don't span processes: run
one server process per data directory" (`lock.ts` header). Stores carry a `rev` counter.
**There are no migrations**: a store loads `{ ...empty(), ...JSON.parse(file) }`
(`accounting/store.ts load()`), so a new field must be optional with a safe default.

### 1.3 Request flow: a payment against an invoice

1. **Invoice → request.** `POST /api/accounting/import` → `accounting/service.ts importOpenInvoices()`
   → `engine.ts importInvoice()` → `requests/lifecycle.ts createRequest()`; one request per USD
   invoice, linked by `InvoiceLink`. Receiving address check is a regex only (no EIP-55; gap G3).
2. **Transfer seen.** Demo: `SimulatedProvider` (`requests/provider.ts`), driven by
   `POST /api/requests/demo`. Live: `POST /api/requests/<id>/action {kind:"attach_hash"}` →
   `service.ts attachHash()` → `LiveHashProvider.lookup()` → `chain/investigate.ts fetchFacts()`
   (looks the hash up on all chains in parallel). A transfer found on a chain other than Ethereum
   returns a message and **records nothing** (`provider.ts:83`).
3. **Ingest + attribute.** `lifecycle.ts ingest()` dedupes by observation key; `attribute()` is
   address-only (amount is a hint); several open requests on one address → ambiguous.
4. **Check + explain.** `check.ts checkObservation()` → engine verdict + evidence; `lifecycle.ts
   transferIssue()` classifies `failed | wrong_network | counterfeit | wrong_token | wrong_address |
   timing | engine` (`lifecycle.ts:277`); `requests/present.ts` writes the plain-English verdict,
   next action and reply drafts.
5. **State.** `deriveRequest()` → `awaiting_payment | transfer_detected | confirming | matched |
   needs_review | completed` (`requests/types.ts:31`). The "exceptions queue" for this flow today is
   the `needs_review` group sorted first on `/requests` (`requests/ui.ts STATE_ORDER`) plus
   unidentified payments (`/requests/payments/[key]`). There is no single page titled "Exceptions"
   in this flow; `/inbox` belongs to the payments product.
6. **Plan.** `accounting/rules.ts planPosting()` (pure) → `PostingPlan {status, reasons, lines,
   idempotencyKey}`. Status `not_linked | waiting | needs_decision | ready | posted | never | blocked`.
7. **Approve + post.** `POST /api/accounting/<requestId> {actor, key}` → `service.ts
   approvePosting()` → `engine.ts approveAndPost()`: refuses anything not `ready`, refuses if `key`
   differs from the current plan's key, appends `approved`, calls `adapter.post(link, lines, key)`,
   appends `posted` or `failed` (partial posts recorded so a retry skips them).

### 1.4 Where money is handled

- Token amounts are exact decimal strings (≤ 6 dp on requests), never floats.
  `src/lib/decimal.ts` (compare), `src/lib/payments/money.ts` (`add`, `sub`).
- `accounting/rules.ts`: `floorCents()` (payment lines round **down** to cents against the running
  total), `toCents()` (half up, used for the closing line and fee/overpayment lines), `cmp()`,
  `DEPEG_LIMIT = "0.005"`, `parPrice` (1.00 USD, says "no price feed connected").
- Xero/QuickBooks bodies convert the string to a number at the very edge (`num()`/`amt()` in the
  providers).
- **Every file above is approval-only to change** (money amounts / posting rules).

### 1.5 Where dates and times are handled

- Block time comes from the chain (`eth_getBlockByNumber`, Tron block header) as an ISO UTC string
  on the observation (`blockTime`), else `firstSeenAt`.
- **Posting date bug:** `src/lib/accounting/rules.ts:137`
  `const day = (x: Observation) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);` takes the **UTC**
  calendar date. Xero `Date` (`providers/xero.ts:33`) and QuickBooks `TxnDate`
  (`providers/quickbooks.ts:28`) send it unchanged. A Singapore receipt between 00:00 and 07:59 SGT
  books to the previous day (and at month end, the previous month). Failing tests:
  `tests/posting-date-timezone.test.ts` on branch `bug/xero-posting-date-timezone` (`a3bde16`,
  17 `it.fails` tests: 5 instants × payment/note/fee lines + Xero and QuickBooks payloads; SGT, New York, Kiritimati). Decision: `docs/adr/0002-…` (proposed).
- Nothing reads the organisation's timezone today: there is no call to Xero `GET /Organisation`,
  and the default Xero scopes (`xero-auth.ts:22`) do not include `accounting.settings.read`, which
  Xero's spec lists for that endpoint [VERIFIED:
  https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml (v19.1.0,
  `/Organisation` security) opened 2026-11-01].
- UI times: `src/lib/format.ts`, `requests/ui.ts friendlyTime()`.

### 1.6 Demo mode

`src/lib/mode.ts isDemoMode()`: on unless `DEMO_MODE` is `off|0|false|no|live`. Demo mode: only
the payment-requests flow in the nav, fictional "Demo data" labelled as such
(`requests/demo.ts` header: Northwind Pay Pte Ltd, operator "Mei Tan", 7 cases a-g), demo books
instead of Xero (`accounting/service.ts activeProvider()`: "Demo mode always uses the demo books"),
auto-mark-paid on (`requests/service.ts`, `autoMarkPaid: demo`). Offline replay of real recorded
chain answers: `OFFLINE_REPLAY_DIR=tests/fixtures/real` (`chain/live.ts:38-54`; 58 recordings in
`tests/fixtures/real/`). Known guard gaps: `/api/demo/reset` and `/api/requests/demo` work in live
mode; a second switch `demoModeOn()` disagrees with `isDemoMode()` (SECURITY_GAPS #1, #4).

### 1.7 Accounting providers

| Provider | File | Status |
|---|---|---|
| Demo books | `providers/demo.ts` | fictional Xero-style org inside `accounting.json` |
| Xero | `providers/xero.ts`, `providers/xero-auth.ts`; routes `api/accounting/xero/connect`, `/callback` | Built, **in testing**; OAuth with file-locked token refresh; posts Payment, CreditNote + Allocation, BankTransaction `RECEIVE-OVERPAYMENT`, invoice History note; live Demo Company test **not yet done** |
| QuickBooks Online | `providers/quickbooks.ts` | Code exists, **not offered**, not run on a sandbox |
| NetSuite | `providers/netsuite.ts` | Interface only, **not built** |

`BooksAdapter` (`accounting/types.ts`) is the seam: `post(link, lines, idempotencyKey)`; the key is
`idempotencyKeyFor()` (sha256 of request id + line kinds/amounts/observation keys/account codes).
Account codes live in `accounting.json accounts` with **no settings screen**
(`docs/ACCOUNTING_SYNC.md` step 4).

### 1.8 Chains

`src/lib/types.ts EVM_CHAIN_IDS`: Ethereum 1, BSC 56, Polygon 137, Arbitrum, Base, Optimism; plus
Tron. **No testnet is configured anywhere in `src/`** (grep for sepolia/nile/shasta/testnet: no
hits). Sources: Etherscan V2 with a key, else keyless public RPCs (`chain/sources.ts`,
`.env.example`). Read-only methods only (see crypto-protocol-engineer pack).

### 1.9 CI and branch rules

`.github/workflows/ci.yml` (merged in #42): job `ci` = `npm ci`, `tsc --noEmit`, `vitest run`,
`next build` on Node 22.22.0; job `lint` (not required; 5 known lint errors). On `main` @ `0c7d9f1`: `ci` success, `lint` failure [VERIFIED: `gh api .../commits/0c7d9f1/check-runs` read 2026-11-01].
Branch rule on `main`, read 2026-11-01 ~03:30 SGT [VERIFIED: `gh api
repos/trysarathy/investigation-desk/rulesets/26284409`]: a **repository ruleset** (created
2026-10-31T19:21Z) with `deletion`, `non_fast_forward` and `pull_request` (0 approvals) rules, and
a bypass for a repository role. It has **no `required_status_checks` rule**, so `ci` is not
required. Classic branch protection: none (`GET .../branches/main/protection` → 404). For the
merge gate this counts as "branch protection **not complete**" (playbook §4).

---

## 2. Target shape for the 14-day demo (Day 14 = Sat 14 Nov 2026)

Goal: from a clean checkout, a finance controller connects a read-only wallet address and a Xero
demo org, 20 labelled test payments arrive, each is matched or flagged with a plain-English reason,
approved ones post correct entries to the Xero demo org (accounts, cents, org-local date),
exceptions land in one queue with the reason, and `docs/DEMO.md` shows it. Plan: `docs/PLAN_14_DAY.md`.

Only these new pieces, each a small PR series; everything else already exists:

| # | Piece | Where it plugs in | Owner |
|---|---|---|---|
| T1 | **Org-timezone posting date** (ADR 0002): `orgTimeZone` on `PlanOptions`, read from Xero `GET /Organisation` `Timezone` (a Windows-style enum such as `SINGAPORESTANDARDTIME`) mapped to IANA; unknown → plan `blocked`, never UTC | `accounting/rules.ts`, `providers/xero.ts`, `xero-auth.ts` scopes | accounting-integrations-engineer (approval-only) |
| T2 | **Watched address** (read-only): a business registers a receiving address; a "Check for payments" action pulls incoming token transfers for it and feeds `ingest()` | new `requests/watch.ts` (pure) + `service.ts` + one route; reuses `chain/` history readers | crypto-protocol-engineer |
| T3 | **Scenario set of 20 payments**: recorded fixtures (replayed real transfers, or testnet, per ADR 0003 once decided) with an expected outcome per payment; covers exact, partial, over, duplicate, wrong token/counterfeit, wrong network, look-alike sender address, no reference | `tests/fixtures/scenarios/`, a replay transport (existing `OFFLINE_REPLAY_DIR` pattern) | matching-engine-engineer + crypto-protocol-engineer |
| T4 | **Exceptions queue**: one view of every `needs_review`/flagged/unidentified/`never`/`blocked` item with its reason, from existing derived state (no new store) | `requests/ui.ts` + a page | frontend-product-engineer, lead-designer |
| T5 | **Account-code settings** for the Xero org (wallet bank account, fee account) instead of hand-editing JSON | `/books` + `accounting/service.ts` | frontend-product-engineer (approval-only: posting rules) |
| T6 | **Clean-checkout script**: `npm ci` → env check → seed scenario → run → expected-outcome report | `scripts/` + `docs/DEMO.md` | devops-engineer, qa-security-engineer |

Interfaces that several engineers touch (the tech lead decides these before work starts and
writes them in the task file):
- `PlanOptions` (`accounting/rules.ts`): add `orgTimeZone?: string` only (IANA). No other field
  added by any other PR during the 14 days without an ADR.
- `TransferEvent`/`Observation` (`requests/types.ts`): T2/T3 produce `TransferEvent`s exactly as
  `LiveHashProvider` does (`source:"live"`, real `blockTime`); no new fields.
- `AccountingData` (`accounting/types.ts`): new fields optional with defaults (no migrations exist).
- Scenario fixture format: one JSON per payment `{id, label, provenance: "replayed-real" |
  "testnet" | "synthetic", expected: {state, planStatus, reasonIncludes}, exchanges[]}`.

Out of scope for the 14 days (do not start): database, multi-process locks, real login (week 5
plan in code comments), QuickBooks offering, NetSuite, Tron payment requests, live crediting
finality policy beyond what exists, price feeds.

---

## 3. Known gaps (ranked for the 14-day demo)

| # | Gap | Evidence | Blocks target item | Approval-only? |
|---|---|---|---|---|
| K1 | Posting date is the UTC date | `rules.ts:137`; `bug/xero-posting-date-timezone` | 4 | yes (posting) |
| K2 | No org timezone read; Xero scope `accounting.settings.read` missing | `xero-auth.ts:22`; Xero OpenAPI | 4 | yes (auth/permissions) |
| K3 | No address watching / polling in live mode | `requests/provider.ts:7` | 1, 2 | no (read-only reads), unless it adds keys/settings |
| K4 | No testnet configured; requests are Ethereum-mainnet only | grep; `check.ts:74` | 2 | testnet choice is Aashmiin's |
| K5 | Wrong-network transfer found live records nothing | `provider.ts:83` | 2, 5 | no |
| K6 | Exceptions are spread across `/requests` groups; no single queue with reasons | `requests/ui.ts` | 5 | no |
| K7 | Account codes set by editing `accounting.json` | `docs/ACCOUNTING_SYNC.md` | 1, 4 | yes (posting) |
| K8 | CSRF on all POSTs + recomputable approval key | SECURITY_GAPS #2 | 4 (approval integrity) | yes (auth) |
| K9 | `/api/demo/reset` works in live mode (wipes data) | SECURITY_GAPS #1 | demo safety | yes (customer data) |
| K10 | `xero-tokens.json` written 0644 | SECURITY_GAPS #6 | 1 | yes (secrets) |
| K11 | Reorg-blind ingest; dismiss-while-confirming bug | `bug/dismiss-while-confirming-reorg`; cpe pack G2 | 2 (only if testnet reorgs) | no |
| K12 | Receiving address: regex only, no EIP-55 | cpe pack G3 | 1 | no |
| K13 | `ci` is not a required check; admin bypass exists | ruleset 26284409 | merge gate | yes (repo settings) |
| K14 | Payment pages are Ethereum only | PRODUCT_FACTS | demo copy must say so | n/a |

Honesty rules for the demo: every screen showing scenario data says whether it is a **replayed
public transfer** (Clearline did not receive that money; the invoice's address was set to match it),
**testnet**, or **synthetic demo data**. No invented customers, metrics or results.
