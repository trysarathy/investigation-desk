# Pricing: hypotheses log, research methods, rules for proposing a change

Last refreshed 2026-10-31 · owner gtm-strategist. **gtm-strategist never changes a price, the
offer, the founding cap or any page/template that shows a price.** It logs hypotheses, designs
tests, and proposes changes as numbered decisions (`PENDING:` in the Decisions log). Owners apply
only after Aashmiin's yes: website → lead-designer/content; proposals/invoices → revops-crm-agent /
finance-admin; call talk track → sales-closer-assistant.

## 1. Current offer (binding): see `clearline-gtm-today.md` §2
US$300 / 30 days → US$200/month, pilot fee credited against months 2-4, refund on criteria 1/4,
first 10 businesses, enterprise on request. Status: untested (`CLAIMS_AUDIT.md` P0).

## 2. Pricing hypotheses log
Template (one row per hypothesis; never delete, append status changes):
| ID | Date | Hypothesis (we believe X, because Y) | Pricing lever (level / model / packaging / terms) | Segment | Evidence so far (k of n, grade A-D) | Test design (playbook P3) | Pre-registered decision rule | Status (open / testing / supported / rejected / inconclusive) | Decision ref |
|---|---|---|---|---|---|---|---|---|---|

Current rows (all [ASSUMPTION], 0 evidence):
| ID | Hypothesis | Lever | Segment | Evidence | Rule (when tested) | Status |
|---|---|---|---|---|---|---|
| H1 | A **paid** pilot (US$300) filters for serious buyers better than free, without killing acceptance | terms | all | 0 offers | After >= 5 offers: >= 2 paid → keep; 0 paid with >= 3 citing price → test lower/credit-only | open |
| H2 | **Flat monthly** beats per-payment or % pricing for SMBs, because value is per exception/entry and a % fee reads like custody (teardown T3) | model | S1-S3, S6 | 0 | Ask model preference in >= 8 calls (grade C+); revisit only if >= 5 of 8 prefer usage-based | open |
| H3 | US$200/month is below the value for buyers with >= 25 receipts/month (ROI calc: ~US$840 value at defaults) | level | volume >= 25/mo | ROI defaults only [GUESS] | After >= 3 pilots measured `Me`, `Mp`, `p`: if measured value < 2x price for 2 of 3 → re-examine level or target higher volume | open |
| H4 | Below ~20-25 payments/month the offer doesn't pay back on time alone (ROI calc break-even ~22) | segment fit | low-volume SMB | ROI calc [GUESS] | Track `volume_per_month` in Calls; if most Strong calls are < 20/mo, value must come from error avoidance, not time | open |
| H5 | Accounting firms will refer if their seat is free and clients pay per entity (teardown T4, Ledgible model) | partner model | P1 | 0 | >= 5 partner conversations grade B+; >= 1 referral in 30 days | open |
| H6 | Enterprise (S5) needs a different price shape (annual, per entity, security work billed) | packaging | S5 | 0 | Only after a qualified enterprise opp exists; don't design ahead | parked |

## 3. Research methods and when n allows them
| Method | What it measures | Minimum n before it means anything [ASSUMPTION] | How Clearline uses it now |
|---|---|---|---|
| Revealed preference: offers at list price | Real WTP | each offer is a data point; decide after >= 5 offers | **Primary method.** Opportunities tab: offered → paid/declined + `reason_in_their_words` |
| Willingness-to-pay talk (Ramanujam) | Range and model preference, stated | qualitative from call 1; count after >= 8 | Ask after CALL_SCRIPT Q7, only if the problem is Strong; never quote our price first in a learning call (script is learning-only) |
| Van Westendorp PSM (4 questions) | Acceptable range, stated | ~30+ per segment for curves [ASSUMPTION: common guidance, not opened] | Not valid yet; could run as a short form to partners' clients later |
| Gabor-Granger (likelihood at price ladder) | Demand curve, stated | ~30+ per segment [ASSUMPTION] | Not valid yet |
| ROI / value calculator | Economic value from their numbers | per prospect | `ROI_CALCULATOR.md`; label defaults as guesses |
| Competitor anchors | Reference points | n/a | `competitor-positioning.md` §2 (labels kept) |

## 4. Rules for proposing a pricing change
1. State the hypothesis ID, the evidence with n and grade, the rule it met, and the alternative
   options (always include "keep as is").
2. Show the downstream edits the change would need (website, proposal template, OBJECTIONS,
   one-pager, call talk track, invoices) and their owners. Applying them is not your job.
3. Never propose a change mid-experiment that would contaminate it (e.g. changing price while
   H1 is collecting offers), unless a rule-1 risk (over-promise, wrong price shown) forces it.
4. Discount requests from one prospect are a sales decision for Aashmiin (Decisions log example:
   "hold price + narrower scope"), not evidence that the list price is wrong.
5. A live mismatch (website "Free during the pilot" vs the paid offer) is a **claims fix**, not a
   pricing experiment: flag it, owner fixes after her yes.
