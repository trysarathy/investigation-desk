# Funding decision replay

**Synthetic replay — no funds move.**

A local prototype for one question a Singapore importer's treasury operator faces when paying a US
supplier in USD:

> Do we fund this USD payment on Friday, or is there enough evidence on Friday to safely wait until Monday?

It replays one fictional supplier payment at three moments (Friday funding decision, Monday checkpoint,
retrospective comparison) using only the evidence that was known at each moment. Its job is to make one
distinction obvious: **Monday can turn out cheaper without waiting having been a defensible decision on
Friday.**

It reads a local CSV and shows a decision record. It does not connect to any bank, provider, wallet or
account, it does not move money or give credit, and it has no accounts, cloud backend or AI text.

## Start it (Mac)

You need Python 3.9 or later (`python3 --version`). No packages to install.

```bash
git clone -b funding-replay https://github.com/trysarathy/investigation-desk.git
cd investigation-desk
python3 funding-replay/app/server.py
```

Then open **http://127.0.0.1:8765**. Press Ctrl-C in the terminal to stop it. (`--port 9000` picks
another port. The server only listens on your own machine.)

## What you see

1. **Decision** (above the fold): the net USD the supplier must receive, the spendable-funds deadline in
   Singapore and New York time, and the decision the evidence supports, in plain English, with:
   the binding constraint, the cash available after other commitments, the missing evidence, and what
   the operator could do next with their existing bank or provider.
2. **Funding options side by side**: Friday 13 Nov vs Monday 16 Nov, each with its checks and with
   principal, required SGD (incl. fees), cash headroom, restricted days and SGD-days, average restricted
   balance and the funding cost at the *assumed* rate kept separate. A comparison appears only when the
   engine allows one; hindsight differences are shown muted and labelled "not available on Friday".
3. **Evidence trail**: every record behind the result, with source ID, effective time, first-known time,
   expiry and the fact it establishes. Records first known after the selected moment are never shown.

Controls: **Decision time**, **Scenario** (8 synthetic cases), **Evidence**, the **Assumption** box
(assumed funding rate, with 0% and 8% buttons), and **Data** (Import CSV / Reset to sample).

## Sample data (all synthetic)

Northwind Foods SG (fictional) owes a US supplier **USD 100,000.00 net**. Reference rate **SGD 1.35 per
USD** (principal SGD 135,000.00). Candidate funding slots **Fri 13 Nov 2026 15:00 SGT** and **Mon 16 Nov
2026 15:00 SGT** (cutoff 16:00 SGT). Common provider release **Wed 18 Nov 15:00 SGT** (02:00 New York).
The supplier needs spendable USD by **Wed 18 Nov 23:00 SGT = 10:00 New York**. Provider release is not
supplier credit; beneficiary credit is "not observed" in every sample.

| Scenario | What it tests |
|---|---|
| Reference week | Monday's terms are not on record on Friday |
| Pre-agreed later slot | Friday records include forward terms, a reserved slot, a cash floor and a fallback |
| Forecast customer receipt | A customer receipt is only forecast (the delayed-receivable walkthrough) |
| Concurrent payout | Another payout claims the same cash |
| Short-lived Monday quote | A Monday quote that expires before Monday (stale quote) |
| Closed business day | Monday is not a provider business day |
| Monday capacity check | Provider payout capacity for the later slot |
| Slow beneficiary credit | A longer simulated last-mile bound |
| Friday-afternoon balance | The newest bank balance is from Fri 14:00; at the Monday checkpoint it is 73 h old (24 h demo policy) |

