## Task 4

CODE REVIEW: BLOCK 215874b71f687ef47510437f2cce0665bdf46328
APPROVAL-ONLY: needs Aashmiin's merge (auth: this changes the preview password gate in src/middleware.ts)

**Summary (plain English):** This is labelled docs, but it changes who can get past the preview password. It lets through every address that starts with /api/pay, which includes all of /api/payments: the reconciled export, imports, matching and "clear all records". I ran the gate: those all pass without the password at this head and are refused on main. Only the payer's address check should be let through. Must not merge until the exemption is narrowed.

**Checks I ran at 215874b** (scratch copy of main @0c7d9f1 plus CHANGELOG.md, with the PR diff applied; 2026-11-03 03:50 SGT):
- npx tsc --noEmit: exit 0
- npx vitest run: 21 files passed, 1 skipped; 564 passed, 57 skipped (base 562; +2 new in tests/preview-gate.test.ts)
- npm run lint: 14 errors, 18 warnings, identical to the base
- npx next build: exit 0
- Fix removed (src/middleware.ts reverted), tests kept: "lets the payer's address check through" fails with "expected 401 not to be 401"; "still asks for the password on the rest of the app" passes both ways. So the tests prove the payer's check is let through, but nothing tests what else is let through.
- Probe of the gate with PREVIEW_USER and PREVIEW_PASSWORD set and no password sent (status from the middleware; 200 means let through, 401 means asked for the password):

  | Request | main | this PR |
  |---|---|---|
  | GET /api/payments/export.csv | 401 | 200 |
  | POST /api/payments/clear | 401 | 200 |
  | POST /api/payments/imports/instructions | 401 | 200 |
  | POST /api/payments/match | 401 | 200 |
  | POST /api/payments/mappings | 401 | 200 |
  | GET /api/payments/resolve | 401 | 200 |
  | POST /api/payroll-anything (made-up path) | 401 | 200 |
  | GET /api/pay/abc123/check | 401 | 200 |
  | POST /api/pay/abc123/check | 401 | 200 |
  | GET /requests | 401 | 401 |
- Diff size: 36 changed lines. Secret scan: nothing found.
- CI on 215874b: not read by me (live tools off); the PR says ci is green.
- Couldn't run: the routes themselves behind a running preview. From reading them: the export route asks only for a typed "Acting as" name, which anyone can make up (src/app/api/payments/export.csv/route.ts:11-13), and the clear route removes every imported payment record unless DEMO_MODE is exactly 1 (src/app/api/payments/clear/route.ts:11) [ASSUMPTION: read, not run]. On a password-protected preview with real data, the password is the only thing in front of them.

**Findings**
1. **issue (blocking)** src/middleware.ts:21: the exemption matches by prefix, so every /api/payments route and any future path starting with /api/pay skips the password (table above). This is the exact pattern team/SECURITY_GAPS.md row 3 warns against: it says to exempt only a POST to the check path of one publicId, and never the /api/pay prefix. Fix: let through only a POST whose whole path is /api/pay/, then one publicId (letters, digits, underscore, hyphen), then /check, nothing before or after; every other method and path keeps the password.
2. **issue (blocking)** tests/preview-gate.test.ts:19-23: the guard test checks /, /requests and /api/requests, none of which share the prefix. Fix: add the cases that would have caught this: GET /api/payments/export.csv, POST /api/payments/clear, a GET to the check path, a check path with extra segments, and a look-alike such as /api/payroll. All must get 401. SECURITY_GAPS row 3 also names its own test file and wording (the passing guard "everything else under /api still needs the preview password"); please use that test so the gap can be closed against it.
3. **issue (blocking)** PR description, "Approval-only? No": the line is not optional. Any change to src/middleware.ts is auth, and SECURITY_GAPS row 3 marks this fix approval-only. The docs label does not change that. I won't drop the line whoever asks; this PR waits for Aashmiin's click, not the 06:17 gate.
4. **note** README.md:195-196 and CHANGELOG.md:8: the wording is accurate for the narrowed fix (the payer's page and its address check stay open). Keep it once finding 1 is fixed.
5. **praise** The bug is real and worth fixing: without it the payer's look-alike address warning silently fails on a protected preview (SECURITY_GAPS row 3). The narrow fix keeps that benefit.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (no test for what else is let through) 2 n/a 3 ✗ (preview gate opened for every /api/payments route) 4 ✓ (36 lines, but not "docs only") 5 ✓ 6 ✓ 7 approval-only (auth) 8 ✓ 9 ✗ (guard weakened)

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-03 03:50 SGT

*Also in a real run:* Log row "code-reviewer | PR #64 reviewed | BLOCK 215874b | approval-only: yes | blocking: 3 | <comment url>"; a RISK: row "RISK: PR #64 labelled docs and marked not approval-only, but opens the preview password gate for every /api/payments route (prefix exemption); BLOCK posted"; a Log row for qa-security-engineer (owner of SECURITY_GAPS row 3) and a line to tech-lead-architect so it is not taken at the 06:17 gate.
