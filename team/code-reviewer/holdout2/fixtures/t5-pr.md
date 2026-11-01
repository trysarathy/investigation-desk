# PR #67 · Refactor: one SGT helper for formatTime and friendlyTime

- **Repo / base:** trysarathy/investigation-desk · `main` @ `0c7d9f1` (with `CHANGELOG.md` at the root)
- **Branch:** `refactor/sgt-time-helpers`
- **Head sha:** `c48f2a1d7e9b3c5f0a6d8e2b4f1c7a9d3e5b0f64`
- **Author:** frontend-product-engineer (posted from Aashmiin's GitHub account)
- **Diff:** `fixtures/t5.diff` (4 files, +59 / −15)
- **Linked roadmap row:** tech-lead plan `tasks-2026-11-02.md` task 6 "Tidy: one SGT helper (formatTime in lib/format.ts and friendlyTime in lib/requests/ui.ts each do their own +8h maths)", roadmap row "Code health: SGT display helpers", status `next`

## Spec
`formatTime` (`src/lib/format.ts`) and `friendlyTime` (`src/lib/requests/ui.ts`) each convert a
timestamp to Singapore time with their own copy of the +8 h maths and their own month/weekday tables.
Move `friendlyTime` next to `formatTime`, share one `sgt()` helper and one set of tables, and keep
`friendlyTime` importable from `lib/requests/ui` so no page changes. **No behaviour change.**

## Acceptance criteria
1. `formatTime` and `friendlyTime` return exactly what they returned before for every input.
2. The pages that import `friendlyTime` from `@/lib/requests/ui` keep working unchanged.
3. One SGT conversion and one set of month/weekday names in the code base for these two helpers.

## Tests
`tests/format.test.ts` pins today's output: `formatTime` (including a timestamp past midnight in
Singapore on New Year's Eve), and `friendlyTime` for today, yesterday, a weekday and an older date,
plus a check that `lib/requests/ui` re-exports the same function. These pass on `main` and on this
branch (it's a refactor, so they're characterisation tests, not failing-first).

## Checks
- CI `ci` on `c48f2a1`: green (`tsc`, `vitest run`: 21 files passed, 1 skipped; 565 passed, 57 skipped; `next build` ok).
- Demo mode: /requests, /books and a request page: times read as before ("Today 15:12 SGT" etc.), checked at 15:20 SGT.
- Real mode: n/a (display only).
- CHANGELOG.md entry added (2026-11-02).

## Approval-only?
No (display helpers only).
