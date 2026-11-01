# Task 1: Nightly plan, Day 2 (Mon 2 Nov 2026, 21:17 SGT)

Eval run: live tools are off, so the Sheet, Gmail and GitHub steps below are written as what I would
do. Inputs are the fixtures `t1-roadmap.csv`, `t1-open-prs.json`, `t1-last-night.md` and
`common-context.md`. PR numbers and shas are fictional fixture data. Code facts come from a read-only
look at `origin/main` @ `0c7d9f1`.

---

## A. The file I would commit: `team/plan/tasks-2026-11-02.md`

```markdown
# Tasks for the night of Mon 2 Nov 2026 (Day 2 of 14)

Written 21:17 SGT by tech-lead-architect.

## Header
- PAUSE: FALSE. Settings `PAUSE` read; Gmail search
  `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d` found no PAUSE reply.
  Google account: aashmiin@gmail.com (not hatch.sg).
- Branch rule on `main` (`gh api repos/trysarathy/investigation-desk/rules/branches/main`):
  `deletion`, `non_fast_forward`, `pull_request` only. **No `required_status_checks` (ci)**, so
  branch protection is **off for merging**. Classic protection: 404. Result: **nothing merges by
  agent**. Every merge-ready PR goes to Aashmiin as "ready for your merge click".
- `origin/main` = `0c7d9f1` (same as Day 1).
- Inputs read: Product roadmap R12-R21 (bug/next/todo rows owned by Product only; R20 `proposed`
  and R21 owned by Aashmiin are skipped); `docs/PLAN_14_DAY.md` Day 2 and overdue steps; open PRs
  #50 `a11c0de`, #51 `b2f7e91`, #52 `c3d4e5f`, #53 `d9e8f70`; last night's
  `tasks-2026-11-01.md` (T1-T6); QA nightly result (Sun 22:53); Decisions log (2026-11-02 10:05);
  Approval Queue (3 open rows).

## Last night's results (from evidence only)
| Task | Step | Result | Evidence |
|---|---|---|---|
| T1 (tech-lead) | D1.1 docs | **In progress.** PR #50 `a11c0de`: ci success, but `CODE REVIEW: CHANGES REQUESTED a11c0de` (code-reviewer: "too big, split ADRs from the plan"). 410 lines, over the 300 cap. I split it tonight (see "Tech-lead docs" below). | #50 comments |
| T2 (devops) | D1.2 baseline | **Done.** devops Log row: "npm ci/tsc/vitest/build exit 0 @ 0c7d9f1". `ci` success on `0c7d9f1` (check-runs read 2026-11-01, `docs/ARCHITECTURE.md` §1.9). | Log row; check-runs |
| T3 (devops) | D1.3 ruleset instructions | **Done** (the acceptance criterion is "filed in Approval Queue"). The ruleset change itself is still waiting for Aashmiin. | AQ row "Branch rule: require ci" |
| T4 (accounting-integrations) | D2.1 ADR 0002 PR (a) | **Merge-ready, waiting for her merge.** #51 `b2f7e91`: ci success on head; `CODE REVIEW: APPROVE b2f7e91` (code-reviewer); `QA: PASS b2f7e91` (qa-security-engineer); 159 changed lines. **Approval-only** (posting, `src/lib/accounting/rules.ts`). Aashmiin approved ADR 0002 (Decisions log 2026-11-02 10:05) and said she will merge #51 herself. | #51 checks and comments |
| T5 (crypto-protocol) | D2.2 reorg dismiss | **In progress, CI red.** #52 `c3d4e5f`: `ci` failure: `tests/requests.test.ts > demo case g duplicate > marks paid once` expected 1, received 2. No review or QA yet. This is a regression in what gets counted toward an invoice. | QA nightly; #52 checks |
| T6 (matching-engine) | D2.3 scenario catalogue | **Merge-ready.** #53 `d9e8f70`: ci success; APPROVE and QA PASS on `d9e8f70`; 190 lines; docs and schema only, so not approval-only. It cannot auto-merge because protection is off. | #53 checks and comments |

`docs/PLAN_14_DAY.md` changes (in the docs PR below): D1.2 done; D1.3 done (AQ filed); D1.1, D2.1,
D2.2 and D2.3 in progress. D2.1 and D2.3 are "criteria met on PR, not merged". Nothing is marked
"done" without a merged sha or a met criterion.

## Picking order tonight (OPERATING_MODEL §2)
1. UTC posting date (R12). PR (a) #51 is waiting for her click. I pull forward the half of PR (b)
   (D3.1) that does not depend on #51.
2. Reorg dismiss (R13): fix #52's red CI.
3. Security gaps by severity: #1 High (demo reset guard, R14) tonight. #2 High (CSRF, R15) is
   deferred one night because of the two-tasks-per-engineer cap.
4. Contrast fix (R16): lead-designer, independent.
5. Roadmap: R17 watched address (D3.2) moves one night. Its owner is on items 2 and 3, which come
   first in the order. R18 (D5.1) is blocked on the ADR 0003 decision. A source-agnostic scenario
   runner is pulled forward so D5.1 stays under 300 lines.

Hot-spot check (`codebase-architecture.md` §8): `src/lib/requests/lifecycle.ts` has one PR
tonight (T2 below). `src/lib/accounting/rules.ts` has no new task tonight (#51 still open on it).
`tests/requests.test.ts` is touched by T2 only. New tasks use new test files.

---

### T2026-11-02-1: Add the Xero `Timezone` → IANA mapping table (ADR 0002 PR b, part 1)
- Owner: accounting-integrations-engineer
- Plan step / roadmap row: D3.1 (part 1 of 2), R12
- Why: Plans for real Xero orgs stay `blocked` until we can turn Xero's org `Timezone` into an
  IANA zone. The table is pure code and does not need #51 merged, so building it tonight keeps the
  critical path moving while #51 waits for her.
- Acceptance criteria:
  1. New `tests/xero-zones.test.ts`, written first and failing:
     `xeroTimezoneToIana("SINGAPORESTANDARDTIME") === "Asia/Singapore"`;
     `"EASTERNSTANDARDTIME"` → `"America/New_York"`;
     `"NEWZEALANDSTANDARDTIME"` → `"Pacific/Auckland"`;
     an unknown value (`"MARSSTANDARDTIME"`), `""` and `undefined` → `undefined`.
  2. One test walks every value in the table and checks that
     `new Intl.DateTimeFormat("en-CA", { timeZone: v })` does not throw, so every value is a real
     IANA zone on Node 22.
  3. The table has an entry for every one of Xero's 141 enum values: 137 derived from CLDR
     `windowsZones.xml` (territory 001), plus explicit entries for the leftovers (e.g.
     `KAMCHATKASTANDARDTIME`, `MIDATLANTICSTANDARDTIME`, `UTC+12`, `UTC+13`). If a leftover has no
     defensible IANA zone, leave it **out**, so it fails closed. The PR description names the
     source files and their versions (Xero OpenAPI 19.1.0, CLDR `windowsZones.xml` @ commit).
  4. No `Asia/Singapore` default anywhere in `src/`. Singapore appears only as one table row and
     in tests.
  5. `npx tsc --noEmit`, `npx vitest run` and `npx next build` are green, and so is `ci` on the PR
     head.
- Files likely touched: `src/lib/accounting/providers/xero-zones.ts` (new),
  `tests/xero-zones.test.ts` (new), `CHANGELOG.md` ⚠ (keep both entries on conflict)
- Interface contract (adds):
  `export const XERO_TO_IANA: Readonly<Record<string, string>>` and
  `export function xeroTimezoneToIana(xeroTimezone: string | undefined): string | undefined`
  in `src/lib/accounting/providers/xero-zones.ts`. An unknown value returns `undefined`, never a
  default. Nothing else calls it yet. Part 2 (T2026-11-03, after #51 merges) wires it to
  `GET /Organisation` and to `PlanOptions.orgTimeZone?: string` (IANA), exactly as ADR 0002 says.
- Estimate: ~190 changed lines (about 141 table lines, ~45 test lines, changelog). Basis:
  `tests/posting-date-timezone.test.ts` is 119 lines; the table is one line per enum value.
- Approval-only: **yes** (path `src/lib/accounting/**`; it decides posting dates). Draft Approval
  Queue row, added when the PR is ready:
  `PR #<n> Xero timezone → IANA table (ADR 0002 PR b1) <link> @ <sha>`
  `What changes: adds a lookup table only; nothing calls it yet; unknown zones map to nothing.`
  `Why now: first half of D3.1, so dates post in the Xero org's own timezone (target 4).`
  `Risk: a wrong row would date entries in the wrong day for that zone; contained: unused until PR b2, every row tested as a valid IANA zone.`
- Depends on: none (ADR 0002 approved 2026-11-02 10:05). It does **not** depend on #51.
- Branch: `feat/xero-zone-map`
- Demo/live check: demo: no behaviour change (state that in the PR). Live: unit tests only; no Xero
  call in this PR.
- Not in scope: no `GET /Organisation` call, no scope change, no change to `rules.ts`,
  `xero-auth.ts` or the store, no fallback zone.

### T2026-11-02-2: Fix #52's regression so demo case g counts its payment once
- Owner: crypto-protocol-engineer
- Plan step / roadmap row: D2.2, R13
- Why: #52 (reorg dismiss) breaks
  `tests/requests.test.ts > demo case g duplicate > marks paid once` (expected 1, received 2).
  A duplicate payment counted twice means an invoice could be marked paid, or posted, twice.
- Acceptance criteria:
  1. On branch `fix/dismiss-while-confirming-reorg`, `demo case g duplicate > marks paid once`
     passes again. Do not change or remove that test.
  2. `tests/reorg-dismiss.test.ts` (the flipped `it.fails` → `it`) still passes. Add one test:
     dismissing a reorged ghost while confirming does not change how many times another
     observation is counted.
  3. The PR description says, in plain English, whether the fix changes what is counted toward an
     invoice (`requests/lifecycle.ts` attribution or counting).
  4. `ci` is green on the new head. Ask code-reviewer and qa-security-engineer for verdicts on
     that head sha.
- Files likely touched: `src/lib/requests/lifecycle.ts` ⚠ (the only lifecycle.ts PR tonight),
  `tests/reorg-dismiss.test.ts`, `CHANGELOG.md` ⚠
- Interface contract: relies on `Observation.key = chain:hash:logIndex` (never change its format)
  and `RequestState` (`requests/types.ts:31`), both unchanged. No new fields.
- Estimate: ~40 more changed lines on top of the current 100. Basis: the failing assertion is one
  counting path. If #52 grows past 250 lines, split the new test into its own PR.
- Approval-only: **yes** (when unsure, yes: a fix to what is counted toward an invoice in
  `lifecycle.ts` is in the path map as "what reaches the books"). Draft AQ row:
  `PR #52 reorg dismiss fix (R13) <link> @ <sha>`
  `What changes: a reorged ghost transfer can be dismissed while confirming; duplicates still count once.`
  `Why now: operating-model order item 2; protects matching for the 20-payment demo.`
  `Risk: a counting mistake could mark an invoice paid twice; contained: the case-g duplicate test and the reorg tests.`
- Depends on: none
- Branch: `fix/dismiss-while-confirming-reorg` (existing; push new commits, no force-push)
- Demo/live check: demo: run the 7 demo cases a-g and confirm case g shows one payment. Live:
  `OFFLINE_REPLAY_DIR=tests/fixtures/real` replay suite.
- Not in scope: watched address (D3.2), any change to `ProblemKind`.

### T2026-11-02-3: Refuse the demo-only routes in live mode (SECURITY_GAPS #1 and #4a)
- Owner: crypto-protocol-engineer
- Plan step / roadmap row: D4.3 (pulled forward from Day 4 by operating-model order item 3), R14
- Why: High severity. One `POST /api/demo/reset` wipes a live workspace (customer data), and
  `POST /api/requests/demo` seeds demo data into live mode.
- Acceptance criteria:
  1. Take the tests from `security/demo-reset-guard`
     (`tests/security-demo-reset.test.ts`) and `security/demo-guards-live`
     (`tests/security-demo-guards.test.ts`, part a) and switch `it.fails` → `it`. Both fail before
     the fix and pass after it.
  2. In live mode (`DEMO_MODE=off`), both routes return 403 and leave `workspace.json`,
     `cases.json`, `bulk/` and `requests.json` byte-identical. In demo mode, both still work
     (existing demo tests are green).
  3. The guard uses `isDemoMode()` (`src/lib/mode.ts`). The second switch `demoModeOn()` is not
     used for the new check.
- Files likely touched: `src/app/api/demo/reset/route.ts`, `src/app/api/requests/demo/route.ts`,
  `tests/security-demo-reset.test.ts`, `tests/security-demo-guards.test.ts`, `CHANGELOG.md` ⚠
- Interface contract: none new (reads `isDemoMode(): boolean`).
- Estimate: ~90 changed lines, most of it the two existing test files. Basis: the suggested fix
  in SECURITY_GAPS is about 2 lines per route.
- Approval-only: **yes** (customer data and deletions; path `src/app/api/demo/**`,
  `src/app/api/requests/demo/**`). Draft AQ row:
  `PR #<n> live mode refuses demo reset and demo seeding (SECURITY_GAPS #1, #4a) <link> @ <sha>`
  `What changes: two demo-only buttons stop working outside demo mode.`
  `Why now: High-severity gap; one POST could wipe a live workspace.`
  `Risk: if mode detection were wrong, the demo reset would also be refused; contained: demo-mode tests stay green.`
- Depends on: none
- Branch: `fix/demo-routes-live-guard`
- Demo/live check: demo: reset works and the 7 cases reload. Live: `DEMO_MODE=off` with a scratch
  `DESK_DATA_DIR`; `curl -X POST /api/demo/reset` → 403 and the files are unchanged.
- Not in scope: CSRF (#2, tomorrow); `demoModeOn()` upload guard (#4b).

### T2026-11-02-4: Fix status-pill contrast (WCAG AA)
- Owner: lead-designer (frontend-product-engineer reviews the component change)
- Plan step / roadmap row: D3.3, R16
- Why: operating-model order item 4. The status pills fail WCAG contrast.
- Acceptance criteria:
  1. Every `StatePill` variant has a text/background contrast ratio ≥ 4.5:1. The PR lists each
     variant with its colour pair and ratio.
  2. Before and after screenshots of `/requests` in demo mode.
  3. No change to state names, ordering or copy.
- Files likely touched: `src/components/requests/StatePill.tsx`, `src/app/globals.css`, a new
  test or ratio table in the PR
- Interface contract: none
- Estimate: ~40-80 changed lines. Basis: one component plus its CSS variables.
- Approval-only: no (visual only; no pricing or copy claims)
- Depends on: none
- Branch: `fix/state-pill-contrast`
- Demo/live check: demo: screenshots of `/requests`. Live: same page with `DEMO_MODE=off` and an
  empty store.
- Not in scope: other pages, new components.

### T2026-11-02-5: Scenario runner test (source-agnostic), with zero real fixtures
- Owner: matching-engine-engineer
- Plan step / roadmap row: prepares D5.1 and D6.1, R18
- Why: D5.1 must stay under 300 lines once the source is chosen (10 fixtures alone are about
  210 lines). The runner does not depend on whether ADR 0003 picks replay or testnet.
- Acceptance criteria:
  1. New `tests/scenarios.test.ts`. For each `tests/fixtures/scenarios/*.json` it: validates the
     file against `tests/fixtures/scenarios/schema.json` (from #53); refuses a file whose
     `provenance` is not one of `"replayed-real" | "testnet" | "synthetic"`; runs it through the
     demo books from a fresh `DESK_DATA_DIR`; and asserts `expected.state`, `expected.planStatus`
     and `expected.reasonIncludes`.
  2. With zero scenario files the test passes and prints "0 scenarios". One example file
     `tests/fixtures/scenarios/_example.synthetic.json` with `provenance: "synthetic"` and label
     "Demo data" proves the runner works.
  3. A deliberately mislabelled example (a fixture whose exchanges contain a `synthHex` address but
     say `replayed-real`) is refused, using a `synthetic: true` marker the recorder writes. If that
     marker does not exist, the PR says so and the check goes in D5.1.
- Files likely touched: `tests/scenarios.test.ts` (new),
  `tests/fixtures/scenarios/_example.synthetic.json` (new)
- Interface contract: relies on the scenario fixture format in `docs/ARCHITECTURE.md` §2
  `{id, label, provenance, expected: {state, planStatus, reasonIncludes}, exchanges[]}` and #53's
  `schema.json`. It produces `TransferEvent`s exactly as `LiveHashProvider` does
  (`source: "live"`, real `blockTime`); no new fields.
- Estimate: ~120 changed lines. Basis: a comparable runner in a later fixture is 84 lines, plus
  one example fixture (~22 lines).
- Approval-only: no (tests only)
- Depends on: #53 (schema). Branch from `docs/scenario-catalogue`; rebase onto `main` once #53
  merges. Do not open the PR against `main` until #53 is merged.
- Branch: `test/scenario-runner`
- Demo/live check: demo books only (it is a test).
- Not in scope: any real scenario fixture (waits for the ADR 0003 decision), any change to
  `lifecycle.ts`, `ui.ts` or the exceptions page.

### Tech-lead docs tonight (my own work; not an engineer task)
- Split #50 (410 lines, CHANGES REQUESTED) into 4 docs PRs, each under 300 lines: (i) ADR 0001;
  (ii) ADR 0002; (iii) `docs/ARCHITECTURE.md`; (iv) `docs/PLAN_14_DAY.md` + statuses above. Then
  close #50 with a comment that links the four. Closing a PR is not deleting a branch. Request a
  code-reviewer and QA verdict on each head.
- D2.4: write ADR 0003 (scenario source), status Proposed, with an Approval Queue row. The input
  is #53's catalogue (D2.3 draft is available).

## Deferred tonight, and why
- D3.1 part 2 (`GET /Organisation`, `accounting.settings.read` scope, connection storage, plans get
  `orgTimeZone`): needs #51 merged on `main` (Aashmiin). Planned for the first night after she
  merges.
- D3.2 `requests/watch.ts`: crypto-protocol-engineer is on order items 2 and 3 tonight (cap 2).
  Moves from the night of Day 2 to the night of Day 3. Effect: D4.1 PR on Day 5 morning instead of
  Day 4. D7.1 (Day 7) is still reachable [GUESS: one run per task, no rework]. No Day-14 effect yet.
- SECURITY_GAPS #2 CSRF (R15, D5.3, High): crypto-protocol-engineer is at the cap. First in
  line tomorrow.
- D5.1 / D6.1 scenario batches: blocked on Aashmiin choosing the source (ADR 0003). Latest safe
  date is Day 4.
- frontend-product-engineer: no eligible task. D4.2 needs D3.2's interface; D5.2 needs her
  posting spec; D9.2 needs D3.1. devops-engineer and qa-security-engineer: no task tonight. QA
  still runs its nightly checks and verdicts.
- QuickBooks timezone (ADR 0002 PR c): not sourced, and QuickBooks is not offered. After Day 14.

## Questions for Aashmiin (→ Approval Queue)
1. Merge #51 (approval-only, ready). Latest safe date is Day 4.
2. Merge #53 (ready; not approval-only, but protection is off).
3. Branch rule: add required check `ci` (already queued Day 1).
4. ADR 0001 (already queued Day 1).
5. Xero developer app and connect the Demo Company (Day 3).
6. Posting-rules spec: wallet bank account and fee account (Day 3; latest safe Day 5).
7. ADR 0003 scenario source (once the row is up tonight; latest safe Day 4).

Honesty check before saving: no task asks for a secret, a key, signing or a wallet. No hard-coded
timezone. Scenario data must carry a provenance label. No status is claimed without the sha seen.
Planned: 5 engineer tasks (3 approval-only), plus 2 tech-lead docs items. Intended: 5.
```

Commit (on `ai-team`, never `main`):
`git -c user.name="Aashmiin Kaur" -c user.email="aashmiin@gmail.com" commit -m "plan: tasks for night of 2026-11-02 (Day 2)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: <session link>"`

---

## B. Log rows (Company HQ → Log)

```
2026-11-02 21:17 | tech-lead-architect | PAUSE check: FALSE; branch rule: deletion,non_fast_forward,pull_request (no required ci) → protection off | origin/main 0c7d9f1 | gh api rules/branches/main
2026-11-02 21:2x | tech-lead-architect | planned T2026-11-02-1 → accounting-integrations-engineer | D3.1 part 1 (Xero tz → IANA table), approval-only | team/plan/tasks-2026-11-02.md
2026-11-02 21:2x | tech-lead-architect | planned T2026-11-02-2 → crypto-protocol-engineer | D2.2 fix #52 ci (case g counted twice), approval-only | team/plan/tasks-2026-11-02.md
2026-11-02 21:2x | tech-lead-architect | planned T2026-11-02-3 → crypto-protocol-engineer | D4.3 SECURITY_GAPS #1 + #4a, approval-only | team/plan/tasks-2026-11-02.md
2026-11-02 21:2x | tech-lead-architect | planned T2026-11-02-4 → lead-designer | D3.3 contrast fix | team/plan/tasks-2026-11-02.md
2026-11-02 21:2x | tech-lead-architect | planned T2026-11-02-5 → matching-engine-engineer | scenario runner (prep D5.1) | team/plan/tasks-2026-11-02.md
2026-11-02 21:2x | tech-lead-architect | queued for approval PR #51 | ready for your merge click: posting date in org timezone (ADR 0002 PR a) @ b2f7e91 | <PR #51 link>
2026-11-02 21:2x | tech-lead-architect | queued for approval PR #53 | ready for your merge click: scenario catalogue (D2.3) @ d9e8f70 | <PR #53 link>
2026-11-02 21:2x | tech-lead-architect | Approval Queue row "ADR 0002" marked decided (approved 2026-11-02 10:05, Decisions log) | — | Approval Queue
2026-11-02 21:2x | tech-lead-architect | summary | plan: 5 tasks (3 approval-only); gate: n/a (evening); merged none | held #50 (changes requested, 410 lines: splitting), #52 (ci red) ; blocked: D3.1 part 2 (needs #51 merged), D5.1/D6.1 (ADR 0003 source choice), D5.2 (posting spec), D11 path (Xero app) ; need decided: merge #51, merge #53, branch rule ci, ADR 0001, Xero app, posting spec, ADR 0003 ; metrics: done-on-date 2/3 (D1.2, D1.3; D1.1 not), fit-first-time not measured (0 merged), cycle not measured (0 merge-ready-and-merged; #51/#53 merge-ready ~<24 h from task file)
```
(One more row after the evening email: `sent evening status Day 2 | <message id>`.)

---

## C. Approval Queue rows I would add

No duplicates of open rows: "Branch rule: require ci" and "ADR 0001" stay as they are. The
"ADR 0002" row is marked decided.

1. ```
   PR #51: posting date in your Xero org's timezone (ADR 0002 PR a) <link> @ b2f7e91. Ready for your merge click.
   What changes: posting lines use the org's timezone (IANA); a Xero plan with no known zone is blocked, never UTC.
   Why now: critical path (D2.1 → D3.1 → D11.1); latest safe merge is Day 4 (Wed 4 Nov).
   Risk: approval-only (posting). If wrong, entries land on the wrong day; contained by 17 timezone tests + the blocked-when-missing test; ci, APPROVE and QA PASS all on b2f7e91.
   ```
2. ```
   PR #53: 20-payment scenario catalogue + fixture schema (D2.3) <link> @ d9e8f70. Ready for your merge click.
   What changes: docs and a JSON schema only; no app behaviour.
   Why now: ADR 0003 and the scenario batches build on it.
   Risk: low (no code paths). It waits for you only because main does not require the ci check yet.
   ```
3. ```
   Xero developer app + connect the Demo Company (D3.1 / D11.1)
   What to do: create a Web app at Xero (redirect http://localhost:3000/api/accounting/xero/callback); put XERO_CLIENT_ID/XERO_CLIENT_SECRET in a git-ignored .env.local on the demo machine (never in chat or the repo); click Connect Xero → Demo Company.
   Why now: target items 1 and 4; latest safe Day 9.
   Risk: none to customers (demo org). The new scope accounting.settings.read is read-only settings access and needs one reconnect after PR (b).
   ```
4. ```
   Posting-rules spec for the Demo Company: wallet bank account + fee account (D5.2)
   What to do: name the Demo Company bank account that stands for the stablecoin wallet, and confirm the fee account (proposed 404 Bank Fees); sign docs/POSTING_RULES.md.
   Why now: D5.2 account settings; latest safe Day 5.
   Risk: wrong accounts → entries in the wrong account in the demo org; nothing posts without your Approve.
   ```
5. ADR 0003 row: added when ADR 0003 is written tonight (format in `adr-guide.md`).
