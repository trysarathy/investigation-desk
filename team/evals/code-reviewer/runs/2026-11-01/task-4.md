# Task 4: PR #909, sub-cent rounding write-off

Authorship check: 1 commit by matching-engine-engineer; nothing names code-reviewer or my session. I may
review it. CI green and "the first test fails on main" are the author's claims; I checked both myself.

## 1. The comment I would post (`gh api repos/trysarathy/investigation-desk/issues/909/comments -X POST -F body=@$SP/cr-2026-11-01/pr-909-cfce722.md`)

```
CODE REVIEW: BLOCK cfce72293072080c6b4c5fbd01e59d36ccc7c127
APPROVAL-ONLY: needs Aashmiin's merge (posting rules to Xero/QuickBooks, money amounts)

**Summary (plain English):** This PR writes off small shortfalls in the books with no person deciding, which
our rules don't allow without Aashmiin changing them. It also does the sums with floating-point numbers, so it
posts a write-off of "0.00" (the invoice in Xero stays open by 1 cent while Clearline says it closed), and the
same half-cent is treated differently at 1,000 and at 100,000. Must change: Aashmiin decides whether a
rounding write-off without a person is allowed at all; if yes, it needs exact decimal maths and lines that add
up to the invoice.

**Checks I ran at cfce722** (scratch checkout of `main` @ 0c7d9f1 with the PR diff applied; node_modules
symlinked from a main checkout after confirming `package-lock.json` is byte-identical; 2026-11-01 ~03:40 SGT):
- `npx tsc --noEmit`: exit 0
- `npm run lint`: 14 errors, 18 warnings, same counts as on `main` @ 0c7d9f1 with the fix removed → no new errors
- `npx vitest run`: 21 files passed, 1 skipped; 564 passed, 57 skipped (matches the PR description)
- `npx next build`: exit 0
- Fix removed (`src/lib/accounting/rules.ts` reverted), tests kept: `tests/accounting-rounding.test.ts` test 1
  failed (`expected true to be false` on `leavesOpen`), test 2 passed → the author's "fails on main" is
  true for test 1; test 2 passes both ways (a regression guard, fine). But test 1 checks only status,
  `leavesOpen` and the word "rounding", **not the amounts**, so it passes with the 0.00 write-off below.
- Probe, `planPosting` on invoice → payment (lines shown as [kind, amount]):
  - 1000.00 ← 999.999: `[payment 999.99] [fee_writeoff 0.00]`, `leavesOpen: false`, reason "Short by less than
    half a cent (0.0009999999999763531 USDC) … the invoice closes"
  - 1000.00 ← 999.995 (short exactly 0.005): `[payment 999.99] [fee_writeoff 0.00]`, written off (float 0.0049999999999954525)
  - 100000.00 ← 99999.995 (short exactly 0.005): `[payment 99999.99] [note 0]`, `leavesOpen: true`, waits for a person
  - 100000.00 ← 99999.996: `[payment 99999.99] [fee_writeoff 0.00]` (float 0.004000000000814907)
  - 1000.00 ← 999.99 (short 1 cent): `[payment 999.99] [note 0]`, waits (correct)
- CI on cfce722: `ci` success (as reported in the PR; my run agrees)
- Size: +54/−1, 2 files: fine.
- Couldn't run: nothing else; no real Xero (n/a for a rules change, but see finding 2 on what Xero would show).

**Findings**
1. **issue (blocking)** `src/lib/accounting/rules.ts:175-181`: a `fee_writeoff` is posted with **no person's
   decision**. Today a shortfall posts as a partial payment plus a note until a person chooses `accept_short`
   or `request_balance` (`rules.ts:182-197`); this branch skips that for any shortfall up to 0.005. Writing
   off without a person's approval is a change to the posting rules, not a bug fix, and our checklist
   (line 9) blocks it until Aashmiin decides the policy and it has a spec row she has approved. If she says
   yes, the fix below applies; if not, a better fix for the roadmap row is to keep the decision but make it
   one click ("Accept rounding of 0.001").
2. **issue (blocking)** `src/lib/accounting/rules.ts:178`: `shortBy.toFixed(2)` turns every sub-cent shortfall
   into `"0.00"`. So for 1000.00 ← 999.999 the books get a payment of 999.99 plus a write-off of 0.00 =
   999.99, and the Xero invoice stays open by 0.01, while the plan says `leavesOpen: false` and "the invoice
   closes". A 0.00 credit note is also noise in the customer's books. Fix: the write-off is what the books
   still show as due: `sub(toCents(r.amount), <sum of posted payment cents>)` (here `"0.01"`), so
   `sum(payment lines) + fee_writeoff = r.amount` to the cent, with a test asserting the amounts.
3. **issue (blocking)** `src/lib/accounting/rules.ts:31,174-175`: `Number(r.amount) - Number(received)` and a
   numeric `SUB_CENT_TOLERANCE = 0.005` put floats on amounts. Same 0.005 shortfall, two magnitudes, two
   outcomes (probe above: written off at 1,000, left for a person at 100,000). The `Number()` boundary is
   only allowed in the Xero/QuickBooks adapters on a cents string. Fix: use the `shortfall` already computed
   at :173 with `sub`, compare with `cmp(shortfall, SUB_CENT_TOLERANCE) < 0`, and make the tolerance a string
   like `DEPEG_LIMIT` (`"0.005"`).
4. **issue (blocking)** `src/lib/accounting/rules.ts:175`: `<=` includes exactly half a cent, but the spec and
   the constant's comment say "**under** half a cent". Fix: strict `< 0`, and a test at exactly `0.005`
   (expect: waits for a person) and at `0.004999` (expect: rounding), at both 1,000 and 100,000.
5. **issue (blocking)** `src/lib/accounting/rules.ts:179,181`: the description and reason print the raw float
   (`0.0009999999999763531 USDC`). This text goes to the books and the audit trail. Fix: `formatUsdc(shortfall)`
   as the neighbouring branches do.
6. **issue (blocking)** `tests/accounting-rounding.test.ts:30-36`: the test doesn't assert line kinds or
   amounts, which is why findings 2-4 pass. Fix: assert `plan.lines` equals
   `[["payment","999.99"],["fee_writeoff","0.01"]]` and that the line amounts sum to `"1000.00"`; add the
   boundary and large-amount cases in 4.
7. **issue (blocking)** `CHANGELOG.md`: the description quotes an entry ("…now close automatically") but the
   diff has no CHANGELOG change (2 files: rules.ts and the test). It's also an over-claim as written
   ("automatically", and they don't close: finding 2). Fix: add a true entry once the policy is decided.
8. **note** The `fee_writeoff` dust branch runs before `has("request_balance")` is looked at, so a person who
   already asked the customer for the balance would be overridden. Whatever policy is chosen, a recorded
   person decision should win.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (test doesn't prove the amounts) 2 ✗ (floats, 0.00 write-off,
lines don't add up) 3 ✓ 4 ✓ 5 ✗ (re-implements arithmetic the helpers already do) 6 ✗ (CHANGELOG claim)
7 approval-only (posting rules, money) 8 ✗ (CHANGELOG missing) 9 ✗ (writes off without a person → BLOCK)

This BLOCK lifts when Aashmiin has decided the write-off policy (Approval Queue) and the PR follows it; I'll
re-review the new sha as soon as it's pushed.

— code-reviewer · https://claude.ai/code/session_01BBB · 2026-11-01 03:45 SGT
```

