# Task 6: Morning integration check and gate, Fri 6 Nov 2026 (Day 6), 06:17 SGT: PRs #60, #61, #62

Source: `t6-integration.json` (fictional PRs and shas). `origin/main` = `1a2b3c4`, which includes
#51 (`PlanOptions.orgTimeZone?: string`; a Xero plan with no zone is `blocked`). Real code facts at
`0c7d9f1` that the analysis relies on:
- `AccountSettings` (`src/lib/accounting/types.ts:113`): `walletAccountCode`, `feeAccountCode`,
  and optional `overpaymentAccountCode`, which exists "so older data files still load".
- `type Source = "simulated" | "live"` (`src/lib/requests/types.ts:51`); `TransferEvent.source:
  Source` (`types.ts:175-176`).
- `day()` at `rules.ts:137` (replaced by #51).
- The store has no migrations: it loads `{...empty(), ...file}`.

## Pre-flight
PAUSE = FALSE. Branch rule: PR required + required `ci` (strict), so **protection is on**.
The contracts these PRs were built against (tasks-2026-11-05):
- T2026-11-05-2 (D4.1): the watcher emits `TransferEvent` exactly like `LiveHashProvider`
  (`source: 'live'`, real `blockTime`); no new fields.
- T2026-11-05-3 (D5.2): `AccountSettings` additions optional with defaults; the posting date zone
  comes **only** from the Xero connection (ADR 0002).
- ADR 0002 was approved by Aashmiin (Decisions log 2026-11-02).

## Problems found

### Cross-PR (fit)
| # | Problem | Files | Rule broken |
|---|---|---|---|
| X1 | **The same seam is defined two ways: two org timezone sources.** #60 adds `XeroConnection.orgZone.ianaTimeZone` (per ADR 0002). #61 adds `AccountSettings.timezone` and reads `o.orgTimeZone ?? accounts.timezone ?? 'UTC'`. | `accounting/types.ts`, `accounting/rules.ts`, `accounting/service.ts` | ADR 0002 decision 4 (the zone comes from Xero `/Organisation`); the T2026-11-05-3 contract; playbook §4.2 "same seam defined two ways" |
| X2 | #60 and #61 both edit `src/lib/accounting/types.ts`, and #61 also edits `rules.ts`, which is a hot spot and was already changed by #51 on `main`. | `types.ts`, `rules.ts` ⚠ | `task-sizing.md` rule 3 (one open PR per hot spot per night). **This one is partly my planning miss:** two tasks touched `accounting/types.ts` the same night. Recorded as a lesson for the plan. |

### PR #60: Xero `/Organisation` → IANA + `accounting.settings.read` (head `6060aaa`, author accounting-integrations-engineer)
| Condition | Result |
|---|---|
| CI `ci` on head `6060aaa` | pass |
| `CODE REVIEW: APPROVE 6060aaa` (code-reviewer), `QA: PASS 6060aaa` (qa-security-engineer), neither the author | pass |
| Size | pass: 214 + 9 = 223 < 300 |
| Mergeable | pass (`true`) |
| Fit with ADR 0002 | pass on the summary: `orgZone?` is **optional** (old files load); the shape is `{xeroTimezone, ianaTimeZone, readAt}`, exactly as ADR 0002 decision 4 says; `planFor()` passes `orgTimeZone: conn.orgZone?.ianaTimeZone`, so an unknown zone gives `undefined`, and #51 then blocks the plan; the mapping is 137 CLDR entries + 4 explicit = 141, matching the ADR; the unknown-value test is present. |
| Things I confirm in the diff before calling it OK (not visible in the summary) | (a) A failed or 403 `/Organisation` read stores nothing (it fails closed; no partial `orgZone`). (b) A test checks that every table value is a valid IANA zone (`Intl.DateTimeFormat` doesn't throw). (c) A connection made before the scope change gets a plan `blocked` with the reconnect reason. (d) No `Asia/Singapore` default outside the table and tests. If any is missing, it is a small follow-up task. I don't hold for it unless (a) fails. |
| **Approval-only** | **yes:** `src/lib/accounting/**` (posting dates) **and** a new OAuth scope (`xero-auth.ts`, permissions) |
| **Gate** | **Not merged. Approval Queue** ("ready for your merge click"). |

Comment:
```
INTEGRATION: OK 6060aaa
by: tech-lead-architect
Matches ADR 0002 (orgZone optional {xeroTimezone, ianaTimeZone, readAt}; unknown → no zone → plan blocked; 137+4 mapping). This is the one timezone seam: #61 must not add a second one. Gate: ci, APPROVE and QA PASS on 6060aaa, 223 lines, but approval-only (posting + new scope accounting.settings.read). Queued for Aashmiin. Merge #60 before #61's redo so #61 rebases onto it.
```
Approval Queue row:
```
PR #60: read your Xero org's timezone + add read-only settings scope (ADR 0002 PR b, D3.1) <link> @ 6060aaa. Ready for your merge click.
What changes: Clearline reads the Xero organisation's Timezone once per connection and maps it to a standard zone; unknown → plans blocked; adds scope accounting.settings.read (existing connections must reconnect once).
Why now: target 4 (dates in the org's own timezone); D11.1 live run; latest safe merge Day 10.
Risk: approval-only (posting + permissions). A wrong map entry dates entries wrongly for that zone; contained by mapping tests and fail-closed unknowns. The scope widens access to read-only org settings.
```

### PR #61: account code settings on `/books` (head `6161bbb`, author frontend-product-engineer)
| # | Problem | File | Rule broken |
|---|---|---|---|
| P1 | `AccountSettings.timezone: string // required`: a **required** new field on a stored shape. Old `accounting.json` files have no such field, so it is `undefined` at runtime while typed as `string`. | `accounting/types.ts` | No migrations exist: new fields must be optional with safe defaults (`codebase-architecture.md` §2/§3); the T2026-11-05-3 contract |
| P2 | `const tz = o.orgTimeZone ?? accounts.timezone ?? 'UTC'`: a **silent UTC fallback**. It also bypasses #51's "Xero plan with no zone → blocked", because `tz` is never empty. That regresses the merged fix. | `accounting/rules.ts` ⚠ | ADR 0002 decision 2 (no silent UTC fallback); role never-do; ADR 0001 (a PR contradicting an accepted ADR gets changes requested) |
| P3 | The posting zone is free text on `/books` with default `'UTC'`: a second, hand-typed source for the date sent to the books. | `src/app/books/page.tsx` | ADR 0002 decision 4; contract "zone comes only from the Xero connection" |
| P4 | New `POST src/app/api/accounting/settings/route.ts` has **no Origin check**. A cross-site form could change the wallet or fee account codes and so where money is booked. | new route | SECURITY_GAPS #2 (High, CSRF); path map: `src/app/api/accounting/**` is approval-only |
| P5 | `mergeable: false`: conflicts with `main` in `rules.ts` and `types.ts` (#51 merged). | | §4.2: conflict |
| P6 | **No `QA: PASS 6161bbb`.** Only an APPROVE exists. | comments | §2 verdicts |
| P7 | Approval-only (posting rules, account codes, `src/lib/accounting/**`, `src/app/api/accounting/**`). | | OPERATING_MODEL §2 |
| P8 | Acceptance item "validated against the connected org's accounts" (D5.2) doesn't appear in the diff summary. Checked in the redo. | | D5.2 acceptance |
| Note | code-reviewer approved a diff that contradicts an accepted ADR and adds a UTC fallback. I flag it to code-reviewer (playbook `code-review.md` ADR check), so the checklist catches this next time. | | |
Size 188 + 14 = 202 passes. CI `ci` success on `6161bbb` passes. Neither saves it.

**Gate: hold.** Comment:
```
INTEGRATION: CHANGES NEEDED 6161bbb
by: tech-lead-architect
Back to T2026-11-05-3 (frontend-product-engineer). Breaks ADR 0002 and the task contract:
1) Remove `timezone` from AccountSettings, the /books form and rules.ts. The posting date zone comes only from the Xero connection (#60 orgZone). `?? 'UTC'` is a silent UTC fallback, and it disables #51's blocked-when-missing rule.
2) Any new AccountSettings field must be optional with a default (no migrations; old accounting.json must load). Add a test that loads an old-shape file.
3) POST /api/accounting/settings needs the same-origin check (SECURITY_GAPS #2) and a cross-site test.
4) Rebase: conflicts with main in rules.ts/types.ts. After the redo, rules.ts should not be in the diff at all.
5) QA: PASS is missing; it's needed on the new head.
Approval-only (posting rules); it goes to Aashmiin once ready. Not merged.
```

### PR #62: "Check for payments" on a watched address (head `6262ccc`, author crypto-protocol-engineer)
| # | Problem | File | Rule broken |
|---|---|---|---|
| Q1 | **CI red on head `6262ccc`:** `tests/accounting.test.ts > posting > a live transfer posts once (source 'watch' not handled in planPosting filter)`. The `ci` success is on the older `6262bbb`. | | §4.3 (`ci` success on the head sha) |
| Q2 | **Verdicts are on `6262bbb`, not the head `6262ccc`.** Neither APPROVE nor QA PASS counts. | comments | §4.4 |
| Q3 | `TransferEvent.source: 'simulated' \| 'live' \| 'watch'` and a new `watchedAt?: string`. This changes a shared seam (`Source`, `requests/types.ts:51`), a hot-spot file. The contract said: emit exactly like `LiveHashProvider`, `source: 'live'`, no new fields. The failing test shows the ripple: posting code filters on `source`, so a watched payment would not post (or would need a posting-rule change). | `requests/types.ts` ⚠ | T2026-11-05-2 contract; `adr-guide.md` "when to write one" #1 (changing a shared seam needs an ADR) |
| Q4 | Kept as written, it would be **approval-only**: handling `'watch'` in `planPosting` changes what reaches the books. Done as contracted (`'live'`), it is not approval-only. | | path map §7 |
| Q5 | The new state-changing route `src/app/api/requests/watch/route.ts` (it ingests and writes `requests.json`) falls under SECURITY_GAPS #2 (no CSRF yet). Once D5.3 lands, middleware covers it. Until then the redo must make sure the route only reads the chain and ingests through `ingest()`'s dedupe, and qa-security-engineer reviews the route's auth aspects. | new route | `codebase-architecture.md` §1 (routes → QA review of auth/CSRF) |
| Q6 | The D4.1 acceptance item "unknown/error → nothing recorded, 'couldn't check' message" needs a named test. Confirm `tests/watch-route.test.ts` has it. | | D4.1 acceptance |
Size 142 + 3 = 145 passes. Mergeable passes.

**Gate: hold.** Comment:
```
INTEGRATION: CHANGES NEEDED 6262ccc
by: tech-lead-architect
Back to T2026-11-05-2 (crypto-protocol-engineer).
1) ci is red on head 6262ccc (accounting.test.ts "a live transfer posts once"); the ci success and both verdicts are on the old 6262bbb.
2) Contract: emit TransferEvent exactly like LiveHashProvider: source "live", real blockTime, no new fields. Drop 'watch' and watchedAt from requests/types.ts. That also fixes the posting test without touching planPosting (otherwise approval-only + ADR).
3) Add or confirm the test "chain lookup error → nothing recorded + couldn't-check message".
Then fresh ci, CODE REVIEW and QA on the new head. qa-security-engineer: please review the new route's CSRF exposure until D5.3 lands.
```

## Gate result
| PR | Result |
|---|---|
| #60 | INTEGRATION OK; **queued for Aashmiin** (approval-only: posting + scope). Not merged. |
| #61 | **Held**: CHANGES NEEDED (ADR 0002 breach, silent UTC fallback, required stored field, CSRF, conflict, no QA). |
| #62 | **Held**: CHANGES NEEDED (ci red on head, verdicts on an old sha, contract breach on `TransferEvent`). |
**Nothing merges this morning.**

## Re-plan for tonight (`team/plan/tasks-2026-11-06.md`)
The order is chosen so the hot spots don't collide: #60 is the only accounting `types.ts` change
until she merges it. #61's redo branches from `main` and rebases onto #60 once it lands. It no
longer touches `rules.ts`.

### T2026-11-06-1: Fix #62 to the TransferEvent contract
- Owner: crypto-protocol-engineer
- Plan step / roadmap row: D4.1, R17
- Why: D4.1 is late (was Day 4) and blocks D6.2 and D7.1.
- Acceptance criteria:
  1. `requests/types.ts` has **no diff** (`Source` stays `"simulated" | "live"`; no `watchedAt`).
  2. The watcher emits `TransferEvent` with `source: "live"` and a real `blockTime`.
  3. `tests/accounting.test.ts > posting > a live transfer posts once` passes.
  4. `tests/watch-route.test.ts` covers: transfers found → ingested once (re-run = no duplicate,
     dedupe by `Observation.key`); chain error → nothing recorded + "couldn't check" message;
     wrong-network transfer → no request matched.
  5. `ci` is green on the head; fresh APPROVE and QA PASS on that sha.
- Files likely touched: `src/lib/requests/service.ts`, `src/app/api/requests/watch/route.ts`,
  `tests/watch-route.test.ts` (the `requests/types.ts` diff is removed)
- Interface contract: `TransferEvent` as `LiveHashProvider` produces it (`source: "live"`);
  `checkWatched(address: string): Promise<{found: number; recorded: number; message?: string}>`
  in `requests/service.ts`. That shape is stated now so D4.2 (UI) can rely on it.
- Estimate: net ~140 lines (it shrinks: the types.ts edits come out). Basis: the current 145.
- Approval-only: no (read-only chain calls; no posting change), as long as criterion 1 holds
- Depends on: none
- Branch: `feat/watch-route` (existing; push new commits, no force-push)
- Demo/live check: demo: the 7 demo cases are unchanged. Live: replay a recorded transfer to a
  watched address with `OFFLINE_REPLAY_DIR`.
- Not in scope: `planPosting`, a new `Source` value, any polling or scheduled job (that would
  need an ADR).

### T2026-11-06-2: Redo D5.2 account-code settings without a timezone
- Owner: frontend-product-engineer (lead-designer for the form)
- Plan step / roadmap row: D5.2
- Why: needed for correct accounts in Xero (target 4). Latest safe merge Day 10.
- Acceptance criteria:
  1. No `timezone` anywhere in `AccountSettings`, `/books` or `rules.ts`; `rules.ts` is not in the
     diff.
  2. Any new `AccountSettings` field is optional with a default. A test loads an old-shape
     `accounting.json` (without the new fields) and plans exactly as before.
  3. `POST /api/accounting/settings` refuses a cross-site request (`Sec-Fetch-Site` not
     `same-origin` and `Origin` ≠ host) with 403. Test `tests/books-settings.test.ts > cross-site
     POST refused`. If D5.3's middleware check has merged, rely on it and keep the test.
  4. Account codes are validated against the connected org's accounts. Demo books are validated
     against the demo chart. With no connection, a clear "connect Xero first" message, and nothing
     saved.
  5. `ci` green, APPROVE and QA PASS on the head.
- Files likely touched: `src/lib/accounting/types.ts` (rebase onto #60 when it merges),
  `src/lib/accounting/service.ts`, `src/app/api/accounting/settings/route.ts`,
  `src/app/books/page.tsx` ⚠, `tests/books-settings.test.ts`
- Interface contract: `AccountSettings { walletAccountCode: string; feeAccountCode: string;
  overpaymentAccountCode?: string }`, unchanged except optional additions. The posting zone is
  `PlanOptions.orgTimeZone` ← `XeroConnection.orgZone?.ianaTimeZone` only (ADR 0002).
- Estimate: ~200 lines (basis: #61 was 202, minus the timezone parts, plus the CSRF and old-file
  tests)
- Approval-only: **yes** (posting rules / account codes; `src/app/api/accounting/**`). Draft AQ
  row: `PR #<n> account codes on /books (D5.2)`; `What changes: you pick the wallet and fee
  accounts on a screen instead of in a file`; `Why now: target 4, latest safe Day 10`;
  `Risk: a wrong code books money to the wrong account; validated against the org's chart, cross-site changes refused`.
- Depends on: Aashmiin's posting spec (wallet bank account + fee account). If it isn't signed by
  tonight, build with demo-books codes only and say so in the PR.
- Branch: `feat/books-account-settings-v2` (new from `main`; close #61 with a link when the new PR
  opens)
- Demo/live check: demo: save codes and check a demo plan uses them. Live: with no Xero connection
  the form explains it and saves nothing.
- Not in scope: any timezone input, any change to `planPosting`.

### #60 follow-up (only if the diff check finds a gap)
If (a)-(d) under #60 are not all covered: one small task for accounting-integrations-engineer
(tests only, ~40 lines, approval-only by path) on top of #60, before her merge. Otherwise none.

### Also tonight (unchanged from the plan)
D6.3 SECURITY_GAPS #6 (`xero-tokens.json` 0600) → accounting-integrations-engineer, approval-only.
It touches `xero-auth.ts`, which #60 also touches. Branch it from #60's branch, or sequence it
after #60 merges, so there's one open PR per file. D6.1 scenario batch 2 → matching-engine-engineer
if D5.1 is on `main`.

### Downstream dates
- D4.1: Day 4 → PR fixed Sat 7 morning at the earliest. **D6.2** (wrong-network recorded, depends
  on D4.1): Day 6 → Day 8.
- **D7.1** needs D4.1: at risk for Day 7; likely Day 8.
- D5.2: Day 5 → redo PR Sat 7; her merge by Day 10 (latest safe) is still possible.
- Day-14 items at risk: none yet beyond the buffer, but target 1 (connect wallet) and target 5
  (exceptions with reasons) have no slack left. Said in tonight's email.

## Log rows
```
2026-11-06 06:2x | tech-lead-architect | gate PR #60 6060aaa | queued for approval: approval-only (posting + scope); INTEGRATION OK | <#60 link>
2026-11-06 06:2x | tech-lead-architect | gate PR #61 6161bbb | held: ADR 0002 breach (second tz seam, ?? 'UTC'), required stored field, no CSRF on new route, conflict, no QA PASS | <#61 link>
2026-11-06 06:2x | tech-lead-architect | gate PR #62 6262ccc | held: ci failure on head; verdicts on 6262bbb; TransferEvent contract breach (source 'watch', watchedAt) | <#62 link>
2026-11-06 06:2x | tech-lead-architect | RISK: PR #61 adds silent UTC fallback in posting (rules.ts) that would undo #51's blocked rule | PR #61 6161bbb | diff rules.ts
2026-11-06 06:3x | tech-lead-architect | summary | gate: merged none | held #61, #62 | queued #60 ; blocked: D4.1 (#62 fix), D5.2 (#61 redo + posting spec), D6.2/D7.1 at risk ; need decided: merge #60, posting spec ; metrics: fit-first-time 0/0 merged today (2 of 3 PRs need integration fixes: #61, #62), lesson: two tasks touched accounting/types.ts on one night
```
