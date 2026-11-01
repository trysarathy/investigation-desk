CODE REVIEW: CHANGES REQUESTED a71e2d9c04b38f5e6a1d27c9b0e4f3a85d6c2b19
APPROVAL-ONLY: needs Aashmiin's merge (posting rules for Xero/QuickBooks, money amounts)

**Summary (plain English):** This changes how payment amounts are rounded when an invoice is paid in several transfers. As written, the books can show more money received than actually arrived: two transfers of 333.335 post as 666.68 when 666.67 arrived. An invoice paid exactly in three transfers can be left open by 1 cent. And an invoice paid exactly in two large transfers fails to post halfway through. The existing test that guarded "never more than arrived" was changed to expect the wrong total. This can't be approved tonight, and "approve now, fix tomorrow" doesn't apply: these are blocking defects in the amounts, not polish.

**Checks I ran at a71e2d9** (scratch copy of `main` @ `0c7d9f1` + repo `CHANGELOG.md` + `t2.diff` applied, 2026-11-01 ~04:58 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 20 files passed, 1 skipped; 563 passed, 57 skipped
- `npx next build`: exit 0 · `npm run lint`: same problem list as base, none in changed files
- Fix removed, tests kept (`src/lib/accounting/rules.ts` reverted): `tests/accounting.test.ts` → 1 failed, 23 passed.
  - The only failure is the edited test: `expected [ '333.33', '333.34' ] to deeply equal [ '333.34', '333.34' ]`.
  - The **new** test ("two partial payments … 250.10 + 249.90") **passes with the fix removed**. Those amounts need no rounding, so it doesn't test the change.
- Probes with planPosting and the demo books (temporary probe test, deleted after). Head vs `main`:

| Invoice · transfers | This PR: payment lines (sum) → books | `main` today |
|---|---|---|
| 1000.00 · 333.335 + 333.335 (partial, 666.67 arrived) | 333.34 + 333.34 = **666.68** → invoice due 333.32 | 333.33 + 333.34 = 666.67 → due 333.33 |
| 1000.00 · 333.333 + 333.333 + 333.334 (exact) | 333.33 ×3 = **999.99** → invoice **stays AUTHORISED, 0.01 due** | 333.33 + 333.33 + 333.34 = 1000.00 → PAID |
| 100000.01 · 50000.005 ×2 (exact) | 50000.01 ×2 = **100000.02** → `Posting failed: 50000.01 is more than the 50000.00 due on INV-R1.` with the first line already posted (partial post) | 50000.00 + 50000.01 → PAID |
| 1000.00 · 333.335 ×3 (overpaid by 0.005) | 333.34 + 333.34 + 333.33 = **1000.01** on a 1000.00 invoice | 1000.00 |
| 999.995 · one transfer | 1000.00 → PAID (unchanged) | same |

- CI on a71e2d9: I could not read check-runs (live tools off). The description says green, and my runs agree.
- Couldn't run: the real-mode Xero Demo Company check (the description says it wasn't run either).

**Findings**
1. **issue (blocking)** `src/lib/accounting/rules.ts:148` (`const cents = toCents(apply)`): rounding each line half-up on its own breaks the posting invariant. A posted payment must never be more than what arrived, and an exactly paid invoice must close to the cent [VERIFIED: code-reviewer 2026-11-01, `floorCents` doc comment at `rules.ts:43` on `main` @ 0c7d9f1: "a posted payment must never be more than what arrived"]. The table shows all three ways it breaks: over-posting (666.68 for 666.67), a fully paid invoice left open by 0.01, and a failed partial post on an exact payment. In real Xero, the last case means one payment lands and the second is refused. Someone then has to clean up the books by hand.
   Fix: keep the running-total method on `main` (lines rounded down, with the last line closing the invoice). To meet the controller's need to tick each line against its transfer, put the transfer's exact amount in the line. `description` already carries `333.335 USDC … USD value 333.33`; if ticking needs more, add the token amount to the Xero reference too. If the team still wants per-transfer half-up rounding, that is a posting-rule decision for Aashmiin, and it needs a rule for the cent difference (e.g. a rounding line to a named account) before it can be coded.
2. **issue (blocking)** `tests/accounting.test.ts:261-266`: the test that guarded the invariant ("payment lines never add up to more than arrived") was renamed, and its assertion changed to expect `["333.34", "333.34"]`. The comment on `main`, `// 666.67 posted for 666.67 received`, was the point of that test. Changing it to accept 666.68 hides the defect instead of testing the change. Fix: keep the original assertion. Add tests for the three-transfer exact case (333.333/333.333/333.334 → sums to 1000.00 and PAID) and a ≥ 100,000.00 two-transfer exact case.
3. **issue (blocking)** `tests/accounting.test.ts:272` (new test): 250.10 + 249.90 needs no rounding, so it passes with or without the change. It doesn't prove AC 3. Fix: use 6-decimal amounts (e.g. 250.105 + 249.895 on 500.00) and assert the lines sum to exactly 500.00 and the demo invoice is PAID.
4. **issue (blocking)** `CHANGELOG.md:12`: "Each payment is now that transfer's own value rounded to the cent" isn't true for the last line, which is capped at what's left on the invoice. The entry also doesn't say that totals can now differ from what arrived. Fix: rewrite it once the rule is settled (finding 1).
5. **note (non-blocking, not from this PR)** `rules.ts:200`: an overpayment of 0.005 posts an `overpayment` line of `"0.00"` (case 4 in the table, on `main` too). It's a zero line that clutters the books. I'll log it for the owner, but it isn't for this PR.
6. **note (non-blocking, not from this PR)** `rules.ts:137` `day()` is still the UTC date. That is the posting-date bug tracked separately (`bug/xero-posting-date-timezone`).

**About "approve now and fix after" (23:05 comment):** Approval-only means Aashmiin clicks merge. It doesn't mean she re-reviews the rounding. My APPROVE is what tells her the amounts are right, so I can't give it while they aren't. For the Friday re-run, `main` already posts amounts that add up and close the invoice. The run can go ahead on `main`, and the controller can tick each line against the token amount already in its description. I'll re-review the new sha as soon as it's pushed.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (test weakened; new test passes both ways) 2 ✗ (over-posts, leaves exact invoices open) 3 ✓ 4 ✓ (33 lines) 5 ✓ 6 ✗ (CHANGELOG claim) 7 approval-only (posting, money) 8 ✗ (CHANGELOG untrue) 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-01 04:58 SGT

---
Also: Log row `code-reviewer | PR #64 reviewed | CHANGES REQUESTED a71e2d9 | approval-only: yes | blocking: 4 | <comment url>`; summary line for chief-of-staff: "#64 waiting on author: per-line rounding over-posts and leaves exact invoices open; Friday re-run can use main"; Log row for the owner of rules.ts about the `0.00` overpayment line (pre-existing).
