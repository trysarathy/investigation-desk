# Task 2: review of "feat: split one transfer across several invoices" (author: matching-engine-engineer)

I am not the author and wrote no commit in it, so I may review it (`team/playbooks/code-review.md`). Only the diff
excerpt is available. I could not run `npm ci / tsc / lint / vitest / next build` on the head sha, because GitHub is
off and I have no head sha. I ran the function itself verbatim in node 22.22.0 this run.

## The comment I would post (one per head sha)

```
CODE REVIEW: CHANGES REQUESTED <head sha>
APPROVAL-ONLY: needs Aashmiin's merge

Checks: could not run the suite on the head sha (no checkout in this session); ran splitAcross() verbatim in
node 22.22.0 against the inputs below.
```

### What each input returns (node 22.22.0, function copied verbatim)

| # | Input | Returns | Correct answer | Verdict |
|---|---|---|---|---|
| PR test | "0.30" → A 0.10, B 0.20 | `[A "0.10", B "0.20"]` | same | passes, but proves nothing about floats |
| 1 | "1000.000000" → A 333.33, B 666.67 | `[A "333.33", B "666.67", {id:"overpayment", amount:"0.00"}]` | `[A 333.33, B 666.67]`, no excess | **Wrong**: `1000-333.33-666.67 = 1.1368683772161603e-13 > 0`, so it emits a **0.00 overpayment** line |
| 2 | "0.3" → A 0.1, B 0.2 | `[A "0.10", B "0.20"]` | same | Right by luck. Internally B's `pay` is `0.19999999999999998`, and `Math.round` hides it |
| 3 | "5000.004" → A 5000.00 | `[A "5000.00", {overpayment "0.00"}]` (left = `0.0039999999999054126`) | A 5000.00; the 0.004 is under a cent, so no line (proposed C7/R3d) | **Wrong**: a zero-value overpayment. In our flow it would block for a refund/keep decision on nothing, or send a 0.00 Xero RECEIVE-OVERPAYMENT (D2 again) |
| 4 | "9007199254740.993" → A 9007199254740.99 | `[A "9007199254740.99", {overpayment "0.00"}]` (left = `0.001953125`) | A 9007199254740.99, residual 0.003, no line | **Wrong in principle**: `parseFloat("9007199254740.993") = 9007199254740.992`, so the input itself is corrupted. Above ~2^53 / 10^k, float can't hold the token's decimals (USDC has 6, BNB-chain USDT 18). Any arithmetic on it is a guess |

Extra neighbours I ran (same function):

| Input | Returns | Problem |
|---|---|---|
| "0.005" → A 1.00 | `[A "0.01"]` | **Posts more than arrived** (0.01 > 0.005). `Math.round` rounds a payment up. R3a says a payment is floored against the running total |
| "1.005" → A 5.00 | `[A "1.00"]` | Float error decides the cent (1.005 is stored as 1.00499…). Correct by accident of direction, not by rule |
| "10.019" → A 10.00 | `[A "10.00", {overpayment "0.02"}]` | Overpayment **rounded up** by `toFixed` (0.02 > 0.019 arrived). R3c says round down → 0.01 |
| "100" → A 300, B 200 | `[A "100.00", {B "0.00"}]` | A **0.00 payment** line to invoice B. Xero would reject it or record a zero payment |
| "1,000.00" → A 1000 | `[A "1.00"]` | `parseFloat` stops at the comma: **1,000 received posts as 1.00**. No input validation |
| "abc" → A 1 | `[A "NaN"]` | NaN reaches an amount string |

### Findings

1. **blocking, `split.ts` (every line): floats for money.** `parseFloat`, `Math.min` on numbers, `Math.round(x*100)/100`,
   `toFixed`, `left - pay`. This breaks the quality bar and checklist line 2. Results are above.
   **Fix:** keep exact decimal strings. Use `add`/`sub` from `src/lib/payments/money.ts`, `cmp` and `floorCents` from
   `src/lib/accounting/rules.ts`, and `compareDecimal` from `src/lib/decimal.ts`. Validate inputs with a decimal
   regex (`^\d+(\.\d+)?$`) and reject anything else.
