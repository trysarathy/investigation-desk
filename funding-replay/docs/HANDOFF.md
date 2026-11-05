# Handoff: funding decision replay (updated 5 Nov 2026 after the parity review)

**Synthetic replay — no funds move.** Branch `funding-replay-parity` of `trysarathy/investigation-desk`,
folder `funding-replay/` (draft PR, not merged). Start: `python3 funding-replay/app/server.py`, then open
http://127.0.0.1:8765.

## How the engine came to be
1. **Reconstructed first.** In the first build session the original experiment wasn't available, so the
   engine was rebuilt from the Funding Decision Whitepaper, the Founder Decision Memo and the Two-Week
   Validation Plan (`docs/source/`).
2. **Compared with the supplied original afterwards.** You then supplied
   `1fb78459-Funding_Replay_Experiment.zip` (SHA-256
   `7cbab786925d105ccd902ded51d6c822fd36653e08444c9838f16db915e24a9d`). It was extracted read-only outside the
   app, and its 22 tests pass.
   - The harness in `parity/` translates the same 19 scenarios into both engines' formats and compares the
     answers a treasurer cares about.
   - Decision-changing differences were fixed in the rebuild. The main one: a bank balance more than 24 h old
     at the slot is now stale, as a demo policy.
   - Deliberate deviations are kept and explained in `docs/PARITY_REVIEW.md`.
3. **Independent review.** Two analysts (one per engine), one harness owner and one adversarial reviewer
   worked independently. The lead integrated every change.

## What changed for the person using the app
- **Old balances.** The Monday checkpoint (and any slot) now asks for a newer bank balance when the newest one
  is more than 24 h old at the funding slot. Example: "We need a newer bank balance to assess Monday's
  funding." The screen shows the balance time, the 73 h age, the 24 h limit and the next action. It never
  shows green and never says the account is short. New scenario: **Friday-afternoon balance**.
- **No benefit figure on Friday.** The Friday screen never shows a modelled benefit, even in the pre-agreed
  case, which stays **Manual review before waiting**. Its questions include the reservation cost.
- **Stricter checks for waiting, as in the original:**
  - documented cash support for Monday;
  - an attested-complete commitment list;
  - an exclusive cutoff;
  - enough open business dates, with weekends and closures excluded;
  - capacity confirmed through release;
  - a fallback covering the USD amount through the deadline;
  - a complete fee schedule.
- **Retrospective comparison.** It is now withheld when a cost was first known late, or when the two slots'
  rates or spreads differ.

## Built and reused
- **Reused:**
  - your documents;
  - the original's rules (24 h freshness, own-cash floor, reservation snapshot, lead days, capacity through
    release, fallback cover, exclusive cutoff);
  - patterns from the earlier Clearline code.
  The earlier Clearline projects are untouched.
- **Built:**
  - `engine/replay.py`, in standard-library Python with exact decimals;
  - 9 synthetic fixtures;
  - `app/server.py` and the workspace in `app/static/`;
  - `parity/` (the comparison harness).
- **Tests:**
  - 139 engine and server tests, 123 browser checks and the harness (`docs/TEST_RESULTS.md`);
  - screenshots in `docs/screenshots/`;
  - the demo script in `docs/DEMO_SCRIPT.md`.

## Only simulated
- **Data:** every balance, quote, fee, cutoff, capacity, calendar and timestamp is synthetic. The importer and
  supplier are fictional.
- **Assumptions:**
  - The 24 h balance limit is a demo policy, not an industry rule. A newer balance is not a guarantee.
  - The last-mile bound is simulated, and beneficiary credit is never observed.
  - Provider release is not supplier credit.
  - The 8% rate is an assumption. SGD 78.77 is illustrative hindsight arithmetic, not a saving.
- **Out of scope:** no bank or provider connection, no instruction, no FX booking, no wallet, no credit.

## Before you show it
- Click through `docs/DEMO_SCRIPT.md` once on your Mac.
- Show it only after the buyer has walked you through their own last payout.
- Don't call any figure a saving.
