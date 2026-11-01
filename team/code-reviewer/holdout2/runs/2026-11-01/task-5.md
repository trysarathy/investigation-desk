CODE REVIEW: CHANGES REQUESTED c48f2a1d7e9b3c5f0a6d8e2b4f1c7a9d3e5b0f64

**Summary (plain English):** This is meant to be a tidy-up with no change on screen, but it changes what "Today" and "Yesterday" mean. `friendlyTime` used to compare calendar days in Singapore; it now counts 24-hour periods since the timestamp. At 15:00 SGT on Saturday, something from Friday 23:00 SGT now shows as "Today 23:00 SGT", and something from Thursday 16:00 shows as "Yesterday". The pinned tests miss this because none of their inputs fall in the gap. It's a one-line fix plus four test cases.

**Checks I ran at c48f2a1** (scratch copy of `main` @ `0c7d9f1` + repo `CHANGELOG.md` + `t5.diff` applied, 2026-11-01 ~05:06 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 21 files passed, 1 skipped; 565 passed, 57 skipped
- `npx next build`: exit 0 · `npm run lint`: same problem list as base, none in changed files
- Src change removed, tests kept: `tests/format.test.ts` fails with `TypeError: (0 , friendlyTime) is not a function`, because `lib/format` has no `friendlyTime` on `main`. So the file can't literally "pass on main", as the description says. To check it as a characterisation test, I ran `main`'s `friendlyTime` (copied from `src/lib/requests/ui.ts` @ 0c7d9f1) next to the new one in a temporary probe (deleted after), with now = `2026-10-31T07:00:00Z` (Sat 15:00 SGT):

| Timestamp (SGT) | `main` | this PR |
|---|---|---|
| Fri 30 Oct 23:00 | Yesterday 23:00 SGT | **Today 23:00 SGT** |
| Fri 30 Oct 15:30 | Yesterday 15:30 SGT | **Today 15:30 SGT** |
| Thu 29 Oct 16:00 | Thu 16:00 SGT | **Yesterday 16:00 SGT** |
| Sat 24 Oct 16:00 | 24 Oct 16:00 SGT | **Sat 16:00 SGT** |
| Sat 31 Oct 15:05 (5 min in the future, e.g. clock skew) | Today 15:05 SGT | **31 Oct 15:05 SGT** |
| Sat 31 Oct 00:00 / 00:30 / 09:05, Sun 25 Oct 16:00 | same | same |

  `formatTime` gives identical output for the PR's own cases. The four `friendlyTime` cases in the PR all agree with `main`, which is why the suite is green.
- CI on c48f2a1: I could not read check-runs (live tools off). The description says green, and my runs agree.
- Couldn't run: the on-screen demo-mode check (description: checked at 15:20 SGT, a time when most recent items fall on the same calendar day, so it wouldn't show this).

**Findings**
1. **issue (blocking)** `src/lib/format.ts:42`: `Math.floor((now - ms) / DAY_MS)` counts elapsed 24-hour periods, not Singapore calendar days. That breaks AC 1 ("exactly what they returned before for every input"). It matters on `/requests/[id]` and `/books`. A controller reading "Today 23:00 SGT" at 15:00 sees a time that hasn't happened yet today, and a payment or approval appears on the wrong day in the activity list. Fix: compare the SGT calendar days, as `main` did, using the new helper: `const n = sgt(now); const daysAgo = Math.round((Date.UTC(n.y, n.mo, n.d) - Date.UTC(t.y, t.mo, t.d)) / DAY_MS);`
2. **issue (blocking)** `tests/format.test.ts:16-21`: the characterisation tests don't cover the cases where the two methods differ, so they can't catch this. Fix: add, with the same `NOW`:
   - `"2026-10-30T15:00:00Z"` → `"Yesterday 23:00 SGT"`
   - `"2026-10-29T08:00:00Z"` → `"Thu 16:00 SGT"`
   - `"2026-10-24T08:00:00Z"` → `"24 Oct 16:00 SGT"` (the 7-day edge)
   - `"2026-10-31T07:05:00Z"` → `"Today 15:05 SGT"` (slightly in the future)

   All four fail at this head and pass on `main`'s logic. That is the proof this kind of refactor needs.
3. **suggestion (non-blocking)** PR description, "Tests": "these pass on main" isn't possible as written (TypeError above). Next time, run the same expectations against `@/lib/requests/ui` on `main` to show the pins match the old output. Then say that's what was done.
4. **note** Hard-coding Singapore is fine here: this is display copy for the pilot region, and the spec says so. The org-timezone rule applies to posting dates (`rules.ts`), which this PR doesn't touch. Not approval-only: display helpers only, no posting, money, auth or data.
5. **praise** `src/lib/format.ts:19-30`: one `sgt()` helper and one set of month/weekday tables makes the two formatters easier to keep in step. The re-export in `src/lib/requests/ui.ts` keeps every importing page unchanged (`BooksPanel.tsx`, `requests/[id]/page.tsx`, `requests/payments/[key]/page.tsx`), and the identity test pins it.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (behaviour changed; pins miss it) 2 ✗ (day boundary) 3 ✓ 4 ✓ (74 lines) 5 ✓ 6 ✓ 7 not approval-only 8 ✗ (CHANGELOG "Nothing changes on screen" untrue until finding 1 is fixed) 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-01 05:06 SGT

---
Also: Log row `code-reviewer | PR #67 reviewed | CHANGES REQUESTED c48f2a1 | approval-only: no | blocking: 2 | <comment url>`.
