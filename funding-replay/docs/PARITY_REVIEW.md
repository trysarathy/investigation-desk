# Parity review: rebuilt engine vs the supplied original

**Synthetic replay — no funds move.** Review date 3–5 Nov 2026, branch `funding-replay-parity`.

## What was compared
- **Original (reference, unchanged):** `1fb78459-Funding_Replay_Experiment.zip`, SHA-256
  `7cbab786925d105ccd902ded51d6c822fd36653e08444c9838f16db915e24a9d`. It was extracted read-only outside the
  app, to a scratch reference directory. It holds `replay.py` (134 lines), `events.csv`, `test_replay.py` and
  four rendered HTML views. Its own tests: **22 of 22 pass** in this session.
- **Rebuild:** `engine/replay.py`. It was reconstructed first from the whitepaper and memo, and only then
  compared with the original.
- **How:** the harness in `parity/` (`python3 parity/run.py`) takes 19 common scenarios. Each is written once
  as plain economic facts, then translated explicitly into each engine's CSV. Every translation choice is
  printed. Facts that can't be expressed show as "not expressible", and nothing is filled in to force a
  match. Each scenario runs at Fri 13 Nov 15:00, Mon 16 Nov 15:00 and Thu 19 Nov 09:00 SGT, on 14 fields.
  Results are in `parity/RESULTS.md`.
  - **Before fixes:** 637 same, 77 differ, 84 n/a. The n/a cells included a rebuild crash.
  - **Final:** 692 same, 64 differ, 42 n/a.
  - The n/a cells left are fields one engine doesn't produce, plus one scenario the rebuild can't express
    (per-slot delivery bounds).
- **Who:**
  - Two independent analysts, one per engine.
  - One harness owner.
  - One adversarial reviewer, who tried to force a false "safe to wait" and a misleading benefit figure.
  - The lead integrated every change.
- **Agreement:** the engines agree on the reference week:
  - Friday and Monday headroom of SGD 4,627.50 / 4,617.50 on the original's cash facts.
  - Friday decision: keep Friday.
  - Retrospective: 405,000 SGD-days, SGD 88.77, SGD 10.00 extra, SGD 78.77 net.
  - The 24-hour boundary cases, delayed receivable (short SGD 5,382.50), concurrent payout, Tuesday closure,
    low capacity, stale quote and instruction-at-cutoff verdicts.

## Decision-changing differences (resolved in the rebuild)
Each line gives: smallest example → original vs rebuild (before the fix) → cause → could it change a real
decision → what we kept → regression test.

1. **Bank balance age, 24 h vs 96 h.**
   - **Example:** Monday 15:00 slot; the newest balance is Fri 13 Nov 14:00 (73 h old); everything else is
     fresh.
   - **Before:** the original says stale (unknown); the rebuild said Monday feasible.
   - **Cause:** policy.
   - **Decision impact:** yes. It reported feasible cash on a weekend-old balance.
   - **Kept:** 24 h, as a **demo policy**, judged at the slot being judged.
     - The app says "We need a newer bank balance to assess Monday's funding." It shows the balance time, the
       age at the slot, the limit and the next action.
     - Exactly 24 h is accepted; an earlier expiry still applies.
     - An old balance means cash is unknown, not short.
   - **Tests:** `tests/test_parity.py` P1. It covers 24 h exactly, 24 h + 1 min, missing, a fresh Monday
     balance, a Monday-dated balance first known Tuesday, freshness at the slot rather than when retro opens,
     earlier expiry, and rate invariance. The browser tests check the stale-balance screen.
2. **Friday judging Monday's cash.**
   - **Example:** the pre-agreed case.
   - **Before:** the original requires a documented own-cash floor (`own_cash_floor_sgd`) known on Friday. The
     rebuild used Friday's 09:00 balance as Monday cash, which was 78 h old at the Monday slot.
   - **Cause:** code.
   - **Decision impact:** yes. It could make manual review appear on a balance that says nothing about
     Monday.
   - **Kept:** the original's approach. A new `cash_support` record (documented, live at the Monday
     instruction, covering required cash plus the reservation cost) is the only Friday evidence of Monday
     cash. It is stale if a commitment becomes known after it.
   - **Tests:** P2, P5 (M3).
3. **Commitment-list completeness.**
   - **Example:** no attestation that the list of competing commitments is complete.
   - **Before:** the original requires `reservation_snapshot`; the rebuild assumed the list was complete.
   - **Cause:** code.
   - **Decision impact:** yes. A missed payout overstates cash.
   - **Kept:** a `commitment_list` attestation within the same 24 h; a future-dated one is not evidence. A
     commitment due at or before the balance time is treated as already in that balance, so it is not
     deducted twice.
   - **Tests:** P4, P5 (B3).
