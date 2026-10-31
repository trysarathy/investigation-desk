# Task 5: #61 and #62 conflict on `PostingLine`, Sat 7 Nov 2026, 06:17 SGT

## Decision: neither PR merges. Both go back to their owners with `INTEGRATION: CHANGES NEEDED`. Neither goes to the Approval Queue yet: they are not ready for Aashmiin to decide.

Gate conditions, checked at 06:17:

| Condition | #61 `61aa0f3` | #62 `62bb9c4` |
|---|---|---|
| Protection on (ruleset lists `required_status_checks [ci]`) | pass | pass |
| `ci` success on head | pass (alone) | pass (alone) |
| `CODE REVIEW: APPROVE <head>` + `QA: PASS <head>` | pass | pass |
| < 300 changed lines | pass (241) | pass (279) |
| Not approval-only | **FAIL**: `src/lib/accounting/**` (money amounts, posting) and it changes rounding and the idempotency key format. "Pure refactor" in the description doesn't override the path map | **FAIL by content**: it builds `PostingLine`s and their dates (what is sent to the books), even though it is outside `accounting/` |
| Integration OK | **FAIL** | **FAIL** |

Integration evidence: my 06:21 local merge of both onto `d4e8a10` merges textually (`src/lib/accounting/types.ts` auto-merged) and then fails `npx tsc --noEmit` with 3 errors in `src/lib/matching/verdict.ts` (48, 61, 74). Each PR is green alone and broken together. Whichever merges first turns the other red. With the strict `ci` rule that is caught, but only after a merge I would have made on bad information.

## The interface conflict
- **#61** renames and retypes `PostingLine.amount: string` → `amountCents: number` (`accounting/types.ts`).
- **#62** builds `PostingLine` object literals with `amount` (verdict.ts:48, 61). After #61 those are unknown properties (TS2353).
- **#62** also uses `kind: "wrong_network"` (verdict.ts:74), which is not a `LineKind` (`payment | fee_writeoff | overpayment | note`, `accounting/types.ts:35`) on either base (TS2322).
- Two engineers changed or relied on the shared seam in opposite directions, with no ADR. The seam table in `codebase-architecture.md` §2 says: "`PostingLine`… No new status or field without an ADR."

**Who owns the shared contract.**
- `PostingLine` / `LineKind` live in `src/lib/accounting/types.ts`. **accounting-integrations-engineer** owns that code.
- **tech-lead-architect** owns the decision about the seam (ADR). Any change to it is approval-only, so Aashmiin approves it.
- Posting lines are built in one place only: `planPosting` in `src/lib/accounting/rules.ts`. The matching side (matching-engine-engineer) owns verdicts and explanation text, not posting lines.

## Every other problem in the diffs

**#61 (integer cents)**
1. **It is a behaviour change, and it introduces the float problem it claims to remove.**
   - `amountCents: Math.round(Number(usd) * 100)` goes through binary floating point.
   - Checked on Node v22.22.0: `Number("1.005")*100 = 100.49999999999999` → 100 (half-up gives 101); `"0.285"` → 28 (should be 29); `"10.075"` → 1007 (should be 1008).
   - So it is off by a cent. QA's "0.1+0.2 style" tests don't cover half-cent inputs.
2. **It replaces our rounding rules.** Today payment lines use `floorCents()` against the running total, and the closing, fee and overpayment lines use `toCents()` half-up (`rules.ts:44-52, 151-152`). A single `Math.round` changes both. That is a posting-rules change, which Aashmiin signs (`docs/POSTING_RULES.md`).
3. **Store shape: rename + retype of a stored field.**
   - `AuditEntry.planned: PostingLine[]` and the posted `lines` are stored in `accounting.json`, and there are **no migrations** (loads spread `{...empty(), ...file}`).
   - Old rows have `amount` and no `amountCents`. The new code would read `undefined` → `num(undefined)` = `NaN` sent to Xero, or `"undefined"` in a key.
   - There is no old-file test.
