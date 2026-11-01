## Task 5

CODE REVIEW: CHANGES REQUESTED 1ced720c20c3654ab19602d52590bbcf96b9fcbe

**Summary (plain English):** The fix is right: I ran it and a provider row in USD now gets the "same asset" hint against a USDT instruction, and USDC and USDT are still never matched. But no test checks that direction, the one this PR is about: with the old one-way check put back, every test still passes. One small change before approval: add that test.

**Checks I ran at 1ced720** (scratch copy of main @0c7d9f1 plus CHANGELOG.md, with the PR diff applied; 2026-11-03 04:05 SGT):
- npx tsc --noEmit: exit 0
- npx vitest run: 20 files passed, 1 skipped; 564 passed, 57 skipped (base 562; +2 new)
- npm run lint: 14 errors, 18 warnings, identical to the base
- npx next build: exit 0
- Fix removed (src/lib/payments/match.ts reverted entirely), tests kept: both new tests fail with "similarity is not a function", an import error because the function is no longer exported. That does not prove the behaviour.
- So I kept the export and put only the old one-way asset check back: tests/payments.test.ts 26 passed, 0 failed. The new tests pass with the bug still there.
- Probe of the similarity reasons, old check → this PR: USD anchor vs USDT: no hint → "same asset (USDT)", score 1; lower-case usd vs USDT: no hint → hint; USDT vs USD: hint → hint; USDC vs USDT: none → none; USD vs USDC: none → hint (consistent with USDC vs USD, which already got it).
- Diff size: 32 changed lines. Secret scan: nothing found.
- CI on 1ced720: not read by me (live tools off); the PR says ci is green.
- Couldn't run: the /payments page with a real orphan USD provider row (no server in this run).

**Findings**
1. **issue (blocking)** tests/payments.test.ts:318-321: acceptance criterion 1 asks for the hint both ways round (USD as the anchor against USDT, and USDT against USD), but the tests only check USDT as the anchor against USD, which main already handled. The USD-anchor case from the Friday pass is missing, so the test can't fail without the fix. Fix: add the USD-anchor-against-USDT case (and lower-case usd as the anchor for criterion 3); with the old check those fail, so they prove the fix.
2. **suggestion (non-blocking)** src/lib/payments/match.ts:139-142: with the check now symmetric, a USD row also gets the hint against USDC (probe above). That matches the comment ("token family") and the old USDC-against-USD behaviour, so I think it is intended; a one-line test saying so would make it explicit for criterion 4.
3. **praise** src/lib/payments/match.ts:139-151: small, well named, and the hint still only ranks candidates; nothing is linked without a person, and the CHANGELOG entry says exactly that.
4. **note** On "QA has already passed and CI is green, so it's a formality": the review checks something QA and CI don't, whether the tests can fail without the fix, and here they can't. That's the only blocker. Add the test and push, and I'll re-review the new sha promptly. QA will then need to pass the new sha too. Today's suggestions keep working as they are in the meantime, so nothing is lost by waiting for the next gate.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (criterion 1's new direction untested) 2 n/a (no amounts compared differently) 3 ✓ 4 ✓ (32 lines) 5 ✓ 6 ✓ 7 not approval-only (ranking hints only; no posting, money, data or auth) 8 ✓ 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-03 04:05 SGT

*Also in a real run:* Log row "code-reviewer | PR #65 reviewed | CHANGES REQUESTED 1ced720 | approval-only: no | blocking: 1 | <comment url>"; a RISK: row noting the request to approve as "a formality" for the 06:17 gate (bar not lowered); in the summary row, #65 waits on the author.