## 2. Commands run and results (scratch dir `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/t4`, deleted afterwards)
- `git clone --shared /home/user/ai-team t4`; fetched `origin/main`, detached → `0c7d9f130e311928a0fef177300abb1275c74851` (matches the fixture's base).
- `package-lock.json` md5 `aced0278564e5cff6e1dcba660057b3b` = main-ro → `node_modules` symlinked.
- `git apply t4-pr-909.diff` → `rules.ts` modified, `tests/accounting-rounding.test.ts` added.
- `npx tsc --noEmit` → 0. `npx vitest run` → `Test Files 21 passed | 1 skipped (22)`, `Tests 564 passed | 57 skipped (621)`. `npx next build` → 0.
- `npm run lint` → `✖ 32 problems (14 errors, 18 warnings)` at head and the same with the fix removed.
- Fix removed (`git diff -- src | git apply -R`) → `npx vitest run tests/accounting-rounding.test.ts` → `1 failed | 1 passed`; failure `AssertionError: expected true to be false` (test 1, `leavesOpen`). Restored.
- Probe test (deleted after): results quoted in the comment.
- Read `rules.ts` :40-61 (`floorCents`, `toCents`) and :135-215 (payment lines, short/over branches).

## 3. Log rows
| Timestamp (SGT) | Agent | Action | IDs | Details |
|---|---|---|---|---|
| 2026-11-01 03:45 | code-reviewer | PR #909 reviewed | BLOCK cfce722 | approval-only: yes (posting rules, money amounts) · blocking: 7 · <comment url> · writes off shortfalls ≤ 0.005 with no person decision; float maths posts a 0.00 write-off and leaves the Xero invoice 0.01 open |
| 2026-11-01 03:45 | code-reviewer | RISK flagged | PR #909 · cfce722 | RISK: PR #909 adds an automatic fee write-off with no person's decision (changes posting rules). BLOCK posted. Needs Aashmiin's decision on a rounding write-off policy before it can go ahead (Approval Queue: "Allow automatic write-off of sub-cent USDC shortfalls? Risk: books written off without a person; current PR also posts 0.00 and leaves invoices 0.01 open."). |