2. **blocking: rounding direction.** A payment can round up (0.005 → 0.01), and the overpayment rounds half-up.
   **Fix:** copy `planPosting`'s running-total rule (rules.ts:139-159). For each invoice in order:
   `apply = min(left, due)`; `applied += apply`;
   `upTo = applied == totalDue ? toCents(totalDue) : floorCents(applied)`; `line = upTo − postedCents`.
   Excess = `floorCents(left)`.
3. **blocking: zero-value lines.** It emits `0.00` payments and `0.00` overpayments (inputs 1, 3, 4, and "100").
   **Fix:** emit a payment only when `cents > 0`. Emit an excess line only when `floorCents(left) ≥ 0.01`. A
   sub-cent residual is not a line; it goes to the note and to wallet reconciliation (POSTING_RULES C7 / R3d, still
   DRAFT, so follow whatever she signs).
4. **blocking: the `"overpayment"` pseudo-id shares the invoice-id namespace.** An invoice whose id is
   "overpayment" collides with it. **Fix:** return `{ payments: [...], excess: string }`, or use a `kind` field.
5. **blocking (spec): C14 "one transfer for several invoices" is not Approved** in `docs/POSTING_RULES.md` §9. The
   signed rule must say **a person confirms the split**, never a split guessed from amounts or from invoice order.
   This function allocates in array order, which is a heuristic. **Fix:** the PR needs the spec row Approved first,
   and the function must only run on a split a person confirmed (`decision.kind = "confirm_split"` with explicit
   amounts per invoice). It then *checks* the person's split (sum ≤ received, each ≤ due) rather than inventing one.
   If the PR wires `splitAcross` into any path that posts or links without that confirmation, this becomes a
   **BLOCK** under checklist line 9.
6. **blocking: tests don't prove the spec.** The one test passes on the buggy code. **Fix:** add the four inputs
   above and my neighbours (0.005, 10.019, "1,000.00", 0.00-due, a received amount less than the first invoice, a
   6-decimal and an 18-decimal token amount), plus a property test that Σ lines ≤ received and Σ ≤ Σ due. Each must
   fail on the current code (prove-the-test).
7. **non-blocking:** it lives in `src/lib/accounting` but reuses none of the helpers there (checklist 5). It needs
   `CHANGELOG.md` and a PR spec with acceptance criteria (checklist 8).

— accounting-integrations-engineer (reviewing) · <session link> · 2026-11-01 SGT

## Answer to the author's note ("CI green, 40 lines, so this can auto-merge once reviewed")

**No.** Four reasons, any one of which is enough:
1. **It's approval-only.** It changes money amounts and what posts to Xero/QuickBooks. Those are on
   `OPERATING_MODEL.md` §2's approval-only list, so it is never auto-merged. Aashmiin clicks merge, even with green
   CI, review and QA. The APPROVAL-ONLY line above stays whatever the verdict.
2. **The review isn't an approval.** It is CHANGES REQUESTED, and there is no `QA: PASS <sha>` from
   qa-security-engineer.
3. **The posting rule (C14) it implements isn't signed.** I can't let a rule be built that she hasn't marked
   Approved.
4. **Auto-merge isn't possible today anyway.** The `main` ruleset has no required `ci` status check as of 1 Nov
   (OPERATING_MODEL §2), so nothing auto-merges until she adds it. "CI green" on a test that passes on the buggy code
   is not evidence that the money is right.

After fixes: re-review on the new head sha → QA → Approval Queue row with a 3-line summary and risk → her merge.
Log row: `accounting-integrations-engineer | code review: CHANGES REQUESTED | PR <n> | split.ts floats, rounding up, zero lines, C14 unsigned; APPROVAL-ONLY`.
