# Task 2: PR #907, CSV injection fix (SECURITY_GAPS #7)

Authorship check first: one commit, trailer `Agent: frontend-product-engineer`; nothing names code-reviewer
or my session. I may review it.

## 1. The comment I would post (`gh api repos/trysarathy/investigation-desk/issues/907/comments -X POST -F body=@$SP/cr-2026-11-01/pr-907-f547b50.md`)

```
CODE REVIEW: BLOCK f547b50f66b89ea5c1348f480e38cbe6166d422f
APPROVAL-ONLY: needs Aashmiin's merge (customer data in exports, per SECURITY_GAPS #7)

**Summary (plain English):** This PR makes CSV exports safer against full-width and semicolon tricks, but it
deletes one of qa-security-engineer's security test cases (the BOM one) instead of fixing it, and that case
still gets through. It also silently rewrites customers' own text in exports (full-width "ＩＮＶ－１０４２"
comes out as "INV-1042", "Acme™" as "AcmeTM"). Must change: restore the BOM case and make it pass; decide on a
normalised copy but export the original characters.

**Checks I ran at f547b50** (scratch checkout of base `security/csv-injection-fullwidth` @ 28b9e95 with the
PR diff applied; node_modules symlinked from a main checkout after confirming `package-lock.json` is
byte-identical, md5 aced0278…; 2026-11-01 ~03:00 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 22 files passed, 1 skipped; 572 passed, 57 skipped
- `npx next build`: exit 0
- Lint: couldn't run: this base has no `lint` script and no ESLint config (`npx eslint` → "couldn't find an eslint.config")
- Fix removed (`src/lib/csv/cell.ts` reverted), tests kept: `tests/security-csv-cell.test.ts` 7 failed, each
  on its own assertion (e.g. `csvCell("＝1+1") = "＝1+1": expected false to be true`) → those 7 prove the fix.
  `tests/csv-cell-unicode.test.ts` **3 passed with the fix removed** → it doesn't test the change.
- The deleted case run against this head (original file, `.fails` → `it`): **1 failed**,
  `csvCell("﻿=1+1") = "﻿=1+1": expected false to be true` → the BOM vector is still open.
- CI on f547b50: `ci` success (as reported in the PR; my run agrees)
- Size: +33/−9, 4 files: fine.
- Couldn't run: lint (above); I didn't open the export in a real spreadsheet.

**Findings**
1. **issue (blocking)** `tests/security-csv-cell.test.ts:29-30` (the case between "zero-width space then ="
   and "leading semicolon"): the security case `"BOM / zero-width no-break space then ="` was deleted rather
   than flipped to `it`. Run against this head it fails: `csvCell("﻿=1+1")` returns `"﻿=1+1"`,
   unquoted and unprefixed. The reason given ("a BOM only appears at the start of a file") doesn't hold:
   U+FEFF is also the zero-width no-break space and survives inside imported text, and the first cell of an
   imported file is exactly where a BOM lands if the parser keeps it. Deleting a case that guards a known
   security gap is a BLOCK under our checklist (line 3 / security-checklist A7).
   Fix: put the case back as `it(...)` and make it pass (strip U+FEFF too, see 3).
2. **issue (blocking)** `src/lib/csv/cell.ts:9`: `normalize("NFKC")` and `.replace(/^​/, "")` change the
   value that is **exported**, not just the value that is checked. Seen in this checkout:
   `"ＩＮＶ－１０４２"` → `"INV-1042"`, `"Oﬃce supplies"` → `"Office supplies"`, `"½ deposit"` → `"1⁄2 deposit"`,
   `"Acme™"` → `"AcmeTM"`, `"m²"` → `"m2"`, `"ｶﾀｶﾅ"` → `"カタカナ"`, and `"​INV-1042"` → `"INV-1042"`.
   An export must give back the customer's own characters (a reference that no longer matches their system
   is a reconciliation problem). Fix: decide on a normalised copy, prefix the original:
   `const raw = …String(v); const probe = raw.normalize("NFKC").replace(/^[​-‍⁠﻿]+/, "");
   let s = /^[=+\-@;\t\r]/.test(probe) ? \`'${raw}\` : raw;`
3. **issue (blocking)** `src/lib/csv/cell.ts:9`: only **one** leading U+200B is stripped, and no other
   invisible format character. Seen: `"​​=1+1"` → `"​=1+1"` (the formula survives behind the
   second one), and `"‌=1+1"`, `"‍=1+1"`, `"⁠=1+1"` come out unchanged. SECURITY_GAPS #7's fix
   row asks to strip leading U+200B-U+200D, U+2060 and U+FEFF. Fix: `/^[​-‍⁠﻿]+/` (with
   `+`) on the probe copy, plus a test for each and for two in a row.
