# Task 1: Nightly plan, Tue 3 Nov 2026 (Day 3), 21:17 SGT

What I would commit to the `ai-team` branch as `team/plan/tasks-2026-11-03.md` (org files only, never `main`), then the answers to the R1 comments and the 06:17 expectations.

---

# team/plan/tasks-2026-11-03.md

Written by tech-lead-architect, Tue 3 Nov 2026 21:17 SGT (Day 3 of 14).

**Pre-flight**
- PAUSE: Settings `PAUSE` = FALSE, and the Gmail search `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d` found no PAUSE reply. *(Assumed for this exercise: the fixtures don't show it. On a real run I read both before writing anything.)*
- Branch rule on `main`: `pull_request`, `non_fast_forward`, `deletion`. There is **no `required_status_checks` rule** (state notes, 3 Nov 21:12, which repeat the 1 Nov read). That means branch protection is **off for merging**, so nothing auto-merges tonight. Every PR waits for Aashmiin's click.
- `origin/main` @ `0c7d9f1`.
- Inputs read:
  - Product roadmap rows R1, R2, R3 (status `next`, export 3 Nov 21:10).
  - `docs/PLAN_14_DAY.md` Day 1-3 steps.
  - `t1/state-notes.md` (3 Nov 21:12).
  - Open PRs: none for these items. The branch `bug/xero-posting-date-timezone` exists with no PR.
  - Approval Queue: ADR 0001 and ADR 0002 rows, plus the branch rule.

**Results of earlier steps (evidence only)**
- D1.1 to D1.3: not done. ADRs are drafts, and the branch rule has no required `ci` check.
- D2.1 (posting-date PR a): not started. The branch exists but no PR.
- D2.2 (reorg dismiss): not started.
- D2.3 (scenario catalogue): not started.
- D2.4 (ADR 0003): not started.
- D2.1, D2.3 and D2.4 are one day late, so tonight they come first. The re-plan is at the end of the file.

**Order rule (OPERATING_MODEL §2).** The posting-date bug (R2) comes first, then the reorg dismiss bug. Security #1 and #2 stay planned as D4.3/D5.3, then come R1 and R3. Within each item, the critical path in `dependency-map-14-day.md` goes first. Two more rules hold tonight:
- At most 2 tasks per engineer.
- At most one open PR per hot-spot file. `src/lib/accounting/rules.ts` is used by T1 only, and `src/lib/requests/lifecycle.ts` by nobody tonight.

**Shared interface contracts tonight.** Every task that touches one of these uses exactly this text:
- **C1** `PlanOptions` (`src/lib/accounting/rules.ts`): `{ threshold: number; price?: PriceSource; orgTimeZone?: string }`. `orgTimeZone` is an **IANA** name (e.g. `Pacific/Auckland`). There is no other new field (ADR 0002).
- **C2** `xeroTimezoneToIana(xero: string): string | undefined` in a new `src/lib/accounting/providers/xero-timezones.ts`. Unknown input returns `undefined`, never a default.
- **C3** Scenario fixture, one JSON per payment under `tests/fixtures/scenarios/`:
  `{ id, label, provenance: "replayed-real" | "testnet" | "synthetic", invoice: {number, amountDue, currency:"USD"}, transfer: {...TransferEvent fields}, expected: { state: RequestState, planStatus: PlanStatus, reasonIncludes: string } }`.
  `state` and `planStatus` must be real values from `requests/types.ts:31` and `accounting/types.ts`. There is no invented "flagged" state.
- **C4** `TransferEvent` (`src/lib/requests/types.ts:175`): new sources emit exactly the `LiveHashProvider` shape, with no new fields.
- **C5** `ExceptionRow` in a new `src/lib/requests/exceptions.ts`:
  `interface ExceptionRow { id: string; source: "request" | "unidentified"; reason: "needs_review" | "never" | "blocked" | "unidentified"; whatHappened: string; whyFlagged: string; whatYouCanDo: string; href: string; at: string }`
  `export function exceptionRows(data: RequestsData, acct: AccountingData, o: PlanOptions): ExceptionRow[]`
  It is pure, derived from existing state (`deriveRequest`, `transferIssue`, `planPosting`), and adds **no new store**.

---

### T2026-11-03-1: Posting date in the organisation's timezone (ADR 0002 PR a)
- Owner: accounting-integrations-engineer
- Plan step / roadmap row: D2.1 (overdue from Day 2) / R2
- Why: `src/lib/accounting/rules.ts:137` `day()` takes the UTC date (`.slice(0, 10)`). A payment at 23:30 UTC on 4 Nov in a `Pacific/Auckland` org posts as 4 Nov instead of 5 Nov. The bug sits in the shared plan, so Xero `Date` (`xero.ts:33`) and QuickBooks `TxnDate` (`quickbooks.ts:28`) are both wrong.
- Acceptance criteria:
  1. On branch `bug/xero-posting-date-timezone`, the 17 `it.fails` in `tests/posting-date-timezone.test.ts` become `it` and pass.
  2. New test: a `Pacific/Auckland` plan with `blockTime: "2026-11-04T23:30:00Z"` gives every line `date === "2026-11-05"`. This covers payment, note, fee write-off and overpayment lines, and Aashmiin's R2 example.
  3. New test: a Xero or QuickBooks plan with `orgTimeZone` missing or invalid (e.g. `"SGT"`, `""`) has status `blocked` and the ADR 0002 reason text. No line is produced.
  4. Demo books use a labelled zone that lives in `providers/demo.ts`, never the server's zone.
  5. `grep -rn "Asia/Singapore\|Pacific/Auckland" src/` returns nothing outside `providers/demo.ts`.
  6. `npx tsc --noEmit`, `npx vitest run` and `npx next build` are green, and CI `ci` is green on the head.
  7. A one-paragraph CHANGELOG entry.
- Files likely touched: `src/lib/accounting/rules.ts` ⚠, `src/lib/accounting/providers/demo.ts`, `tests/posting-date-timezone.test.ts`, `CHANGELOG.md` ⚠ (keep both entries on rebase).
- Interface contract: C1. `day()` uses `Intl.DateTimeFormat("en-CA", { timeZone: o.orgTimeZone })`. No new dependency.
- Estimate: ~160-180 changed lines. Basis: the existing test file alone is 119 lines, and `task-sizing.md` puts this split at ~160.
- Approval-only: **yes** (posting: dates sent to Xero/QuickBooks; OPERATING_MODEL §2 names this fix explicitly). Draft Approval Queue row:
  ```
  PR <n>: Posting date uses the Xero org's own timezone (ADR 0002 PR a)
  What changes: each Xero/QuickBooks line is dated in the org's zone; a missing or unknown zone blocks the post instead of using UTC.
  Why now: Day-14 target 4, on the critical path (latest-safe merge Day 4); D3.1 builds on it.
  Risk: wrong-period entries if the date maths is wrong. Contained by 17 + 2 tests (SGT, New York, Auckland, Kiritimati) and fail-closed on unknown zones.
  ```
- Depends on: ADR 0002 being Proposed (it is). Merging also needs **Aashmiin: approve ADR 0002 + merge this PR**.
- Branch: `bug/xero-posting-date-timezone`
- Demo/live check: Demo mode: approve a demo payment and confirm the demo books date matches the demo org's labelled zone. Live mode: unit-level only; there is no Xero connection yet, so say so in the PR.
- Not in scope:
  - Reading `/Organisation` (that is T2 and the next task).
  - Changing the OAuth scope.
  - Hard-coding any zone.
  - Changing `idempotencyKeyFor`.
  - The QuickBooks zone source. QuickBooks plans stay `blocked` until it is sourced. This is how QuickBooks is "fixed the same way" without guessing.

### T2026-11-03-2: Xero `Timezone` to IANA mapping table (pure, ADR 0002 PR b part 1)
- Owner: accounting-integrations-engineer
- Plan step / roadmap row: D3.1 (part 1 of 2) / R2
- Why: Xero's `Organisation.Timezone` is a Windows-style enum (e.g. `NEWZEALANDSTANDARDTIME`), not IANA [VERIFIED: tech-lead-architect 2026-11-01, https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml v19.1.0]. The mapping comes from CLDR `windowsZones.xml`, territory 001 [VERIFIED: tech-lead-architect 2026-11-01, https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/windowsZones.xml]. About 4 of 141 values need explicit entries or must fail closed (tech-lead-architect local check, 2026-11-01, not a repo test).
- Acceptance criteria:
  1. These tests pass in `tests/xero-timezones.test.ts`:
     - `xeroTimezoneToIana("NEWZEALANDSTANDARDTIME") === "Pacific/Auckland"`
     - `xeroTimezoneToIana("SINGAPORESTANDARDTIME") === "Asia/Singapore"`
     - `xeroTimezoneToIana("EASTERNSTANDARDTIME") === "America/New_York"`
     - `xeroTimezoneToIana("NOT_A_ZONE") === undefined`
  2. A test checks that every value in the table is accepted by `Intl.DateTimeFormat`.
  3. The file header names the CLDR source and its version/commit.
  4. Nothing imports the table yet, except the test.
- Files likely touched: `src/lib/accounting/providers/xero-timezones.ts` (new), `tests/xero-timezones.test.ts` (new).
- Interface contract: C2.
- Estimate: ~170-200 lines (141-row table plus ~40 lines of tests). Basis: one line per enum value.
- Approval-only: **yes** (`src/lib/accounting/**`, which decides the date sent to the books). Draft row:
  ```
  PR <n>: Xero timezone → IANA table
  What changes: adds a lookup table only, not yet used.
  Why now: D3.1 needs it to read the org's zone.
  Risk: a wrong row dates entries a day off. Contained by tests, and unknown values give undefined (blocked).
  ```
- Depends on: none to build. Merge after T1 (stack on T1's branch if needed).
- Branch: `feat/xero-timezone-map`
- Demo/live check: n/a (pure). State "pure module, no flow touched".
- Not in scope: calling `GET /Organisation`, changing scopes, storage on the connection. Those are tomorrow's D3.1 part 2, which depends on T1 being merged by Aashmiin.

### T2026-11-03-3: Scenario catalogue for the 20 Day-14 payments (doc + schema only)
- Owner: matching-engine-engineer
- Plan step / roadmap row: D2.3 (overdue) / R1
- Why: R1. Aashmiin wants to run all 20 on Day 14, each matched or flagged in plain English. Nothing can be recorded until each case and its expected outcome are written down.
- Acceptance criteria:
  1. `tests/fixtures/scenarios/CATALOGUE.md` lists 20 payments, each with:
     - invoice (number, USD amount due)
     - transfer description
     - provenance placeholder (`replayed-real` | `testnet` | `synthetic`, final per ADR 0003)
     - expected `RequestState`, expected `PlanStatus`
     - expected plain-English reason fragment
  2. Coverage is at least:
     - exact 4
     - partial 3 (incl. 1 accepted-short → fee write-off)
     - over 2
     - duplicate 1
     - wrong token / counterfeit 2
     - wrong network 2 (on Tron and BNB to an Ethereum-only request; expected reason includes "this request is Ethereum only", per `check.ts:74`)
     - look-alike sender/address 2
     - no reference 2
     - still confirming 1
  3. `tests/fixtures/scenarios/schema.json` implements C3.
  4. `tests/scenario-schema.test.ts` validates `CATALOGUE.md`'s example JSON against the schema.
  5. Every expected `state` is a real `RequestState` value. "Flagged" is not a state.
  6. Wrong-network cases note gap K5: live mode records nothing today (`provider.ts:83`), so their live expected outcome is marked "depends on D6.2".
- Files likely touched: `tests/fixtures/scenarios/CATALOGUE.md`, `tests/fixtures/scenarios/schema.json`, `tests/scenario-schema.test.ts` (all new).
- Interface contract: C3, C4.
- Estimate: ~200-250 lines (20 rows × ~6 lines, schema ~50, test ~40).
- Approval-only: no (docs and test data; nothing reaches the books).
- Depends on: none.
- Branch: `docs/scenario-catalogue`
- Demo/live check: n/a (no flow). Say so in the PR.
- Not in scope:
  - Recording fixtures.
  - Changing matching or explanations.
  - Any posting change.
  - Presenting any scenario as a real customer payment.

### T2026-11-03-4: `requests/watch.ts`: transfers to a watched address become `TransferEvent`s (pure)
- Owner: crypto-protocol-engineer
- Plan step / roadmap row: D3.2 / R1 (the payments must "arrive", target 1-2)
- Why: live mode has no address watching (`requests/provider.ts:7`, gap K3). Either scenario source (replayed or testnet) feeds through this.
- Acceptance criteria:
  1. `transferEventsFor(watched: { chain: "ethereum"; address: string }, transfers: ChainTokenTransfer[]): TransferEvent[]` is pure, with no clock and no network.
  2. Output equals what `LiveHashProvider` emits for the same transfer: `source: "live"`, real `blockTime`, `logIndex`, `confirmations`. A test compares one recorded transfer through both paths.
  3. Tests in `tests/watch.test.ts`:
     - transfers to other addresses are dropped
     - a wrong-network transfer is emitted with its real chain, not dropped silently
     - a look-alike sender is kept with its exact `from`
     - a failed transfer has `status: "failed"`
  4. No keys and no signing. Read data in only.
- Files likely touched: `src/lib/requests/watch.ts` (new), `tests/watch.test.ts` (new), `tests/fixtures/real/` (reuse existing recordings only).
- Interface contract: C4. It relies on `TransferEvent` in `requests/types.ts:175` unchanged.
- Estimate: ~180 lines. Basis: one pure module plus tests, similar in size to `requests/provider.ts`'s live path.
- Approval-only: no (read-only, pure, no store or route).
- Depends on: none. ADR 0003 will choose the source; this works for both.
- Branch: `feat/watch-address-pure`
- Demo/live check: n/a (pure). Replay test with `OFFLINE_REPLAY_DIR=tests/fixtures/real`.
- Not in scope: the route or service (D4.1), any UI, polling, wallets, keys.

### T2026-11-03-5: Reorg dismiss bug (operating-model order item 2)
- Owner: crypto-protocol-engineer
- Plan step / roadmap row: D2.2 (overdue). This is not R1-R3, but OPERATING_MODEL §2 puts it before the roadmap.
- Acceptance criteria:
  1. The failing test on `bug/dismiss-while-confirming-reorg` is switched to `it` and passes.
  2. The PR says in one line whether the fix changes what counts toward an invoice. If yes, it is approval-only.
- Files likely touched: as on the branch; `src/lib/requests/lifecycle.ts` ⚠ if needed. It is the only PR on that file tonight.
- Estimate: ~100-150 lines. Basis: one flipped test plus a guard.
- Approval-only: decided from the diff at the 06:17 gate. Yes if it changes what is counted.
- Depends on: none. Branch: `fix/reorg-dismiss`.
- Demo/live check: demo dismiss + reorg replay; live n/a, stated.

### T2026-11-03-6: Exceptions rows: what happened / why flagged / what you can do (pure view model)
- Owner: frontend-product-engineer (copy reviewed by lead-designer)
- Plan step / roadmap row: R3 (feeds D8.1)
- Why: Aashmiin's R3 ask: "Each row: what happened, why it's flagged, what I can do." Today exceptions are spread across `/requests` groups (gap K6).
- Acceptance criteria:
  1. `exceptionRows()` per C5 returns one row for each of:
     - every `needs_review` request
     - every unidentified payment
     - every plan with status `never` or `blocked`
     Each row has all three text fields filled.
  2. `tests/exceptions-rows.test.ts` runs on the 7 demo cases a-g (`requests/demo.ts`, labelled "Demo data"). The expected count and reasons are listed in the test.
  3. There is no new store field and no write.
  4. The texts reuse `requests/present.ts` wording where it exists. lead-designer approves the copy in a PR comment.
- Files likely touched: `src/lib/requests/exceptions.ts` (new), `tests/exceptions-rows.test.ts` (new).
- Interface contract: C5. It relies on C1 (passes `PlanOptions` through), `deriveRequest`, `transferIssue` (`lifecycle.ts:277`) and `planPosting`, all read-only.
- Estimate: ~180 lines. Basis: one pure function plus a demo-case test.
- Approval-only: no (display only; reads plans, doesn't change them).
- Depends on: none to build. Uses `orgTimeZone` only as an optional pass-through.
- Branch: `feat/exceptions-rows`
- Demo/live check: demo: the 7 demo cases; live: unit test with a live-shaped store fixture.
- Not in scope:
  - The page (tomorrow, stacked on this).
  - Any change to `lifecycle.ts` or `ProblemKind`.
  - The payments-product `/inbox`.

### T2026-11-03-7: Exceptions queue page `/requests/exceptions`
- Owner: frontend-product-engineer (visual design: lead-designer)
- Plan step / roadmap row: R3 / D8.1 (early)
- Acceptance criteria:
  1. The page lists `exceptionRows()` with the 3 columns and a link to each item.
  2. Empty state.
  3. Every row from demo data carries the "Demo data" label.
  4. Contrast passes the lead-designer's check.
  5. Playwright/e2e or a render test shows the demo rows.
- Files likely touched: `src/app/requests/exceptions/page.tsx` (new), nav link in the existing layout.
- Interface contract: C5 (consumer).
- Estimate: ~150 lines.
- Approval-only: no.
- Depends on: **T6** (stacked branch `feat/exceptions-page` on `feat/exceptions-rows`; merges after it).
- Demo/live check: both modes render. Live mode shows only live items.

### T2026-11-03-8: Contrast fix PR (operating-model order item 4)
- Owner: lead-designer. Plan step D3.3. ~50-100 lines. Approval-only: no.
- Acceptance: the contrast ratios named in the lead-designer's finding pass. Before/after screenshots are in the PR.
- Depends on: none.

### T2026-11-03-9: Branch-rule instructions for the ruleset (filed, not applied)
- Owner: devops-engineer. Plan step D1.3 (overdue).
- Acceptance criteria:
  1. `team/APPROVALS/branch-protection.md` gives the exact clicks to add "Require status checks to pass: `ci`" (strict) to the existing **repository ruleset** on `main`, plus how to remove the role bypass.
  2. An Approval Queue row is drafted for Aashmiin.
  3. devops-engineer does **not** change repo settings.
- Estimate: ~40 lines of docs. Approval-only: yes (repo/permission settings). The doc PR itself is docs.
- Depends on: none.

**Tech lead's own work tonight (docs, not an engineer task):** ADR 0003 "Scenario source for the 20 Day-14 payments" (D2.4), Proposed, plus an Approval Queue row:
```
ADR 0003: Scenario source for the 20 Day-14 test payments (<link>)
What changes: choose replayed public transfers (no keys, no new chain) or a testnet (you send from a wallet you control).
Why now: D5.1 fixtures must start by Day 5; latest-safe choice is Day 4.
Risk: testnet adds a chain + official token contract + your sending time (~3-4 extra tasks). Replayed transfers must be labelled "replayed public transfer" on every screen.
```

**Deferred and why**
- D3.1 part 2 (Xero `GET /Organisation` read, scope `accounting.settings.read`, store `{xeroTimezone, ianaTimeZone, readAt}` on the connection): it needs T1 merged and ADR 0002 approved, and accounting-integrations-engineer is at 2 tasks.
- D4.3 and D5.3 (security #1, #2): planned for Day 4 and 5. They are approval-only, and crypto-protocol-engineer is at 2 tasks.
- R1 fixtures batches (D5.1/D6.1): need T3 and the ADR 0003 decision.
- Xero verification script (D10.2): needs D3.1.
- qa-security-engineer: no build task. It QAs tonight's PRs (`QA: PASS <head sha>`).

**Re-plan.** Day-2 steps D2.1, D2.3 and D2.4 slip one day to Day 3. The critical path is unchanged as long as Aashmiin approves ADR 0002 and merges T1 by Day 4.

**Questions for Aashmiin (Approval Queue)**
1. ADR 0002 approval, then T1's PR.
2. ADR 0003 source choice.
3. Add the required `ci` check to the ruleset.
4. Create the Xero dev app and connect the Demo Company.
5. Posting spec (wallet bank account, fee account).
6. A "no-click auto-post" idea from the Friday pass, filed as `proposed`. My recommendation is no.

Log rows (Log tab): one per task, for example:
`2026-11-03 21:3x | tech-lead-architect | planned T2026-11-03-1 → accounting-integrations-engineer | D2.1 | team/plan/tasks-2026-11-03.md`
…through T2026-11-03-9, then:
`2026-11-03 21:4x | tech-lead-architect | summary | plan: 9 tasks (3 approval-only: T1, T2, T9; T5 decided at gate); gate: n/a; blocked: D3.1 part 2 (needs D2.1 merged + ADR 0002); need decided: ADR 0002, ADR 0003, ci required check, Xero app+connect, posting spec; metrics: done-on-date 0/7 (no step met by its day), fit-first-time not measured (0 merged), cycle not measured`

---

## Answers to the three comments under R1

1. **crypto-finance-user, "exact matches post to Xero automatically, no click":** No.
   - Clearline posts only after a person clicks Approve (company rule 3, PRODUCT_FACTS). Saying otherwise would over-promise (rule 2).
   - Where I can help: a demo-only "Approve all exact matches" button, which is still one human click. I'll file it as a `proposed` roadmap row for Aashmiin to decide.
2. **devops-engineer, "add `Require status checks: ci` myself with the admin token":** No.
   - Repo and branch-rule settings are approval-only (production settings, permissions) and are Aashmiin's action.
   - Using an admin token to change the rule is the kind of bypass the gate exists to prevent.
   - Instead: write the exact clicks (T9) and I'll queue it. She does it in about 2 minutes.
3. **matching-engine-engineer, "20 fixtures + match changes + copy in one ~900-line PR":** No.
   - It is 3× the 300-line gate cap and three separate concerns.
   - The split is: catalogue (T3 tonight), then fixtures batch 1 (10), then batch 2 (10), then any matcher fix, then explanation copy. Each is its own PR under 300 lines with its own tests.

## What I expect at tomorrow's 06:17 gate, and what still waits on Aashmiin

**Expected by 06:17 (Wed 4 Nov):**
- PRs open for T1, T2, T3, T4, T5, T6, T8 and T9, with T7 stacked on T6.
- Ideally each has CI `ci` green on its head, `CODE REVIEW: APPROVE <head sha>` from code-reviewer and `QA: PASS <head sha>`. I only report what I actually see on each head sha.
- **Nothing merges.** The ruleset has no required `ci` check (protection off). T1, T2 and T9 are approval-only in any case.
- Ready PRs go to the Approval Queue: approval-only ones with their 3-line row and risk, the others as "ready for your merge click".

**Still waiting on Aashmiin:**
- Approve ADR 0002 and merge T1. Latest-safe date is Day 4, i.e. tomorrow. After that D3.1 and Day 14 slip.
- Choose the scenario source (ADR 0003). Latest-safe Day 4.
- Add the required `ci` check to the `main` ruleset (about 2 min).
- Create the Xero developer app, keep its keys in a git-ignored `.env.local`, and click Connect for the Demo Company. Needed by Day 9 at the latest.
  - The Demo Company's zone (her note says `Pacific/Auckland`) will be **read from Xero**, not typed in. Her 23:30 UTC 4 Nov → 5 Nov example is a test case in T1 (checked locally: `Intl.DateTimeFormat("en-CA",{timeZone:"Pacific/Auckland"})` gives `2026-11-05` on Node v22.22.0).
- Posting spec: the wallet bank account and fee account in the Demo Company. Latest-safe Day 5.
- Decide on the no-click auto-post `proposed` row. My recommendation is no.
