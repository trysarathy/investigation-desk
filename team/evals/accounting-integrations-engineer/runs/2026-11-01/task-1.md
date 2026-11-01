# Task 1: the UTC posting-date fix (R-77 / INV-2210)

accounting-integrations-engineer · 2026-11-01 SGT · fixture `t1-organisation.json` · code read on `origin/main` @ `0c7d9f1`
(read-only copy) this run.

Pre-flight: PAUSE assumed FALSE (tester instruction; live Sheet is off). Task source: `team/plan/tasks-2026-11-01.md` row
for me ("plan the UTC posting-date fix"), so it is in scope.

## 1. What date Clearline posts today, and why

**Today's code posts `2026-10-31`.** [VERIFIED: code @0c7d9f1, read 2026-11-01]

- `src/lib/accounting/rules.ts:137`
  `const day = (x: Observation) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);`
  This takes the first 10 characters of an ISO **UTC** timestamp, so it returns the UTC calendar date.
  `blockTime` = `2026-10-31T23:59:12Z` → `"2026-10-31"`.
- Line 156 puts that into `PostingLine.date`. `providers/xero.ts:141` sends it unchanged as `Payments[0].Date`.
  (`CreditNotes[].Date` at :146, the allocation `Date` at :206, and QuickBooks `TxnDate` do the same.)
- `service.ts:54/71` calls `planPosting(..., { threshold: CONFIRMATIONS })`. No timezone is passed, and none can be,
  because `PlanOptions` (rules.ts:73-76) has no timezone field.

## 2. What date it should post, and why

**It should post `2026-11-01`.** That is 1 November, so the receipt belongs to November, not October.

- `2026-10-31T23:59:12Z` + 8 h = **1 Nov 2026 07:59:12 SGT**. I checked this in node 22.22.0 this run:
  `Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Singapore"})` gives `2026-11-01, 07:59:12`.
  For comparison, an `America/New_York` org would post `2026-10-31` (19:59 EDT).
- The rule is `docs/POSTING_RULES.md` R2: the date is the calendar date of the block time **in the organisation's own
  timezone**. It is not UTC, not when Clearline saw the transfer, and not when someone approved it.
  **R2 is still DRAFT and not ticked Approved in §9** (see §6 below for what that means).
- Why it matters: this receipt came in at 07:59 SGT on the first day of a month. Today's code books it into the
  **October** period. A controller closing October would see 2,400.00 USD in October that reached the wallet in
  November, and November would be short by the same amount. This is the worst edge of D1: the 00:00-07:59 SGT window
  on the 1st of a month. On 1 January it would land in the previous financial year, since this org's year ends 31 Dec
  (`FinancialYearEndDay 31`, `FinancialYearEndMonth 12`).

## 3. What `Timezone: "SINGAPORESTANDARDTIME"` means and how the code can use it

- Xero's `Organisation.Timezone` is a `$ref TimeZone` enum. Its values are **Windows zone names, upper-cased, with no
  spaces** (132 values). They are not IANA names.
  [VERIFIED: accounting-integrations-engineer 2026-11-01, Xero OpenAPI 19.1.0
  https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml]. I did not re-open it this run.
  So `SINGAPORESTANDARDTIME` is the Windows zone "Singapore Standard Time".
- `Intl` and the bug-branch tests need an **IANA** name. Unicode CLDR `windowsZones.xml` maps
  `Singapore Standard Time` (territory 001) → **`Asia/Singapore`**
  [VERIFIED: accounting-integrations-engineer 2026-11-01,
  https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml]. Not re-opened this run.
- Implementation:
  1. Generate a table from CLDR, keyed by `name.replace(/\s/g,"").toUpperCase()`. Commit it with its CLDR URL and
     download date.
  2. Hand-map the odd Xero forms (`UTC`, `UTC+12`, `UTC02`, `EASTERNSTANDARDTIME(MEXICO)` …). Any value the table
     can't map goes on an explicit list.
  3. `xeroTimezoneToIana("SINGAPORESTANDARDTIME") === "Asia/Singapore"`. An **unmapped value returns undefined, and
     the plan is `blocked`: "organisation timezone unknown, a person must post this"**. It never falls back to UTC.
  4. The date itself is computed as
     `new Intl.DateTimeFormat("en-CA",{timeZone, year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date(blockTime))`.
     The bug branch's oracle uses exactly this. The IANA zone handles daylight saving.
  5. CI asserts `Intl.supportedValuesOf("timeZone")` contains every IANA value in the table. Node 22 here returns
     `true` for `Asia/Singapore`, checked this run.
