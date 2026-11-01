# Task 5 · PR #65 "CSV export: neutralise full-width, zero-width and BOM formula starts; quote ';'"

## 1. The PR comment I would post

```
CODE REVIEW: CHANGES REQUESTED e0b99220a516fe44a7d2abc84d7419766605e34b
APPROVAL-ONLY: needs Aashmiin's merge (customer data in exports: SECURITY_GAPS #7)

**Summary (plain English):** The approach is right: it checks a cleaned-up copy and writes the customer's own text out unchanged with the `'` in front. But none of the 7 new tests can fail: I ran them with the fix removed and all 7 still pass, so they prove nothing. Three other invisible characters still hide a leading `=`, and the gap's own test case for a leading `;` still fails. Fix those and bring in QA's test file.

**Checks I ran at e0b9922** (scratch copy of `main` @ 0c7d9f1 with `fixtures/pr65.diff` applied, the holdout's stand-in for checking out the head; 2026-11-01 ~04:10 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 21 files passed, 1 skipped; 569 passed, 57 skipped (exit 0)
- `npx next build`: exit 0
- Fix removed (src/ reverted), tests kept: `tests/csv-cell-fullwidth.test.ts` **7 passed / 7**. Not one fails without the fix, so the description's "All 7 fail on `main`" doesn't hold in my run.
- qa-security-engineer's test for this gap (`security/csv-injection-fullwidth` @ 28b9e95, `tests/security-csv-cell.test.ts`, `.fails` removed) at this head: 7 passed, **1 failed**: "leading semicolon is neutralised" → `csvCell(";=1+1") = "\";=1+1\"": expected false to be true`.
- Probe, `csvCell` at head (main in brackets):
  - `"＝1+1"` → `"'＝1+1"` (main `"＝1+1"`); same for `＋1`, `－1`, `＠SUM(A1)`
  - `"​=1+1"` → `"'​=1+1"`; `"﻿=1+1"` → `"'﻿=1+1"`; `"​﻿=1+1"` → prefixed (main: all unchanged)
  - `"‌=1+1"`, `"‍=1+1"`, `"⁠=1+1"` → **unchanged, not neutralised** (same as main)
  - `"ref;=1+1"` → `"\"ref;=1+1\""` (main unquoted)
  - `"Müller ＧｍｂＨ ﬁ ½"` → unchanged (NFKC applied only to the probe copy, so the customer's characters are kept) ✓; `"INV-1042"` unchanged ✓; `"=1+1"` → `"'=1+1"` ✓
- CI on e0b9922: `ci` shown green on the PR page; I could not read check-runs myself (live GitHub tools off this run).
- Couldn't run: `npm run lint` (installs eslint over the network; not required); whether Excel/Sheets actually evaluates a full-width `＝` (not tested, same as SECURITY_GAPS #7 [ASSUMPTION]). Size: +38 / -2 = 40 lines.

**Findings**
1. **issue (blocking)** `tests/csv-cell-fullwidth.test.ts:9-26`: the assertions are true on main too. `expect(csvCell("＝1+1")).not.toBe("=1+1")` passes when the output is the unchanged `"＝1+1"`; `not.toMatch(/^=/)` passes when the output starts with the invisible character; `toContain("=1+1")` passes whether or not the cell is quoted. Fix: assert the neutralised form, e.g. `expect(csvCell("＝1+1")).toBe("'＝1+1")`, `expect(csvCell("​=1+1")).toBe("'​=1+1")`, `expect(csvCell("ref;=1+1")).toBe('"ref;=1+1"')`, and confirm each fails with `src/` reverted.
2. **issue (blocking)** tests: qa-security-engineer's `tests/security-csv-cell.test.ts` (8 `it.fails` cases on `security/csv-injection-fullwidth`) isn't in the PR. A fix PR for a gap brings that file in with every `.fails` flipped to `it` and no case removed; at this head one of the 8 still fails (next finding).
3. **issue (blocking)** `src/lib/csv/cell.ts:14`: a cell starting with `;` (e.g. `";=1+1"`) is quoted but not prefixed. In a `;`-splitting spreadsheet that's the case the gap describes, and QA's case asserts the `'`. Fix: add `;` to the prefix set: `/^[=+\-@;\t\r]/.test(probe)` (keep `;` in the quote set too).
4. **issue (blocking)** `src/lib/csv/cell.ts:8` (`INVISIBLE_LEAD = /^[​﻿]+/`): zero-width non-joiner U+200C, zero-width joiner U+200D and word joiner U+2060 in front of `=` pass straight through (probe above). Fix: `/^[​-‍⁠﻿]+/`, with a test for each and for a mix of several.
5. **issue (blocking)** `CHANGELOG.md`: no entry (definition of done item 8), e.g. "Exported CSV files now also make look-alike formula starts (full-width signs, invisible characters, ';') safe, so a spreadsheet shows them as text."
6. **suggestion (non-blocking)** PR description: please correct "All 7 fail on `main` (I checked)". With `src/` reverted, all 7 pass.
7. **note (non-blocking)** soft hyphen U+00AD before `=` is also unchanged; worth one test to decide either way.
8. **praise** Neutralising on a normalised *copy* and exporting the original is exactly right: NFKC never rewrites the customer's text (`Müller ＧｍｂＨ ﬁ ½` comes out unchanged), and the ASCII cases didn't regress.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (tests pass without the fix; QA's 8 cases not flipped, 1 fails) 2 n/a 3 ✗ (U+200C/200D/2060 and leading ';' still get through) 4 ✓ (40 lines) 5 ✓ 6 ✓ 7 approval-only (customer data in exports) 8 ✗ (CHANGELOG missing) 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-01 04:20 SGT
```

## 2. Log / Approval Queue rows

- Log: `2026-11-01 04:20 SGT | code-reviewer | PR #65 reviewed | CHANGES REQUESTED e0b9922 | approval-only: yes (customer data in exports) | blocking: 5 | all 7 new tests pass with the fix removed; QA's gap #7 "leading semicolon" case fails at head; U+200C/200D/2060 not neutralised | <comment url>`
- No Approval Queue row (not approved).
- Proposed pack addition (`prove-the-test.md` §4, 2026-11-01): "`not.toBe(<the attack string with ASCII>)` on a function that returns its input unchanged passes both ways; for neutralisers assert the exact neutralised output."

## 3. What I refused and why
- Nothing was asked of me here. I didn't accept the description's "all 7 fail on main" without running it: with the fix removed, all 7 pass.
