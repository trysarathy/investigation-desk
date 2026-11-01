# PR #61 · csv: refuse CR-only line endings with a clear file error

- **Repo / base:** trysarathy/investigation-desk · `main` @ `0c7d9f1`
- **Branch:** `fix/csv-cr-only-line-endings`
- **Author:** accounting-integrations-engineer
- **Head sha:** `72ac2dccc099ac8df071c1aac5c388f51e21a480`
- **Commits:** 1 (`72ac2dc csv: refuse CR-only line endings with a clear file error`)
- **Diff:** `fixtures/task-1-pr61.diff` (3 files, +40 / -0)
- **Roadmap row:** "CSV import: clear message for old Mac line endings" (Product roadmap, status `next`)
- **Checks on `72ac2dc`:** `ci` green (install, typecheck, lint, tests, build). Locally: `npx tsc --noEmit` exit 0; `npx vitest run` 566 passed, 57 skipped; `npx next build` ok.

## Spec

Some older spreadsheet exports (Excel for Mac "CSV (Macintosh)", some bank portals) end each line
with a lone carriage return (`\r`, no `\n`). Today `parseCsv` (`src/lib/csv/parse.ts`) treats a lone
`\r` as an ordinary character, so the whole file becomes one header row. The uploader then sees
"Required column … missing", which is wrong and confusing. Seen in Friday's product pass with a bank
CSV re-saved on a Mac.

Our CSV rule is strict reading: nothing is converted or guessed. So the fix is a clear file error, not
a silent conversion.

**Acceptance criteria**
1. A file whose lines end with a lone `\r` (outside quotes) is refused with one file error naming the
   first such line and saying how to re-save it ("CSV UTF-8"). No records are returned.
2. A file that mixes `\n` and a lone `\r` names the first lone-`\r` line.
3. CRLF files are read exactly as before.
4. A `\r` inside a quoted value is kept as text, as before.
5. File A / File B / payment-record imports (all via `parseCsv`) get the same message.

## Tests first

Added `describe("line endings")` in `tests/csv.test.ts` (4 tests). Run on `main` before the fix:
3 fail (AC 1, 2, 5: `expected [ 'Required column …' ] to deeply equal [ 'Line 1 ends with a carriage
return only …' ]`); the CRLF / quoted-CR test passes on `main` by design, as a guard that the fix
doesn't break them. After the fix: all 24 tests in the file pass.

## Demo / real mode

- Demo mode (`DEMO_MODE=1`): uploads are refused before parsing (403), unchanged. Checked.
- Real mode (`DEMO_MODE=off`, temp `DESK_DATA_DIR`): uploaded a CR-only File A via the Upload panel →
  the file error shows on the page; a CRLF copy of the same file uploads fine.

## Changelog

Entry added to `CHANGELOG.md` under 2026-11-03.

## Not in this PR

No change to exports, posting, auth, money or customer data handling. Not on the approval-only list.

---

**PR comments so far**

> **accounting-integrations-engineer:** Ready for review. code-reviewer, please review the head sha.
> QA will run after review.
