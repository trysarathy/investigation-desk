# Closing a founding pilot at a 0-customer startup

What "closing" means at Clearline today: a business with a Strong problem agrees, in writing, to the
**founding pilot (US$300 for 30 days, then US$200/month, first 10 businesses)**, pays the invoice, and
reaches a day-30 continue/stop decision against success criteria agreed on day 1. Aashmiin closes; this
employee prepares every piece so the close is a signature, not a new negotiation.

## 1. The funnel and the metric
Calls held → pilots offered → pilots accepted (signed/paid) → day-30 continue. Plus: follow-up draft ready
≤ 2 h after the call (measured from the call's calendar end time to the Gmail draft's creation time).
Definitions [ASSUMPTION: ours]:
- **Pilot offered** = Aashmiin made the offer on a call or approved a sent proposal (from her notes or
  Touches). A drafted proposal she hasn't approved is not "offered".
- **Pilot accepted** = written acceptance or the invoice paid. A verbal "sounds good" = "Pilot agreed
  (verbal)" stage in Opportunities, not accepted.

## 2. When a pilot may be proposed
Only if: the problem scored **Strong** (monthly or more, costs hours or money, they tried to fix it:
CALL_SCRIPT), she noted interest, the use case fits what a pilot can deliver today (`clearline-truth.md`
§3: Ethereum USDC/USDT payment pages; transfers recorded by us by hand; Xero on approval starting on the
Demo Company), and fewer than 10 founding pilots are signed. If the fit fails (Tron-only, QuickBooks-only,
SOC 2 required), the honest draft says so and asks whether they want to wait, and she decides.

## 3. Design-partner / paid-pilot practice (secondary, consistent across sources)
[ASSUMPTION: secondary, search summaries of bvp.com "Design partners: the pre-launch edge", First Round
Review on Sierra's design partnership, garuda.substack.com, wavect.io, 2026-10-31]
- Charge for the pilot: free pilots are weak evidence of demand. (Clearline already does: US$300.)
- Write success criteria and an end date before the pilot starts; pilots stall when success was never
  written down.
- Agree the post-pilot price up front so conversion is a signature, not a renegotiation. (Ours: US$200/mo.)
- End with a binary decision: continue or stop.
- Keep the cohort small and hand-picked. (Ours: first 10 businesses.)
Primary corroboration: PostHog trials need "Documented success criteria" and a "Documented timeline";
GitLab trials have "established metrics for success" and the success document is "signed by an accountable
individual from both parties" [VERIFIED: see `teardowns.md`].

## 4. The mutual action plan (MAP)
Template: `origin/enterprise-pack:docs/enterprise/MUTUAL_ACTION_PLAN_TEMPLATE.md` [VERIFIED, opened
2026-10-31]. 15 steps: discovery → demo on fictional data → security review → hosting → success criteria and
baselines → data processing terms → proposal signed and US$300 paid → setup day 1 → Xero Demo Company then
live org (days 3-7) → weekly check-in → day-15 midpoint → month-end report → day-30 review → stop (deletion)
or continue (from day 31). "Owner names are people, not teams." Risks line at the bottom.

Rules for drafting a MAP [ASSUMPTION: ours, from GitLab's mutual-close-plan practice]:
- Built **with** the buyer: the draft is a proposal for the next call ("Here's a draft plan; what's
  wrong with it?"), never presented as agreed.
- Customer-side owners only from her notes; otherwise `[name: ask]`. Never invent a person.
- **Dates**: Clearline-side dates are `[date: Aashmiin to set]` unless she wrote them. Customer-side dates
  only if the customer said them. A go-live / start date is a promise: hers alone.
- Trim steps that don't apply (a 5-person firm may skip security questionnaire and DPA review) but say
  which and why; never delete the Risks line.
- Add pre-pilot product dependencies she must confirm (e.g. `HARD_QUESTIONS.md` #8: "Would you let a pilot
  customer connect their Xero today? Not yet": sign-in, token storage, granular scopes come first).

## 5. Price, discount and terms: what this employee does
Facts: the offer is fixed by Aashmiin (`clearline-truth.md` §1). GitLab and PostHog both treat discounting
as a governed decision ("only discount when real budget constraints are the hold up"; "discounts are
earned, not given") [VERIFIED: teardowns].
When a prospect asks for a discount, custom terms, a written go-live date, an SLA or a feature by a date:
1. Do **not** reply, and do not draft a reply that agrees, hints, or "will see what we can do".
2. Explore (LAER) in a draft for her: what is behind the ask (budget cap? approval threshold? a board date?
   comparing to a free tool?).
3. Write her a decision memo: the ask, the facts (offer, what's true today, what's roadmap), options with
   consequences (hold the founding price; offer a smaller scope; decline; something else she chooses),
   and a draft reply for **each** option, clearly marked "pick one or edit".
4. Approval Queue row `item = pricing decision` (or `promise decision`), and top of the 18:07 summary.
5. Log it. Opportunities `next_step = Aashmiin to decide <ask>`.
Never: say "yes", "should be fine", "likely", "we can probably", a % or a date, even in a draft subject.

## 6. Stalled deals (deal-movement check)
A deal is **stalled** when its `next_step_date` has passed, or there's no inbound touch for 7 days after a
call held / proposal sent, or a MAP step is overdue [ASSUMPTION: our thresholds; she may change them].
For each: say why it's stalled (from Touches/Calls), propose one specific next step that gives value
(answer an open question honestly, send the MAP draft, offer the 5-minute demo if Strong), and write a
**Gmail draft** in the existing thread. No "just checking in". Not more than one nudge draft per deal per
week; after two unanswered nudges propose a polite close-the-loop draft and stage review to her.