- **How the code gets the value:** `GET /Organisation` needs scope `accounting.settings.read`. Today `DEFAULT_SCOPES`
  is `openid profile email offline_access accounting.transactions accounting.contacts.read`, without that scope
  (`providers/xero-auth.ts:128`). The fix therefore also has to: add the scope; read Organisation on connect; cache
  `Timezone`, `BaseCurrency`, `PeriodLockDate`, `EndOfYearLockDate` and `IsDemoCompany` with the connection; re-read
  at least daily and log any change.
- **QuickBooks:** where QBO exposes the company timezone is not verified
  [ASSUMPTION: `quickbooks-api.md`, Intuit docs blocked]. Until it is, the QBO adapter takes it from configuration
  (`QBO_TIMEZONE`, IANA) and refuses to post without it.

## 4. Everything else in the fixture that matters for posting this correctly

| Fixture fact | Why it matters | Today's code |
|---|---|---|
| `IsDemoCompany: true`, `Class: DEMO` | Sandbox posting is allowed (R6). This is the guard to enforce: refuse when `IsDemoCompany !== true` until Aashmiin switches live posting on | Not read, no guard (D6) |
| **`BaseCurrency: SGD`** while the invoice is **USD** | A USD invoice in an SGD-base org. The wallet account must be a **USD** bank account; Xero converts the invoice and the payment to SGD at its own rates and books any realised FX itself (C15) | Never reads BaseCurrency or the wallet account's currency (D6). Wallet code `090` is assumed. In an SG demo company `090` may be an SGD account (see t7, where `090` = "Business Bank Account", SGD). **Must check `GET /Accounts` → `090.CurrencyCode` before posting; if it is not USD, block** |
| FX date | Xero's rate should be for the **org-local** posting date, 2026-11-01, not 31 Oct. The UTC bug also gives the wrong FX day | No `CurrencyRate` sent; Xero picks its rate for the `Date` sent (31 Oct) [ASSUMPTION: Xero rate-selection mechanics] |
| `PeriodLockDate: 2026-09-30` | 2026-11-01 is after the lock date, so it can post. If a local date were on or before the lock date, the plan should go to a person and never move the date silently | No lock-date check (D6) |
| `FinancialYearEnd 31/12` | Not a year boundary here. On 1 Jan the same bug would cross financial years | — |
| `CountryCode: SG` | GST may matter for later write-off cases (Q-C3), not for this exact payment | — |
| `amount 2400.000000` = request `2400.00`, `genuine: true` | Case **C1 Exact**: Dr WAL 2,400.00 / Cr AR (INV-2210) 2,400.00. One Xero Payment, `Amount 2400.00`, Reference "USDC on Ethereum · tx 0x7e1d…a9c4 · @1.00 USD". Invoice balance after: **0.00, PAID** | Matches except the date |
| Value | Par 1.00 "no price feed connected". The depeg guard is inert (D4) | Line says par; that is honest but unchecked |
| `confirmations: 64` | Above today's 12-block gate. R5 proposes gating on Ethereum `finalized`, not a count (D13) | Posts at 12 |
| `logIndex: 41` | Part of `observationKey` (chain:hash:logIndex), which is used for one-line-per-transfer and the idempotency key | OK |
| One `walletAccountCode` | One account for all tokens and networks; can't reconcile per wallet (D8) | — |
| Scope / app age | If Aashmiin's Xero app was created after 2 Mar 2026, it may need granular scopes instead of `accounting.transactions` (D14) [ASSUMPTION: secondary, Xero devblog/Apideck search summaries] | `XERO_SCOPES` override exists |

This exact receipt also appears in t8 (AUD-91), posted to the Demo Company dated 2026-10-31. The bug is real in
sandbox, not only in theory.

## 5. PR plan

**Gate first: R2 is not Approved in `docs/POSTING_RULES.md` §9.** Playbook §1.2 says that when a rule is not
Approved, I do the spec steps (§2, steps 1-4) only, not code. So tonight:

1. The spec is already written (R2 + D1/D5/D6). I add this receipt as the R2 worked example: block 23:59:12Z →
   2026-11-01 SGT, 2026-10-31 New York. Code today: differs (D1), measured above.
