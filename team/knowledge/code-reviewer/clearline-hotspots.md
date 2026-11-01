# Clearline hotspots: where a review must slow down

All lines read on `origin/main` @ `0c7d9f1` on 2026-11-01 [VERIFIED: code @0c7d9f1] unless labelled.
Line numbers drift: grep for the name, don't trust the number. When a PR touches any file below, read
the whole file, not just the hunk.

## 1. Money: `src/lib/decimal.ts`, `src/lib/payments/money.ts`, `src/lib/accounting/rules.ts`
- **The helpers.** `decimal.ts`: `isDecimal`, `compareDecimal` (:9), `isZero` (non-negative decimal
  strings, no floats). `payments/money.ts`: `add` (:33), `sub` (:38), `abs`, `eq`, `mulBps` (:55),
  `sum` (:61), signed, exact, `BigInt` at each value's own scale. `accounting/rules.ts`: `cmp`,
  `floorCents` (:44), `toCents` (:51, rounds half-up at the 3rd decimal), `DEPEG_LIMIT = "0.005"` (:30,
  a string). `requests/lifecycle.ts`: `toBaseUnits` (:85), `percentOf` (:93, BigInt tenths),
  `formatUsdc` (:77).
- **The one allowed float boundary.** `providers/xero.ts:27` `const num = (s: string) => Number(s); //
  Xero's JSON takes numbers; amounts are already rounded to cents` and `providers/quickbooks.ts:21`
  `const amt = (s: string) => Number(s)`. These convert a **cents string** (2 decimals, from `toCents`)
  into a JSON number at the last moment. Rules for a diff: a new `Number()` on an amount anywhere else is
  blocking; feeding these converters anything that isn't a `toCents` result is blocking; arithmetic on
  their output is blocking.
- **What a correct money change looks like.** Amounts stay strings end to end; comparisons via
  `compareDecimal`/`cmp`/`eq`; arithmetic via `add`/`sub`/`mulBps`; rounding only via `toCents` /
  `floorCents`, with the rounding rule stated in a comment; tolerances are strings (`"0.005"`, like
  `DEPEG_LIMIT`). Tests include an amount with 6 decimals (USDC/USDT) and one at a large magnitude
  (≥ 100,000.00), and the exact boundary value.
- **Posting lines must add up.** `rules.ts` ~:139-158: each payment line is the rounded-down running total
  minus what earlier lines posted, so lines never exceed what arrived; a fully covered invoice closes
  exactly. Any change here: check that `sum(payment lines) + fee_writeoff` equals what the invoice will
  show as paid, to the cent, including a 6-decimal receipt like `999.995`. A `fee_writeoff` of `"0.00"`
  is a red flag (posts a zero credit note and does not close the invoice).
- **Decisions that move money in the books need a person.** Short payments post as a partial payment
  plus a note until a person chooses `accept_short` or `request_balance` (`rules.ts` ~:172-190,
  `lifecycle.ts allowedDecisions`). A diff that writes off, accepts or refunds anything without a
  recorded person decision changes posting rules: approval-only, and needs a spec row.

