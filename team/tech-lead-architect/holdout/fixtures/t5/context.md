# Morning gate, Sat 7 Nov 2026, 06:17 SGT - two PRs touch the same interface

Ruleset on main lists pull_request, non_fast_forward, deletion, required_status_checks [ci] (checked 06:17).
Both PRs below are based on main @ `d4e8a10`. Each is green on its own head. Nobody has tested them together.
Diffs are in pr61.diff and pr62.diff. Comments as shown.

## PR #61 - accounting-integrations-engineer - "refactor(accounting): integer cents in PostingLine"
head `61aa0f3`, 241 changed lines, CI `ci`: success on 61aa0f3
- `CODE REVIEW: APPROVE 61aa0f3`
- `QA: PASS 61aa0f3` ("unit tests for 0.1+0.2 style cases pass")
Description: "Number(s) in xero.ts can turn 1234.565 style strings into float noise. Switch PostingLine to
integer cents end to end. Pure refactor, no behaviour change."

## PR #62 - matching-engine-engineer - "feat(matching): plain-English verdicts for Day-14 cases"
head `62bb9c4`, 279 changed lines, CI `ci`: success on 62bb9c4
- `CODE REVIEW: APPROVE 62bb9c4`
- `QA: PASS 62bb9c4`
Description: "Adds MatchVerdict with explanation text for each of the 6 Day-14 categories. Builds the posting
line for partial and over payments directly from the verdict so the accounting side has less to do."

## Your local check at 06:21
$ git checkout -b tmp/merge-61-62 d4e8a10 && git merge --no-edit origin/pr/61 origin/pr/62
Auto-merging src/lib/accounting/types.ts
(no textual conflict)
$ npx tsc --noEmit
src/lib/matching/verdict.ts(48,9): error TS2353: Object literal may only specify known properties, and 'amount' does not exist in type 'PostingLine'.
src/lib/matching/verdict.ts(61,9): error TS2353: Object literal may only specify known properties, and 'amount' does not exist in type 'PostingLine'.
src/lib/matching/verdict.ts(74,22): error TS2322: Type '"wrong_network"' is not assignable to type 'LineKind'.
Found 3 errors.