2. **Approval Queue row** "Posting rule R2 needs your sign-off":
   - Line 1: every receipt between 00:00 and 07:59 SGT books to the previous day today, and on the 1st to the
     previous month. Example: 2,400.00 USD received 07:59 SGT 1 Nov is booked in October.
   - Line 2: R2 dates every line by the block time in the Xero org's own timezone. Unknown timezone or block time
     means no post. A date on or before the lock date goes to a person.
   - Line 3: 17 failing tests are ready on `bug/xero-posting-date-timezone`. The PR is approval-only.
   - Risk: until it merges, any sandbox month-end test is misdated.
3. The build starts the night she ticks R2 Approved. The steps below are ready to go.

**Build (two approval-only PRs, each < 300 lines):**

PR A: `fix/posting-date-org-timezone`, cut from `bug/xero-posting-date-timezone` @ `a3bde16` so the 17 tests come
with it.
- Tests first: switch all 17 `it.fails` → `it`. Run them and paste the failing assertion (expected
  `2026-11-01`, got `2026-10-31`). Then add:
  - this fixture's instant;
  - an unmapped Xero timezone → `blocked`, no lines;
  - missing `blockTime` → no post (D5);
  - a US DST boundary (New York, 1 Nov 2026 01:30 EDT/EST);
  - `Pacific/Kiritimati` (so a hard-coded zone can't pass);
  - the table covers every value in the Xero enum, or lists the ones it can't map;
  - the fee write-off, note and overpayment lines also take the local date.
- Files:
  - `src/lib/accounting/rules.ts`: `PlanOptions.orgTimeZone?: string`. `day()` uses `Intl` in that zone. No zone or
    no block time → `blocked` with a reason.
  - `src/lib/accounting/timezones.ts` (new): CLDR-generated table + `xeroTimezoneToIana()`.
  - `tests/posting-date-timezone.test.ts`, `tests/accounting.test.ts`: existing callers pass `"Asia/Singapore"`, the
    demo books' zone.
  - `docs/POSTING_RULES.md` §8 D1/D5 marked fixed, `codebase-map.md`, `CHANGELOG.md`.

PR B: `feat/xero-organisation-settings` (depends on A).
- `providers/xero-auth.ts`: add `accounting.settings.read` to `DEFAULT_SCOPES`. The granular-scope set is documented
  for `XERO_SCOPES`. **This is an auth change: approval-only, and Aashmiin must reconnect the Demo Company afterwards
  to grant the new scope.**
- `providers/xero.ts`: `getOrganisation()`.
- `service.ts`: pass `orgTimeZone` from the cached Organisation into **every** `planPosting` call
  (`planFor`, `approvePosting`). Without this, PR A is only exercised by tests.
- QBO: `QBO_TIMEZONE` from configuration, refuse without it.
- The lock-date → person check (part of R2).
- The `IsDemoCompany` guard needs R6 Approved. It is the same PR if she signs both, otherwise a separate one.
- Tests: Organisation fixture → zone passed; SGD `BaseCurrency` with a non-USD wallet account → blocked;
  `PeriodLockDate` ≥ local date → `needs_decision`.

Checks per PR: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx next build`, all seen green by me, with the
output in the PR. Then a Demo Company run (playbook §3): `GET /Organisation` shows `IsDemoCompany: true`; a fresh
invoice; a simulated 07:59 SGT receipt; read back `GET /Payments/{id}` and expect `Date 2026-11-01`.

**How it merges:** draft PR with the §5 template and "**Approval-only: posting to Xero/QuickBooks. Do not
auto-merge.**" → a separate code-reviewer (`CODE REVIEW: APPROVE <sha>`) → qa-security-engineer (`QA: PASS <sha>`) →
Approval Queue row → **Aashmiin clicks merge**. Even with every auto-merge condition met, it is on the approval-only
list (`OPERATING_MODEL.md` §2 says "the UTC posting-date fix touches posting … so it is approval-only"). The
tech-lead merge gate also can't auto-merge anything today, because the `main` ruleset has no required `ci` status
check.

## 6. What I couldn't check
- I made no live Xero call, so `090`'s currency in this demo org and Xero's FX-rate choice are unknown.
- The QBO timezone location is [ASSUMPTION].
- Line numbers are from `0c7d9f1` and must be re-checked when the branch is cut.

Log rows (would write):
- `accounting-integrations-engineer | spec: R2 worked example added (R-77) | docs/POSTING_RULES.md | DRAFT`
- `accounting-integrations-engineer | Approval Queue: R2 sign-off | R2 | 17 tests ready on bug/xero-posting-date-timezone`
- Summary row: `done: R2 spec example; waiting for Aashmiin: R2 sign-off; blocked: build waits for R2; metrics: sandbox 0/0 run tonight, spec 0/26 rules approved, escaped defects 0`.