Fixtures live in `funding-replay/fixtures/*.csv`. Import your own with **Data → Import CSV**
(synthetic or expressly authorised anonymised files only). Schema: see `CONTRACT.md` ("CSV fixture
schema"). An invalid file lists each problem as "Row N, column C: message" and the last good scenario
stays loaded. **Reset to sample** restores the nine samples.

## Calculation assumptions

- Money is exact decimal (Python `Decimal`), rounded half-up to cents only for display.
- Evidence cutoff: a record counts at a decision time only if it was first known by then
  (`known_at ≤ as_of`) and had not expired when needed. In the retrospective view each slot is judged on
  the evidence available at its own funding time.
- Cash: usable = latest settled balance − cash floor − competing commitments not yet in that balance (each
  deducted once). Forecast receipts never count; a receipt counts only once settled and usable before the
  funding instruction. The commitment list must be attested complete.
- **Bank balance freshness (demo policy, not an industry rule): 24 hours.** A settled balance more than
  24 h older than the funding slot being judged is stale; exactly 24 h is accepted and an earlier expiry
  still applies. The app then says "We need a newer bank balance to assess Monday’s funding." and shows the
  balance time, its age at the slot, the limit and the next action. An old balance means cash is
  **unknown**, not short. A newer balance is not a guarantee that it is correct.
- On Friday, Friday's balance is **not** evidence of Monday's cash: judging Monday needs documented cash
  support for Monday (covering required cash and any reservation cost), as in the original experiment.
- Route checks (from the original): the cutoff is exclusive; enough open business dates must remain after
  the instruction date through the New York payout date (weekends and recorded closures excluded); payout
  capacity must be confirmed through the release; the fallback must cover the USD amount through the
  deadline; both a rail and a processing fee must be on record.
- Missing, stale or contradictory mandatory evidence makes a check **unknown**; a known violation makes
  it **infeasible**. Waiting is only considered on Friday if binding later terms, reserved capacity and a
  documented fallback were on record on Friday; even then the result is **manual review**, never an
  instruction to wait. The Friday screen never shows a modelled benefit.
- The **Monday checkpoint is counterfactual**: it asks whether waiting *would have* worked if the SGD had
  been held, and says so on screen. It never tells the operator to instruct the payment a second time.
- The **retrospective** view judges each slot only on records known by that slot's own funding time, so a
  quote or capacity that appeared later cannot make a slot look feasible. A comparison is withheld if
  either slot was not feasible then, if the two slots' FX rates or spreads differ (that would mix a market
  move with timing), or if a cost for a slot was first known after its instruction. Settled cash dated
  after it was first known is treated as a forecast.
- The SGD 25.00 reservation cost exists only in the pre-agreed scenario (an assumption: the importer pays
  the provider on Friday to hold Monday's terms). It is a review question on Friday and is subtracted in
  that scenario's retrospective (SGD 53.77). It is not in the reference case.
- Options are compared only for the same net amount and deadline. The 7.5-hour last-mile bound is
  simulated, not observed delivery.
- Carry (funding cost) = principal × assumed annual rate × restricted calendar days / 365, with restricted
  days running from the funding slot to the common release checkpoint (Friday 5 days, Monday 2 days).
  The rate is a **hypothetical assumption** (avoided borrowing or incremental return), never evidence. It
  only changes carry figures and the formula; it never changes a check, a status or the decision.
- Synthetic costs: FX spread 25 bp on principal (SGD 337.50), rail charge SGD 20.00, processing Friday
  SGD 15.00 / Monday SGD 25.00 (so waiting costs SGD 10.00 more in processing).
- Reference retrospective at 8%: 405,000 SGD-days less principal earmarked; carry reduction SGD 88.77;
  extra processing SGD 10.00; conditional net SGD 78.77 **before subscription**. At 0%: waiting costs
  SGD 10.00 more.

## Run the tests

```bash
cd funding-replay
python3 -m unittest discover -s tests -v      # engine + server (139 tests)
node tests/browser/e2e.cjs                     # browser, 123 checks (needs Node + Playwright with Chromium)
python3 parity/run.py --original-dir PATH      # compare with the original experiment (see parity/README.md)
```

Latest results: `docs/TEST_RESULTS.md`. Screenshots: `docs/screenshots/`. Demo script:
`docs/DEMO_SCRIPT.md`. Handoff: `docs/HANDOFF.md`. Engine comparison: `docs/PARITY_REVIEW.md`.

## Known limitations

- **Engine history.** The engine was reconstructed first from the whitepaper and memo, because the original
  experiment was not available at the time. It was then compared with the supplied original
  (`Funding_Replay_Experiment.zip`, SHA-256 `7cbab786…24a9d`; its 22 tests pass) using the harness in
  `parity/`. Decision-changing differences were fixed; deliberate deviations (the counterfactual Monday
  view, no figures before the retrospective) are listed in `docs/PARITY_REVIEW.md`. The original is not
  bundled in the app.
- The 24 h balance limit is a demo policy. Per-slot last-mile bounds can't be expressed (one common bound).
- Synthetic data only. No real provider terms, cutoffs, quotes, capacity, bank balances or customer
  records. Fixture names are fictional.
- One obligation, one corridor (SGD → USD), two candidate slots. No shared-pool reservation, no partial
  funding, no multi-entity view.
- Simple carry model (Actual/365, calendar days to the common release). No FX hedging, tax, subscription
  or staff-time model; the "net before subscription" figure excludes the product's own price.
- The simulated service bound is not a measured delivery time. Beneficiary credit is not observed.
- Not predictive: the replay tests mechanics, not demand, real cutoffs or payout reliability.
- Local single-user tool; imported files are held in memory only and discarded on restart.
