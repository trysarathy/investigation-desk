## Task 1

CODE REVIEW: APPROVE 72ac2dccc099ac8df071c1aac5c388f51e21a480
APPROVAL-ONLY: needs Aashmiin's merge (customer data: this changes which uploaded customer files the importer reads or refuses, src/lib/csv/**)

**Summary (plain English):** Files saved with old Mac line endings (a carriage return with no line feed) are now refused with one clear message saying which line and how to re-save the file, instead of being misread. I ran it and it does what the spec says; the new tests fail without the fix. Approved. It still needs Aashmiin's click because it changes how customer uploads are read (the PR says it is not approval-only; the CSV import path is on the customer-data list, so the line stays).

**Checks I ran at 72ac2dc** (scratch copy of main @0c7d9f1 plus CHANGELOG.md, with the PR diff applied; 2026-11-03 03:05 SGT):
- npx tsc --noEmit: exit 0
- npx vitest run: 20 files passed, 1 skipped; 566 passed, 57 skipped (base without the PR: 562 passed, 57 skipped, so +4 new tests, none removed or skipped)
- npm run lint: 14 errors, 18 warnings, identical to the base (no new problems)
- npx next build: exit 0
- Fix removed (src/lib/csv/parse.ts reverted), tests kept: tests/csv.test.ts 3 failed, each on its own assertion ("expected [] to deeply equal [ Array(1) ]" for the CR-only file, the mixed file and the File A upload); the CRLF / quoted-CR guard test passes both ways, as the PR says it should. So the tests prove the fix.
- Probes at the head: a CR-only File A and a CR-only bulk file both get the new message and 0 rows; a CRLF file reads as before; a CR inside a quoted value stays as text; an unterminated quote still gets the unterminated-quote message.
- Diff size: 40 changed lines (3 files). Secret scan of the diff: nothing found.
- CI on 72ac2dc: I could not read check-runs (live tools are off in this run); the PR description says ci is green. Not counted as seen by me.
- Couldn't run: the real-mode upload through the Upload panel (no running server in this run); the parser path it uses is covered by the File A test above.

**Findings**
1. **praise** src/lib/csv/parse.ts:89-92 and :106-109: the fix matters more than the description says. On main I fed a CR-only File A to the validator and got no file error and 0 rows (the whole file became one header row, and because the last column is optional nothing complained), so a real upload would have been silently empty. With the PR the same file is refused with the new message. Good catch, and small.
2. **note** PR description, "Tests first": on main the failing assertion I saw was "expected [] to deeply equal [ Array(1) ]", not a "Required column … missing" message. Worth correcting in the description so the record matches what main does; no code change needed.
3. **suggestion (non-blocking)** src/lib/csv/parse.ts:89-92: a lone carriage return in the middle of an unquoted value (not at the end of a line) now refuses the whole file with "Line 2 ends with a carriage return only". Refusing is right under our strict-reading rule, but the wording is slightly off for that case. Optional: phrase it as "Line N contains a carriage return without a line feed".
4. **suggestion (non-blocking)** tests/csv.test.ts:203: acceptance criterion 5 names File B and payment-record imports too. They go through the same reader, so it works (I read the call path: on the server, readTable in src/lib/csv/files.ts:103 is the only caller of the parser, and File A, File B, bulk and payment-record imports all go through it), but a one-line test for a File B or payment-record import would pin it.
5. **note** src/components/PaymentImports.tsx:105 (not in this diff): the column-mapping preview in the browser splits the header on line feeds only, so for a CR-only file it shows no usable header before the server refuses the upload. Out of scope here; a possible follow-up row.

**Checklist** (team/playbooks/code-review.md): 1 ✓ 2 n/a (no money or dates) 3 ✓ 4 ✓ (40 lines) 5 ✓ 6 ✓ 7 approval-only (customer data) 8 ✓ (CHANGELOG entry plain and true; demo and real checks stated) 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-03 03:05 SGT

*Also in a real run:* Log row "code-reviewer | PR #61 reviewed | APPROVE 72ac2dc | approval-only: yes | blocking: 0 | <comment url>"; one line for chief-of-staff's Approval Queue note ("#61 APPROVE 72ac2dc: approval-only (customer data, CSV import)"), so it waits for QA on 72ac2dc and then Aashmiin's click rather than the 06:17 auto-merge.