4. **Lead business days, weekends and closures.**
   - **Example:** Tue 17 Nov is closed (the original's `holiday` case).
   - **Before:** the original says Monday is infeasible (1 open date < 2). The rebuild only read the slot day's
     calendar flag, so Monday was feasible with a SGD 78.77 figure.
   - **Cause:** code.
   - **Decision impact:** yes.
   - **Kept:** the original's rule:
     - It counts open dates after the instruction date through the New York payout date.
     - Weekends and recorded closures don't count.
     - A closed or weekend instruction date or payout date fails.
     - A closure with an empty slot applies to both slots.
   - **Tests:** P3, P5 (M1).
5. **Payout capacity through release.**
   - **Example:** the capacity confirmation expires Mon 16:00, before the Wed 15:00 release.
   - **Before:** the original says insufficient capacity through target; the rebuild accepted it.
   - **Cause:** code and fixture.
   - **Decision impact:** yes.
   - **Kept:** capacity must outlast the release instant. An earlier end is reported as **unknown** (not
     evidenced), where the original says infeasible. That difference is wording only; both withhold.
   - **Tests:** P3, P5.
6. **Exclusive cutoff.**
   - **Example:** instruction at 16:00 with a 16:00 cutoff.
   - **Before:** the original fails it; the rebuild didn't check it, including in retro.
   - **Cause:** code.
   - **Decision impact:** yes.
   - **Kept:** the original's rule, in every view.
   - **Test:** P3.
7. **Fallback quality.**
   - **Before:** the original needs a fallback of at least the USD amount, valid through the deadline. The
     rebuild accepted any documented fallback.
   - **Cause:** code.
   - **Decision impact:** yes, in the Friday manual-review gate.
   - **Kept:** the original's amount and validity rules, plus a requirement that the fallback is in place
     before the slot it protects.
   - **Tests:** P3, P5 (M2).
8. **Friday economic figure.**
   - **Before:** the original never shows a comparison on Friday. The rebuild showed a "conditional"
     SGD 53.77 under manual review.
   - **Cause:** policy.
   - **Decision impact:** a buyer could read it as an available saving.
   - **Kept:** no figure on the Friday screen. The reservation cost appears only as a review question.
   - **Test:** `test_friday_view_never_has_an_economic_figure`.
9. **Late or missing costs.**
   - **Examples:** the reservation fee is invoiced Tuesday; a Monday processing fee is missing; the slots'
     spreads differ.
   - **Before:** the original has no reservation fee and keeps a spread difference in extra fees. The rebuild
     dropped a cost first known after the slot, ignored a missing fee type, and counted a spread difference
     as benefit.
   - **Cause:** code.
   - **Decision impact:** yes, through misleading benefit figures.
   - **Kept:** all three withhold the comparison:
     - a cost first known after its slot;
     - a missing rail or processing fee;
     - a rate or spread that differs between slots.
     A fee restated at the same amount counts once.
   - **Tests:** P3, P5 (B1), `test_restated_identical_fee_is_counted_once`.
10. **Monday checkpoint cash.**
    - **Example:** the Monday slot is set after 15:00.
    - **Before:** the rebuild used the Friday cash attestation.
    - **Cause:** code.
    - **Decision impact:** yes, a false "Monday feasible".
    - **Kept:** forward reasoning is used only in the Friday decision view. The passed Friday slot on the
      Monday screen is shown on Friday's own evidence.
    - **Tests:** P5 (B2) and the harness (`concurrent_payout`).
11. **Robustness.**
    - **Before:** the rebuild crashed when the Monday slot was unknown on Friday. A reconfirmed capacity
      counted as contradictory. The same receipt under two IDs was counted twice.
    - **Cause:** code.
    - **Kept:** all fixed.
    - **Tests:** P5 and the harness (`probe_monday_slot_unknown_friday`).

## Intentionally retained deviations (the original is a reference, not an oracle)
| Difference (harness rows) | Original | Rebuild | Why we keep the rebuild |
|---|---|---|---|
| Friday slot on the Monday screen (18) | Re-judged as feasible/infeasible | "passed" | The Monday screen is a **counterfactual** ("assumes the SGD had been held"). Friday's cutoff has passed; showing it as available invites double funding. |
| Comparison at the Monday checkpoint (6) | Shown once both instruction times have passed (net 78.77) | Only in the retrospective view | Keeps hindsight figures off decision screens. |
| Figures for an unknown slot (31) | Stops at the first missing or stale record and shows no figures | Shows the figures it could work out (required, cutoff) with status unknown | Wording/reporting only: status, decision and comparison agree. |
| Pre-agreed Friday decision (3) | Manual review; the lead-day term is never checked for the forward option | Keep Friday unless Monday's route terms (lead days) are also on record on Friday | Stricter: a binding later slot must include its route terms. The rebuild's own pre-agreed fixture documents them, and its result is manual review. |
| Slow credit, Friday view (2) | Monday "not yet observable" | Monday infeasible: the common 9 h bound is known on Friday | More informative; same decision. |
| Capacity ending before release (2) | infeasible | unknown | Wording: not evidenced rather than proven short; both withhold. |
| Quote expiring exactly at instruction | Accepted (`valid_until >= at`) | Stale | Conservative. |
| Per-slot delivery bounds | Supported | Not expressible (one common bound) | Both slots share the provider release, so the reference case has one bound. Documented gap. |

**Fixture differences, not logic.**
- **Cash:** the original's reference cash is SGD 150,000 settled less SGD 10,000 reserved = 140,000, giving
  headroom 4,627.50 / 4,617.50. The app's reference week is SGD 200,000 less a SGD 50,000 floor = 150,000,
  giving 14,627.50 / 14,617.50.
- **Last-mile bound:** 8 h vs 7.5 h.
- **Fees:** charges are one SGD 35 / 45 fee in the original, and rail 20 + processing 15 / 25 in the rebuild.
  The totals are identical.
- On the same facts the harness shows identical headroom.

**Reservation cost (SGD 25.00).**
- **Who pays and when:** a scenario assumption in the pre-agreed fixture only. The importer pays the provider
  on Friday to hold the Monday terms and capacity.
- **On Friday:** it must be covered by the documented cash support, and it is listed as a review question.
- **Retrospectively:** it is subtracted (net SGD 53.77).
- **Where it does not apply:** it is not in the reference case, and the original does not model it.

## Remaining limits
- Synthetic data only.
- The 24 h limit is a demo policy, not an industry rule. A newer balance is not a guarantee.
- Per-slot delivery bounds can't be expressed.
- Real bank and provider calendars, statement integrity and actual supplier credit are not modelled. A
  provider release is not supplier credit.
