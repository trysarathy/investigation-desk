# 2. Posting date is the calendar date in the accounting organisation's timezone

Date: 2026-11-01 (SGT)

## Status

**Proposed.** Approval-only: it changes what posts to Xero/QuickBooks (company/OPERATING_MODEL.md
§2: "the UTC posting-date fix touches posting to Xero/QuickBooks, so it is approval-only") and it
adds an OAuth scope (permissions). It is never auto-merged. Aashmiin approves the ADR and then each
PR that implements it.

## Context

- Today every posting line's date is the **UTC** date of the transfer's block time:
  `src/lib/accounting/rules.ts:137` `const day = (x: Observation) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);`
  Xero receives it as `Date` (`providers/xero.ts:33`), QuickBooks as `TxnDate`
  (`providers/quickbooks.ts:28`) [VERIFIED: code read at `0c7d9f1`, 2026-11-01].
- Effect: a payment received 00:00-07:59 in Singapore posts to the previous day; at month end, to the
  previous month. A controller closing November would find a 1 November receipt in October.
- Failing tests exist on branch `bug/xero-posting-date-timezone` (`a3bde16`,
  `tests/posting-date-timezone.test.ts`, 17 `it.fails` tests). They pass an IANA zone via
  `PlanOptions & { orgTimeZone: string }` and include a New York org and a Kiritimati check, so a
  hard-coded Singapore zone cannot pass them [VERIFIED: branch read 2026-11-01].
- Xero exposes the organisation's zone as `Timezone` on `GET /Organisation`, typed as a
  141-value enum of Windows-style names written in capitals without spaces, e.g.
  `SINGAPORESTANDARDTIME`, `NEWZEALANDSTANDARDTIME`, `EASTERNSTANDARDTIME(MEXICO)`. It is **not**
  an IANA name. The endpoint's security lists scopes `accounting.settings` /
  `accounting.settings.read` [VERIFIED:
  https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml (spec version
  19.1.0) opened 2026-11-01]. Our default scopes (`xero-auth.ts:22`) do not include either.
  Whether Xero's 2026 granular-scope change renames this scope: [ASSUMPTION: not checked;
  developer.xero.com was blocked in this session].
- Unicode CLDR maps Windows zone names to IANA (`windowsZones.xml`, e.g.
  "Singapore Standard Time" territory 001 → `Asia/Singapore`) [VERIFIED:
  https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml
  opened 2026-11-01]. Normalising CLDR's names (remove spaces and dots, upper-case) matched 137 of
  Xero's 141 values in a local check; the rest (e.g. `KAMCHATKASTANDARDTIME`,
  `MIDATLANTICSTANDARDTIME`, `UTC+12`, `UTC+13`) need an explicit entry or must fail closed
  [VERIFIED: script run by tech-lead-architect 2026-11-01 on the two files above; a quick check,
  not a test in the repo].
- Node 22 `Intl.DateTimeFormat("en-CA", { timeZone })` gives `YYYY-MM-DD` in a named IANA zone
  (`2026-10-31T23:30:00Z` in `Asia/Singapore` → `2026-11-01`) [VERIFIED: run on Node v22.22.0,
  2026-11-01]. No new dependency is needed.
- QuickBooks: where the company's timezone is read from is not yet sourced
  [ASSUMPTION: not checked]. QuickBooks is not offered, so it follows in a later PR.

- The draft posting-rules spec `docs/POSTING_RULES.md` (accounting-integrations-engineer, 2026-11-01)
  states the same rule as R2 (org timezone; unknown → no post) and gap D6 (no Organisation read,
  scope missing). This ADR is the architecture side of R2; Aashmiin signs both.

## Decision

1. `PlanOptions` gains one optional field, `orgTimeZone?: string`, an **IANA** zone. `day()` in
   `planPosting` becomes the calendar date of `blockTime ?? firstSeenAt` in `orgTimeZone`, via
   `Intl.DateTimeFormat("en-CA", { timeZone })`. Every line kind (payment, note, fee write-off,
   overpayment) uses it.
2. **No silent UTC fallback for a real provider.** If the provider is Xero (or QuickBooks) and
   `orgTimeZone` is missing or not a valid IANA zone, `planPosting` returns status `blocked` with
   the reason "Clearline couldn't read your organisation's timezone, so it won't guess the posting
   date. Reconnect Xero or post this one by hand." Demo books use the demo organisation's stated
   zone (a fixed, labelled value in `providers/demo.ts`), never "the server's zone".
3. No hard-coded `Asia/Singapore` anywhere in posting code. Singapore appears only in tests and in
   the demo org's labelled settings.
4. The Xero adapter reads `GET /Organisation` once per connection, maps `Timezone` to IANA with a
   table generated from CLDR `windowsZones.xml` (territory 001) plus explicit entries for the
   leftovers, stores `{ xeroTimezone, ianaTimeZone, readAt }` on the connection, and the service
   passes `ianaTimeZone` as `orgTimeZone`. Unknown value → not stored → plans `blocked` (rule 2).
5. Add `accounting.settings.read` to the default Xero scopes. Existing connections must be
   reconnected to get it; until then their plans are `blocked` with the reason above.
6. Split into PRs, each < 300 changed lines, each approval-only:
   (a) `planPosting` + `PlanOptions.orgTimeZone` + switch the branch's `it.fails` to `it` + the
   blocked-when-missing test; (b) Xero `GET /Organisation` read, mapping table and its tests, scope
   change, connection storage; (c) QuickBooks equivalent (after it is sourced).

## Consequences

- Correct day and month in the books for every org zone, including month end; the existing tests
  prove it, plus the new fail-closed test.
- Every existing Xero connection must reconnect once (scope change). Aashmiin must approve the
  scope change: it widens what the app may read (settings, read-only).
- A plan that would have posted before can now be `blocked` if the zone is unknown: safer, and the
  reason says what to do.
- The posting date can differ from the UTC date shown elsewhere in the UI; the request page should
  show "Posts as 1 Nov 2026 (your Xero organisation's time, Singapore)" (follow-up, frontend).
- Idempotency: `idempotencyKeyFor` does not include the date, so a plan approved before the fix
  and retried after it keeps the same key; Xero would receive the corrected date. Acceptable, but
  the reviewer must confirm no half-posted plans exist in the test org before PR (a) merges.
- Risk if wrong: entries in the wrong period in a customer's books. That is why it is approval-only
  and why unknown means blocked, not UTC.