4. **Idempotency key format changes.** The canonical string goes from `"12.34"` to `"1234"`, so every key changes:
   - plans approved before the merge become stale ("approve again");
   - a retry of a partly posted plan would send Xero a **new** `Idempotency-Key`, which is the duplicate-record risk. That is hard to reverse (adr-guide #4).
5. **Premise not shown.** Amounts reaching `num()` are already 2-dp strings from `toCents`/`floorCents`. `Number("1234.57")` serialises as `1234.57` (checked locally). If there is a real edge risk, it is better fixed at the edge, without a type change.
6. **Diff completeness.** The excerpt changes `xero.ts` `num()`, but I don't see `quickbooks.ts` `amt()`, `providers/demo.ts`, `engine.ts` or the `/books` UI, which all read `amount`. I'll check the full file list (`gh api .../pulls/61/files`) before any re-review.

**#62 (verdicts)**
1. **It builds posting lines outside the posting rules.** Lines for partial and over payments are built in `src/lib/matching/verdict.ts`, which bypasses `planPosting`. As a result:
   - no `accountCode`;
   - no `observationKey` (so the idempotency key and the partial-post tracking break);
   - no `floorCents`/`toCents`;
   - no USD conversion: `amount: received` uses the *token* amount as USD, ignoring `usdRate` and `DEPEG_LIMIT`;
   - no `fee_writeoff` path;
   - `sub(received, due)` is not rounded to cents.
2. **UTC dates.** `blockDateUtc(tx)` = `new Date(...).toISOString().slice(0,10)` hard-codes the UTC date. That violates ADR 0002 (org timezone, unknown → blocked) and is exactly the bug that #52 / D2.1 fixes.
   - Also, `Observation.blockTime` is an ISO string (`requests/types.ts:146,188`), not unix seconds. `tx.blockTime * 1000` would be `NaN`, and `toISOString()` throws. Need to check which `tx` type it uses.
3. **Wrong network marked `postable: true`.**
   - `wrong_network` is in `neverKinds` (`rules.ts:98`): it must never post.
   - Requests are Ethereum-only (`check.ts:74`). A "Held: wrong network" posting line contradicts both.
4. **A parallel verdict model.** `src/lib/matching/` doesn't exist on main. Verdicts and explanations already live in `requests/lifecycle.ts` (`transferIssue`, `ProblemKind`, line 277) and `requests/present.ts`. `VerdictCategory` duplicates `ProblemKind`, misses `counterfeit`, `failed`, `timing`, duplicate and no-reference (all needed in the Day-14 set), and adds `lookalike`, which has no `ProblemKind` mapping.
5. **Approval-only by content** (dates and amounts sent to the books), so it could never have gone through the gate as written.

**Process note.** Both PRs got APPROVE + QA PASS while carrying these defects. I'll add "builds PostingLine outside rules.ts", "retypes a stored field" and "Math.round on money" to the reviewer and QA checklists. This goes to chief-of-staff for Sunday's worst-output list.

## Exact PR comments
`gh api -X POST repos/trysarathy/investigation-desk/issues/61/comments -f body=...`
```
INTEGRATION: CHANGES NEEDED 61aa0f3
Not merging. 1) Approval-only (src/lib/accounting/**: money amounts, posting) whatever the "pure refactor" label says. 2) Merged with #62 on d4e8a10, tsc fails (verdict.ts 48/61: 'amount' not in PostingLine). 3) Behaviour change: Math.round(Number(usd)*100) gives 100 for "1.005" (half-up = 101), 28 for "0.285"; it also replaces floorCents/toCents rules. 4) Renames + retypes a stored field (audit planned/lines in accounting.json; no migrations): old rows read as undefined, so NaN would go to Xero. 5) Changes every idempotency key ("12.34" → "1234"): stale approvals and a new Idempotency-Key on retries, so duplicate risk. Please don't rework this PR: the PostingLine seam is now decided by ADR (tech-lead-architect, tonight). Follow-up task T2026-11-07-2 replaces it with an edge-only guard. Back to accounting-integrations-engineer. by: tech-lead-architect
```
`gh api -X POST repos/trysarathy/investigation-desk/issues/62/comments -f body=...`
```
INTEGRATION: CHANGES NEEDED 62bb9c4
Not merging. 1) Builds PostingLines outside planPosting (rules.ts): no accountCode/observationKey, no cents rounding, token amount used as USD, so approval-only by content and wrong. 2) blockDateUtc hard-codes the UTC date (ADR 0002 says org timezone, unknown → blocked). 3) kind "wrong_network" isn't a LineKind (tsc error at verdict.ts:74), and wrong_network is in neverKinds (rules.ts:98): it must never be postable. 4) Duplicates transferIssue/ProblemKind (lifecycle.ts:277) and present.ts; misses counterfeit/duplicate/no-reference. 5) Breaks with #61 (verdict.ts 48/61). Please rework as explanation text only (no PostingLine import, no dates, no postable flag), on the existing request states. See T2026-11-07-3. Back to matching-engine-engineer. by: tech-lead-architect
```

## Follow-up tasks (written into `team/plan/tasks-2026-11-07.md` at 21:17)

1. **T2026-11-07-1: ADR 0005 "PostingLine stays exact decimal strings and is built only by planPosting"** (tech-lead-architect, docs)
   - Context: this conflict.
   - Decision:
     - `amount: string` unchanged;
     - no new `LineKind` without an ADR;
     - lines are produced only in `rules.ts`;
     - an integer-cents representation, if ever wanted, is a new optional field with an old-file test, never a rename;
     - the idempotency key format is frozen except by ADR (cf. ADR 0004).
   - Status Proposed → Approval Queue (posting, money).
   - Order: first, tonight.
2. **T2026-11-07-2: Edge guard for amounts sent to Xero/QuickBooks** (accounting-integrations-engineer)
   - Scope: no type change. `num()`/`amt()` assert the string matches `^-?\d+(\.\d{1,2})?$` before conversion, else the line is `failed` with the reason. Test that every 2-dp string from 0.00 to 1,000,000.00 (sampled, plus half-cent edge cases) serialises to the same 2-dp JSON number.
   - Acceptance: tests pass; `idempotencyKeyFor` unchanged (a snapshot test of 3 known keys); old `accounting.json` fixture loads.
   - ~80-120 lines.
   - **Approval-only** (money). Draft row:
     ```
     PR <n>: Guard amounts at the Xero/QuickBooks edge
     What changes: refuse any non-2-dp amount instead of sending it.
     Why now: replaces #61 safely.
     Risk: a too-strict guard blocks a valid post (fails closed, with the reason).
     ```
   - Depends on: ADR 0005 Proposed.
   - #61 is closed by its author once this is open (I don't delete branches).
3. **T2026-11-07-3: Plain-English verdicts for the Day-14 categories, explanation only** (matching-engine-engineer)
   - Scope: extend `requests/present.ts` (or a new `src/lib/requests/verdict-copy.ts`) with text for each Day-14 case, mapped from the existing `RequestState` + `ProblemKind`: exact, partial, over, wrong token, counterfeit, wrong network ("this request is Ethereum only"), look-alike, duplicate, no reference.
   - No `PostingLine` import, no dates, no `postable`.
   - Acceptance:
     - a test per category asserts the key phrase;
     - `grep -n "PostingLine\|toISOString" ` in the new code is empty;
     - lead-designer copy review;
     - `team/CLAIMS_REVIEW.md` rules.
   - ~200 lines. Not approval-only (display text).
   - Depends on: none. It can run in parallel with task 2: different files, and no hot spot shared tonight (`lifecycle.ts` untouched).
4. **T2026-11-07-4: Day-14 partial/over posting covered by planPosting tests** (accounting-integrations-engineer, tests only)
   - Scope: for scenario cases partial, accepted-short (fee write-off) and over, assert `planPosting` output: kinds, cents, account codes, `orgTimeZone` date, `never` for wrong network/token/counterfeit.
   - If a case fails, the fix is a separate approval-only PR in `rules.ts`, never in matching.
   - ~150 lines. Not approval-only (tests only), but any fix it finds will be.
   - Depends on: D2.1/#52 merged by Aashmiin (for `orgTimeZone`); the T2026-11-07-2 merge order is not required.
   - Order: after task 2 (to avoid two accounting PRs open on the same tests at once).
5. **T2026-11-07-5: Pairwise integration check before the gate** (devops-engineer)
   - Scope: a script `scripts/integration-pairs.sh` that, for open PRs touching the same seam file (`accounting/types.ts`, `requests/types.ts`, `rules.ts`, `lifecycle.ts`), merges them locally onto `main` and runs `npx tsc --noEmit`. The output is read by the 06:17 gate.
   - Read-only to GitHub.
   - ~80 lines. Not approval-only (a script, not CI settings; changing `.github/workflows` would be).
   - Order: any time.

**Order:**
- tonight: 1 (ADR) → 2 and 3 in parallel;
- after #52 is merged: 4;
- 5 independently.

## Log rows
```
2026-11-07 06:3x | tech-lead-architect | gate PR #61 61aa0f3 | held: approval-only (accounting/** money, rounding, key format) + INTEGRATION CHANGES NEEDED (tsc fails with #62; retypes stored field) | https://github.com/trysarathy/investigation-desk/pull/61
2026-11-07 06:3x | tech-lead-architect | gate PR #62 62bb9c4 | held: approval-only by content (builds posting lines, UTC dates) + INTEGRATION CHANGES NEEDED (LineKind, neverKinds, ADR 0002) | https://github.com/trysarathy/investigation-desk/pull/62
2026-11-07 06:3x | tech-lead-architect | summary | gate: merged none | held #61, #62 (interface conflict on PostingLine; both approval-only) ; need decided: ADR 0005 (tonight) ; metrics: fit-first-time: both PRs counted as needing an integration fix
```
