# Code review checklist (any reviewing agent; never the PR's author)

Read the PR description (spec + acceptance criteria), the linked roadmap row, the full diff, and the
tests. Run it yourself in a scratch worktree: `npm ci`, `npx tsc --noEmit`, `npm run lint`,
`npx vitest run`, `npx next build`. Then answer each line; any "no" means CHANGES REQUESTED.

1. **Spec met:** every acceptance criterion has a test, and the test fails without the change (revert
   the src change, run it, restore).
2. **Correct to the cent and the day:** amounts use the decimal helpers (`src/lib/decimal.ts`), never
   floats; dates/times have an explicit timezone; rounding stated.
3. **Read-only and safe:** no keys, signing or wallet writes; no secret in code, logs, tests or the PR;
   inputs validated; no new route without the same auth/demo-mode checks as its neighbours.
4. **Small and focused:** under ~300 changed lines; one concern; no drive-by refactors; no new
   dependency without a one-line reason.
5. **Matches the code around it:** naming, structure, comment density, error handling.
6. **Honest copy:** any user-facing text matches `company/PRODUCT_FACTS.md`; no over-claims
   (`team/CLAIMS_REVIEW.md`).
7. **Approval-only?** If it touches keys, wallets, auth, secrets, permissions, posting to
   Xero/QuickBooks, money amounts, customer data, pricing, production/deploy settings or deletions,
   say so: it must not auto-merge (`company/OPERATING_MODEL.md` §2).
8. **Changelog** entry present, plain English, true.

Post one PR comment: first line `CODE REVIEW: APPROVE <head sha>` or `CODE REVIEW: CHANGES REQUESTED
<head sha>`, then each failing line with file:line and the fix. Never approve your own change.
