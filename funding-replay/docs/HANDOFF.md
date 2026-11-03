# Handoff: funding decision replay (3 Nov 2026)

**Synthetic replay — no funds move.** Branch `funding-replay` of `trysarathy/investigation-desk`,
folder `funding-replay/`. Start: `python3 funding-replay/app/server.py`, open http://127.0.0.1:8765.

## Reused
- **Your documents** (in `docs/source/`): the Funding Decision Whitepaper, Founder Decision Memo and
  Two-Week Validation Plan. All numbers, scenarios, the decision rule, the trust boundary and the four
  incidents come from them.
- **Not available to reuse:** the original Funding Replay Experiment (README, `replay.py`, `events.csv`,
  `test_replay.py`, `friday.html`, `demo.html`, `preagreed.html`, `delayed.html`). It was not in the
  uploads, on disk or on any repo branch, so its 22 tests could not be run (0 baseline tests). The
  engine is **reconstructed** from the whitepaper; if you find the zip, swap it in and compare.
- Patterns from the earlier Clearline code (exact decimals, "unknown" on missing evidence, versioned
  evidence), re-implemented in Python. The earlier Clearline projects are untouched (`main` and all other
  branches unchanged); this lives on its own branch.

## Built
- `engine/replay.py`: the decision engine (Python standard library, `Decimal` money). Evidence cutoff at
  each decision time; forecast vs settled vs reserved vs spendable cash; dedup and conflict rejection;
  stale/missing/contradictory evidence → unknown; competing commitments subtracted first; same net amount
  and deadline only; rate sensitivity that can never change a decision.
- `fixtures/`: 8 synthetic scenarios (reference, pre-agreed later slot, forecast customer receipt,
  concurrent payout, short-lived Monday quote, closed business day, Monday capacity check, slow
  beneficiary credit).
- `app/server.py` + `app/static/`: one local workspace (decision → options → evidence), CSV import with
  row-numbered errors that keeps the last good scenario, Reset to sample. The browser only displays what
  the engine returns; it does no money or date arithmetic.
- Tests: 108 engine/server tests and a 100-check browser test (`docs/TEST_RESULTS.md`). Screenshots in
  `docs/screenshots/`. Demo script in `docs/DEMO_SCRIPT.md`.
- Team: one owner built the engine and tests, one built the interface, and a separate challenger
  attacked the integrated result. It found 6 blocking issues (e.g. the hindsight view using evidence
  that arrived later; a Monday view that read as if the payment should be funded twice; an FX move shown
  as a saving). All were fixed with tests and re-checked by the challenger; one remaining minor was then
  fixed (absurd rates are now rejected).

## Only simulated
- Every balance, quote, fee, cutoff, capacity, calendar and timestamp is synthetic. The importer and
  supplier are fictional. No provider's real terms are used.
- The 7.5-hour last-mile bound is simulated; beneficiary credit is never observed.
- The 8% rate is a hypothetical assumption, not a measured cost of funds.
- No bank or provider connection, no instruction, no FX booking, no wallet, no credit. "Next actions" are
  what an operator could do with their own bank or provider; the tool does none of them.
- The economics (SGD 78.77 before subscription) are illustrative arithmetic, not a forecast or a result.

## Before you show it
- Open it on your Mac first and click through the demo script once.
- Show it only after the buyer has walked you through their own last payout.
- Don't call any figure a saving.
