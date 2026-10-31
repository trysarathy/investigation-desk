# Code review checklist (any reviewing agent; never the PR's author)

The standard checklist referred to by `company/OPERATING_MODEL.md` §2 item 5 and every engineer's
definition. Normally run by **code-reviewer** (`.claude/agents/code-reviewer.md`, nightly procedure in
`team/playbooks/code-reviewer.md`, reference material in `team/knowledge/code-reviewer/`). Any other
reviewing agent uses the same lines and the same comment format.

**Who may review:** anyone except the PR's author agent and anyone who wrote a commit in it. The reviewer
never writes, commits or pushes code to the PR; the fix goes in the comment as text.

Read the PR description (spec + acceptance criteria), the linked roadmap row, the full diff, every
commit (`pulls/<n>/commits`), and the tests. Run it yourself in a scratch checkout of the **head sha**:
`npm ci`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npx next build`. Then answer each line;
any "no" means CHANGES REQUESTED, or BLOCK where line 3 or 9 says so.

1. **Spec met, tests prove it:** every acceptance criterion has a test, and the test fails without the
   change (revert the src change only, run it, restore: `team/knowledge/code-reviewer/prove-the-test.md`).
   On bug/security branches each `it.fails` case is flipped to `it`, none deleted or loosened.
2. **Correct to the cent and the day:** amounts use the decimal helpers (`src/lib/decimal.ts`,
   `src/lib/payments/money.ts`, `toCents`/`floorCents` in `src/lib/accounting/rules.ts`), never floats;
   the only `Number()` on an amount is the documented provider boundary on a cents string; rounding is
   stated. Dates/times have an explicit timezone; **posting dates are the calendar date in the accounting
   organisation's own timezone** (not UTC, not a hard-coded Singapore; unknown timezone = don't post).
3. **Read-only and safe:** no keys, signing or wallet writes (→ BLOCK); no secret in code, logs, tests,
   fixtures, commit history or the PR (→ BLOCK); inputs validated; no new route without the same
   auth/demo-mode checks as its neighbours (`isDemoMode()` is the one switch); no security test deleted or
   weakened (→ BLOCK). Security pass: `team/knowledge/code-reviewer/security-checklist.md`.
4. **Small and focused:** under ~300 changed lines; one concern; no drive-by refactors; no new
   dependency without a one-line reason; no build output, `.data/`, `.env*`, `.onnx`.
5. **Matches the code around it:** naming, structure, comment density, error handling; reuses existing
   helpers instead of new copies; simplest thing that meets the spec.
6. **Honest copy:** any user-facing text matches `company/PRODUCT_FACTS.md`; no over-claims
   (`team/CLAIMS_REVIEW.md`).
7. **Approval-only?** If it touches keys, wallets, auth, secrets, permissions, posting to
   Xero/QuickBooks, money amounts, customer data, pricing, production/deploy settings or deletions,
   say so with the line `APPROVAL-ONLY: needs Aashmiin's merge`: it must not auto-merge
   (`company/OPERATING_MODEL.md` §2). This line is about who merges, not about quality: it appears with
   any verdict, and is never dropped on request.
8. **Changelog** entry present in `CHANGELOG.md`, plain English, true. PR description states the demo-mode
   and real-mode checks that were run.
9. **No rule broken by the PR itself:** nothing that posts, writes off, refunds or links without a
   person's approval; no guard or required CI check removed; no data deletion without a guard
   (→ BLOCK).

**Post one PR comment per head sha** (`gh api repos/trysarathy/investigation-desk/issues/<n>/comments -X POST`).
First line exactly one of:
- `CODE REVIEW: APPROVE <head sha>`: every line holds; only non-blocking comments remain.
- `CODE REVIEW: CHANGES REQUESTED <head sha>`: a fixable blocking finding.
- `CODE REVIEW: BLOCK <head sha>`: must not merge in any form until a structural problem is fixed
  (secret, custody/signing, posting without approval, weakened security test, removed guard or check).

Then the APPROVAL-ONLY line if it applies, the checks you ran with results, each finding with file:line,
severity (`blocking`/`non-blocking`) and the fix, and the signature `— <reviewer> · <session link> · <SGT time>`.
Exact format: `team/knowledge/code-reviewer/comment-format.md`.

A review counts only for the head sha in its first line: after a new push it no longer counts and the
new sha is reviewed again. BLOCK and CHANGES REQUESTED both stop a merge. GitHub's own approve button is
not used (every agent is the same GitHub account). Never approve your own change.
