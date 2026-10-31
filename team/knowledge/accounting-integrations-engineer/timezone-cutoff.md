# Posting date, timezone and period cut-off

## The rule (proposed in `docs/POSTING_RULES.md` R2, awaiting Aashmiin)
The posting date of every line is **the calendar date of the transfer's block timestamp, in the accounting
organisation's own timezone**. Not UTC, not Singapore hard-coded, not the time Clearline saw it, not the time a
person approved it.

## The bug today
`rules.ts:137` `const day = (x) => (x.blockTime ?? x.firstSeenAt).slice(0, 10);` takes the first 10 characters
of an ISO UTC timestamp = the UTC date. The Xero adapter sends it as `Payments[].Date`, `CreditNotes[].Date` and
the allocation `Date`; the QBO adapter as `TxnDate` [VERIFIED: code @0c7d9f1, read 2026-11-01].
For a Singapore organisation (UTC+8, no daylight saving [ASSUMPTION: IANA tz database, not opened]) every receipt
between **00:00 and 07:59 SGT** books to the previous day; on the 1st of a month, to the previous **month**
(and on 1 January, the previous financial year if the year ends 31 Dec).

| Block time (UTC) | SGT | UTC date (posted today) | Correct SGT date |
|---|---|---|---|
| 2026-10-30T15:59Z | 30 Oct 23:59 | 2026-10-30 | 2026-10-30 |
| 2026-10-30T16:00Z | 31 Oct 00:00 | 2026-10-30 ✗ | 2026-10-31 |
| 2026-10-30T23:59Z | 31 Oct 07:59 | 2026-10-30 ✗ | 2026-10-31 |
| 2026-10-31T23:30Z | 1 Nov 07:30 | 2026-10-31 ✗ (October!) | 2026-11-01 |
| same, New York org | 31 Oct 19:30 EDT | 2026-10-31 | 2026-10-31 |

Measured with the probe: a 07:59 SGT 31 Oct receipt gives `payment … 2026-10-30` [VERIFIED: probe run 2026-11-01].
The failing tests are on `bug/xero-posting-date-timezone` (17 `it.fails`, see `codebase-map.md`).

## Where the organisation's timezone comes from
- **Xero:** `GET /Organisation` → `Timezone`, an enum of **Windows zone names upper-cased without spaces**, e.g.
  `SINGAPORESTANDARDTIME` [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]. Requires scope
  `accounting.settings.read` (not requested today).
- **Mapping to IANA:** Unicode CLDR `windowsZones.xml` maps `Singapore Standard Time` (territory 001) →
  `Asia/Singapore`, `Eastern Standard Time` (001) → `America/New_York`
  [VERIFIED: https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml
  opened 2026-11-01]. Xero's enum strips spaces and upper-cases, and has a few odd forms (`UTC+12`, `UTC02`,
  `EASTERNSTANDARDTIME(MEXICO)`), so build the table by normalising CLDR names the same way
  (`name.replace(/\s/g, "").toUpperCase()`), keep the generated table in the repo with its CLDR source and date,
  and **refuse to post on an unmapped value** (unknown pauses; never fall back to UTC).
- **QuickBooks:** company timezone location not verified (`quickbooks-api.md`). Configuration until then.
- Cache the org timezone with the connection (it rarely changes) but re-read it on every connect and at least
  daily; log a change.

## Computing the date
`new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(blockTime))`
gives `YYYY-MM-DD` in the zone (the bug-branch test uses exactly this as its oracle). Node ships full ICU
[ASSUMPTION: Node 18+ default; check `Intl.supportedValuesOf("timeZone")` in CI]. Daylight saving is handled by
the IANA zone (the New York case).

## Which instant
- Block timestamp = when the chain says the transfer happened (value date). It is set by the block producer and
  may differ from wall-clock by seconds [ASSUMPTION; see crypto-protocol-engineer `finality-reorgs.md`].
- If `blockTime` is missing, today the code uses `firstSeenAt` (when Clearline first saw it). Proposed: **don't
  post** until block time is known (codebase-map D5).
- Approval time is irrelevant to the date: a payment received 31 Oct and approved 3 Nov posts on 31 Oct.

## Period cut-off and lock dates
- Xero `PeriodLockDate` and `EndOfYearLockDate` ("Shown if set") [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01].
  If the org-local date is on or before a lock date, Xero rejects or the accountant has closed the period
  [ASSUMPTION about Xero's exact behaviour]. Proposed: the plan shows "period locked: a person must choose the
  date" and goes to a person. **Never silently move a posting to another date.**
- Month-end close: the controller wants receipts that hit the wallet before midnight local on the last day in
  that month. The rule above gives exactly that.
- `FinancialYearEndDay`/`FinancialYearEndMonth` tell you the year boundary [VERIFIED: same spec].

## Tests a fix must pass
The 17 tests on the bug branch (switch `it.fails` → `it`), plus: an unmapped Xero timezone refuses to post; the
Windows→IANA table covers every value in the Xero enum (or lists the ones it can't map); a missing block time
doesn't post; DST boundary in a US org; a lock-date case goes to a person.
