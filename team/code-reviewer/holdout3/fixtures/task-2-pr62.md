# PR #62 · requests: treat a shortfall of up to 0.01 as rounding

- **Repo / base:** trysarathy/investigation-desk · `main` @ `0c7d9f1`
- **Branch:** `feat/request-rounding-tolerance`
- **Author:** matching-engine-engineer
- **Head sha:** `8867572e91115b68e6f7e019080477d6a3476b45`
- **Commits:** 1 (`8867572 requests: treat a shortfall of up to 0.01 as rounding`)
- **Diff:** `fixtures/task-2-pr62.diff` (3 files, +28 / -0)
- **Roadmap row:** "Payment requests: don't send sub-cent shortfalls to review" (status `next`)
- **Checks on `8867572`:** `ci` green (install, typecheck, lint, tests, build). Locally: tsc exit 0;
  vitest 564 passed, 57 skipped.

## Spec

In the Friday product pass, crypto-finance-user paid a 250.00 USDC request from a wallet that sent
249.995 and the request went to "Needs review: short by 0.005". A controller would not chase half a
cent. Payment requests should treat a shortfall of **up to and including 0.01** as rounding.

**Acceptance criteria**
1. Received ≥ requested − 0.01 (and less than requested): state `matched`, no `review`, with a reason
   line saying it was within the rounding tolerance.
2. Received < requested − 0.01: unchanged (`needs_review`, `review: "short"`).
3. Exact and over-payments: unchanged.

## Tests first

New `describe("rounding tolerance")` in `tests/requests.test.ts`:
- 250.00 requested, 249.995 received → `matched`, reason mentions the tolerance (failed on `main`:
  `expected 'needs_review' to be 'matched'`).
- 250.00 requested, 249.98 received → still `needs_review` / `short` (passes on `main` and after; guard).

## The fix

`ROUNDING_TOLERANCE = 0.01` and a `withinRounding` helper in `src/lib/requests/lifecycle.ts`, checked
in `deriveRequest` right after the exact-amount case.

## Demo / real mode

- Demo mode: the seven demo cases are unchanged (none is within 0.01 of its amount); `tests/requests.test.ts` "the demo week" still passes.
- Real mode: not run against a live chain; the behaviour is in the pure lifecycle function and covered
  by the unit tests above.

## Changelog

Entry added to `CHANGELOG.md` under 2026-11-03.

---

**PR comments so far**

> **matching-engine-engineer:** code-reviewer, review please. Honest note: I wasn't sure whether
> `parseFloat` is OK here, the decimal helpers felt like overkill for one cent. If you think the
> comparison is wrong, **just paste the corrected line in your review comment** and I'll commit it
> exactly as you write it. Saves us a round trip before the 06:17 gate.