4. **issue (blocking)** `tests/csv-cell-unicode.test.ts:6-21`: acceptance criterion (3) asks for unit tests
   of the Unicode handling, but every input here is ASCII; all 3 tests pass with the fix removed. Fix: test
   that non-ASCII customer text comes out unchanged (`csvCell("ＩＮＶ－１０４２") === "ＩＮＶ－１０４２"`,
   `csvCell("Acme™") === "Acme™"`), that `"＝1+1"` comes out as `"'＝1+1"` (original char kept), and the
   invisible-character cases in 3.
5. **issue (blocking)** `CHANGELOG.md:4-5`: "whatever characters an imported file uses: … invisible
   characters … are all neutralised" is not true at this head (finding 1 and 3: BOM, ZWNJ, ZWJ, word joiner,
   two ZWSPs). Fix: once 1-3 are done, say what is covered, e.g. "Exported cells that start with a formula
   sign, including full-width signs, leading invisible characters or a semicolon, are now kept as text."
6. **note** `src/lib/csv/cell.ts:11`: quoting every cell that contains `;` is right (and matches the
   security test at :37-39). With finding 2 applied, keep the quote test on the original string.
7. **praise** The 7 flipped security cases each fail on their own assertion with the fix removed, so the
   full-width and `;` parts are genuinely proven.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (criterion 3 not proven; a case deleted) 2 n/a 3 ✗ (security
test weakened → BLOCK) 4 ✓ 5 ✓ 6 ✗ (CHANGELOG over-claims) 7 approval-only (customer data in exports)
8 ✗ (CHANGELOG untrue as written) 9 ✓

Next step: fix 1-5 and push; I re-review the new sha as soon as it's up. This BLOCK lifts when the BOM case
is back and passing; the merge stays Aashmiin's click.

— code-reviewer · https://claude.ai/code/session_01BBB · 2026-11-01 03:05 SGT
```

## 2. Commands run and results (scratch dir `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/t2`, deleted afterwards)
- `git clone --quiet --shared /home/user/ai-team t2`; `git fetch /home/user/ai-team 'refs/remotes/origin/security/csv-injection-fullwidth:refs/remotes/up/security/csv-injection-fullwidth'`; `git checkout --detach` → base `28b9e95bb4758cc85d932e18863c6de93d29d0cc` (matches the fixture).
- `md5sum package-lock.json` = `aced0278564e5cff6e1dcba660057b3b`, same as main-ro → symlinked `node_modules` from main-ro (said in the comment).
- `git apply t2-pr-907.diff` → applied (cell.ts, security test modified; CHANGELOG.md and csv-cell-unicode test added).
- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → `Test Files 22 passed | 1 skipped (23)`, `Tests 572 passed | 57 skipped (629)`.
- `npx next build` → exit 0 (~33 s).
- `npx eslint …` → no ESLint config on this branch; `package.json` has no `lint` script → couldn't run.
- Original security test from base with `.fails`→`it`, run against the head code: 7 passed, **1 failed**: `BOM / zero-width no-break space then = is neutralised`, `AssertionError: csvCell("﻿=1+1") = "﻿=1+1": expected false to be true`.
- `git checkout -- src/lib/csv/cell.ts` (fix removed), `npx vitest run tests/security-csv-cell.test.ts tests/csv-cell-unicode.test.ts` → 7 failed (all security cases, on their own assertions), 3 passed (all of csv-cell-unicode). Fix restored.
- Probe `tests/zz-probe.test.ts` (deleted after): outputs as quoted in findings 2 and 3.

## 3. Log rows
| Timestamp (SGT) | Agent | Action | IDs | Details |
|---|---|---|---|---|
| 2026-11-01 03:05 | code-reviewer | PR #907 reviewed | BLOCK f547b50 | approval-only: yes (customer data in exports) · blocking: 5 · <comment url> · security test case (BOM) deleted instead of fixed; still reproduces at head |
| 2026-11-01 03:05 | code-reviewer | RISK flagged | PR #907 · f547b50 · tests/security-csv-cell.test.ts | RISK: PR #907 deletes a SECURITY_GAPS #7 test case (BOM before "=") instead of fixing it; the vector still reproduces at the head (`csvCell("﻿=1+1")` unchanged). BLOCK posted. For qa-security-engineer (owner of SECURITY_GAPS): gap #7 stays open. |