## 2. Dates and timezones
- **The org-timezone rule** (Aashmiin's order #1, `company/OPERATING_MODEL.md` §2): the posting date of an
  accounting line is the calendar date of the transfer's block time **in the accounting organisation's
  own timezone**, for Xero and QuickBooks alike; not UTC, and not a hard-coded Singapore.
- **Today's bug:** `rules.ts:137` `const day = (x: Observation) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);`
  = the UTC date. The failing tests are on `bug/xero-posting-date-timezone`
  (`tests/posting-date-timezone.test.ts`, 17 `it.fails` cases incl. month end and a New York org).
- **Xero gives the org timezone as a Windows-style enum, not IANA.** Xero's own OpenAPI spec: the
  Organisation `Timezone` is `$ref: TimeZone`, an enum such as `SINGAPORESTANDARDTIME`,
  `NEWZEALANDSTANDARDTIME`, `EASTERNSTANDARDTIME`. [VERIFIED: https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml opened 2026-11-01 (lines ~23258, 23586-23694)]
  `new Intl.DateTimeFormat("en-CA", { timeZone: "SINGAPORESTANDARDTIME" })` throws
  `RangeError: Invalid time zone specified: SINGAPORESTANDARDTIME` [VERIFIED: ran 2026-11-01, node 22.22.0].
  So a fix must map Xero's value to an IANA zone, with a test using the real enum string.
  QuickBooks' company timezone format: [ASSUMPTION: not checked; developer.intuit.com not opened].
- **Unknown timezone = pause, never guess.** If the org timezone can't be read or mapped, the plan must
  not post with a default (company rule: unknown facts stay unknown). A `?? "Asia/Singapore"` or
  `?? "UTC"` default in a posting path is blocking.
- **The page and the post must use the same date.** `service.ts planFor` (the plan a person sees) and
  `approvePosting` (what posts) must compute dates the same way. `idempotencyKeyFor` (`rules.ts:68`)
  hashes kind, amount, observationKey and accountCode, **not the date**, so a date that differs between
  the shown plan and the posted plan will not be caught by the approval key.
- **Other date spots.** `payments/mapping.ts` ~:140-158 (epoch seconds vs ms window; `iso8601_offset`
  passes through); chain block times are UTC ISO strings (`chain/evm.ts:230`, `chain/tron.ts:94`). Any
  new `new Date(<string without offset>)`, `toLocaleDateString()` without `timeZone`, or
  `.toISOString().slice(0, 10)` used as a business date is a finding. Tests for dates must include
  00:00-07:59 SGT (UTC is the day before) and a month-end case.

## 3. Accounting providers: `src/lib/accounting/`
- `engine.ts approveAndPost`: posts only after a person approves the plan **by its key**; refusals are
  audited. PR #36 (open, `xero-scopes` → `qa-polish`) makes the key mandatory. Any diff that posts
  without an `expectedKey` match, or writes to the books outside `approveAndPost`, is blocking and
  approval-only.
- `providers/xero.ts` / `quickbooks.ts`: body builders `xeroBody`, `qboBodies` (tests check exact shapes);
  `Idempotency-Key` header on Xero writes; errors are thrown with the first 300 chars of the response.
  `xero-auth.ts`: tokens, scopes (`DEFAULT_SCOPES`), `XERO_CLIENT_SECRET` from env. Any change here is
  approval-only (posting / auth / secrets).
- `service.ts adapterFor`: demo mode always uses the demo books; a refusal to reach the books is audited.
  New network calls added before posting must sit inside the audited `try`, or a failure leaves no audit row.
- Facts about the product (`company/PRODUCT_FACTS.md`): Xero in testing, QuickBooks code exists but not
  offered, NetSuite designed only. Copy in a diff must not say more.

## 4. Chain reads: `src/lib/chain/`, `src/lib/requests/check.ts`, `src/lib/engine/`
- Read-only by construction: only read JSON-RPC/HTTP methods. A diff adding `eth_sendRawTransaction`,
  `eth_sign*`, `personal_*`, TronGrid `broadcasttransaction`/`createtransaction`, or any signing or
  wallet library is **BLOCK** (custody/signing).
- Unknown ≠ negative: an RPC error, missing receipt or unknown head must pause, not read as "not found"
  or "0 confirmations". Look for `?? 0`, `|| 0`, `catch { return [] }` around chain reads.
- Identity is the contract address, never the symbol; decimals are per contract (BSC-USD = 18).
  Confirmations: `CONFIRMATIONS` in `requests/check.ts`. Payment requests are Ethereum-only
  (`requests/check.ts:74`). Details: `team/knowledge/crypto-protocol-engineer/` (attack-patterns,
  erc20-trc20, finality-reorgs).

## 5. Demo-mode guards
- Two switches today: `isDemoMode()` (`src/lib/mode.ts:8`: demo unless `DEMO_MODE` is
  off/0/false/no/live) and `demoModeOn()` (`src/lib/demo/reset.ts`, only `DEMO_MODE === "1"`), used by
  `api/uploads/[kind]` and `api/payments/clear`. SECURITY_GAPS #4b: they disagree.
- Routes that change data and must refuse the wrong mode: `api/demo/reset` (gap #1: no guard),
  `api/requests/demo` (gap #4a: no guard), `api/uploads/[kind]`, `api/payments/clear`.
- Review rule: a new or changed state-changing route must use **`isDemoMode()`** (the one switch), not a
  string compare on `process.env.DEMO_MODE`; a test must cover `DEMO_MODE=off` **and** another live
  spelling (`live`, `0`, `false`).

## 6. Middleware and auth: `src/middleware.ts` (33 lines)
- HTTP Basic preview gate when `PREVIEW_USER`/`PREVIEW_PASSWORD` are set; constant-time compare `same()`;
  only `/pay/` is exempt (:18). Gap #3: the payer's `POST /api/pay/<id>/check` is blocked. A fix must
  exempt exactly `POST ^/api/pay/[A-Za-z0-9_-]+/check$`, never the `/api/pay` prefix.
- Gap #2: no CSRF check. A fix belongs here (Sec-Fetch-Site / Origin on non-GET `/api/*`).
- Anything in this file is approval-only (auth).

## 7. CSV export: `src/lib/csv/cell.ts`
- `csvCell` prefixes `'` when a cell starts with `= + - @ TAB CR`, quotes on `" , \n \r`; `csvValue`
  lets exact amounts (`/^-?\d+(\.\d+)?$/`) out as numbers. Used by `bulk/export.ts` and
  `payments/export.ts`. Gap #7 (full-width, zero-width/BOM, `;`) is open with failing tests on
  `security/csv-injection-fullwidth`.
- Review rule for a fix: neutralise **for the check** (decide on a normalised copy), but export the
  customer's own characters plus the neutralising `'`/quotes. An export must not silently rewrite what
  the customer imported: Unicode compatibility normalisation (NFKC) folds many characters (full-width
  letters, ligatures, fractions), so check the output, not only the test. Every case in the security test
  file stays. Approval-only (customer data in exports, per SECURITY_GAPS #7).

## 8. Files and secrets on disk
- `src/lib/lock.ts writeAtomic` (:29) writes with the default mode (gap #6: `xero-tokens.json` 0644).
- `DESK_DATA_DIR` / `.data/` hold customer working data; `.env*`, `.data/`, `.next/`, `website/out/`,
  `.onnx` must never be in a diff (company code rules).

## 9. CI
`.github/workflows/ci.yml` (PR #42): the required job `ci` runs `npm ci`, `npx tsc --noEmit`,
`npx vitest run`, `npx next build` on Node 22.22.0; `lint` runs but is not required (main has 5 existing
lint errors). Read the check runs for the head sha with
`gh api repos/trysarathy/investigation-desk/commits/<sha>/check-runs`. A diff that edits the workflow,
skips tests (`it.skip`, `describe.skip`, `.only`), or changes `vitest.config.mts` excludes is a finding;
weakening a required check is BLOCK (production/deploy settings, approval-only).
