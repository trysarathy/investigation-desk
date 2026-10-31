# Task 5 — Pricing test design: is US$200/month the right monthly price? (P3, Mon 2 Nov 2026)

SETUP: PAUSE = FALSE (fixture). Nothing has been changed. This is a design for her yes/no.

**BLUF:** At our n (5 held calls, 2 pilot offers, 0 conversions to monthly), no method can tell us whether US$200 is right yet. The design below measures value per prospect now, collects structured willingness-to-pay data inside Strong calls, and decides on revealed behaviour: pilots converting to US$200 at day 30. **Earliest valid decision: about mid-January 2027.** Before then, every answer is "directional, n=k".

## Hypothesis rows (append to the `pricing.md` log)
| ID | Date | Hypothesis | Lever | Segment | Evidence so far | Status |
|---|---|---|---|---|---|---|
| H3 (now testing) | 2026-11-02 | US$200/month is below measured value for buyers with ≥ 25 receipts/month, so ≥ 2 of 3 measured pilots show value ≥ 2× price and convert at US$200 | level | S1, volume ≥ 25/mo | Nodewell: bookkeeper ~3 h/week on receipts (grade C) and a demo on 12 Nov (B). Its Q7 "a few hundred a month easily" is grade D (hypothetical), so directional only. Gridlane: "depends on the price" (D). ROI defaults [GUESS]: value ≈ US$336/mo at 60 payments, US$246 at 35, US$163 at 12 | testing |
| H4 (linked) | 2026-11-02 | Below ~22 receipts/month, the US$200 objection is volume fit, not price level | segment fit | low-volume | Gridlane decline "only ~12 payments a month" vs 35 on the call note: conflicting, so it can't be counted yet | open |

## Method valid at our n (`pricing.md` §3)
1. **Revealed preference (primary):** pilot → month-2 conversion at list US$200, with the reason in their words when they don't convert (Opportunities tab).
2. **Value measured per pilot:** the pilot records `N`, `p`, `Me`, `Mp` and the savings shares in `ROI_CALCULATOR.md` from their real payments. Value is compared with US$200.
3. **Structured WTP questions** (Ramanujam style), only in Strong calls after Q7, never quoting our price first: what they'd compare it with, when it would be too expensive to consider, what would be a bargain, and flat vs per-payment. Labelled "directional, n=k".
4. **Not used:** Van Westendorp and Gabor-Granger. They need ~30+ per segment and we expect 6-10 held calls in 3 weeks [GUESS].

## Pre-registered rule: EXP-20261102-P3 (frozen when she approves)
- Primary metric: converted to US$200 at day 30 / measured pilots. Minimum n: **3 measured pilots** (H3 rule) **and ≥ 5 offers** (H1).
- **KEEP US$200** if ≥ 2 of 3 measured pilots convert **and** measured value ≥ 2× price in ≥ 2 of 3.
- **RE-EXAMINE LEVEL (new experiment)** if measured value < 2× price in ≥ 2 of 3 pilots at ≥ 25/mo, or ≥ 3 of 5 non-converters cite price with volume ≥ 25/mo.
- **SEGMENT, NOT PRICE (H4)** if most price objections come from < 22/mo. Then the fix is targeting, not a lower price.
- Otherwise **INCONCLUSIVE**. End 2027-01-31, extend once.
- Secondary (directional): WTP answers from ≥ 8 Strong calls. These never decide on their own.

## What will not change during the test
List price (US$300 pilot → US$200/month), the credit against months 2-4, the refund criteria, the 10-business cap, the call-script order, and no proactive discounts. Discount requests are logged as data and decided by her case by case (Decisions log, "hold price + narrower scope"). The website's "free pilot" fix is a separate claims fix; it changes no price.

## Risks
Contaminating H1 if anything changes mid-test; slow n, since a decision is about 10 weeks away; over-promise if ROI defaults are quoted as facts (they're [ASSUMPTION]/[GUESS]); a discount precedent.

## Approvals needed
- Her yes to the design (D1).
- Adding the WTP questions to calls is a talk-track change: sales-closer-assistant applies it after her yes.
- Every pilot offer and invoice needs her approval (rule 6).

**D1** Should we run EXP-20261102-P3 as designed? A: yes. B: change the design. C: don't test (keep as is, revisit after 5 offers per 29 Oct). **I recommend A.** It changes nothing customer-facing except two call questions. Applies: sales-closer-assistant (questions), ae-assistant (pilot measurement).

## WOULD WRITE — Log / Decisions log
```
2026-11-02 09:10 | gtm-strategist | pricing test proposed | H3 (+H4) | EXP-20261102-P3: min 3 measured pilots + 5 offers; KEEP if >=2/3 convert & value >=2x; end 2027-01-31; PENDING D1
2026-11-02 09:10 | gtm-strategist | data conflict | L-0131 | volume 35 (call) vs ~12 (decline); not counted until clarified
Decisions log: PENDING: D1 run US$200/month test design EXP-20261102-P3 (A yes / B change / C don't test)
```
