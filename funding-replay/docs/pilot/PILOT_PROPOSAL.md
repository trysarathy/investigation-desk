# One-page pilot proposal — Clearline Funding Desk

**What we know.** One advisor (Matt) described one transfer provider whose enterprise customers wanted supplier
payments without prefunding days ahead; sometimes the provider reviewed the customer, paid first and collected
later. That is one reported example, not evidence of demand. Everything else below is a hypothesis to test.

**Who uses it.** At one cross-border payment provider: 1–2 **operators** (payments/treasury operations) who prepare
and follow each supported payment, 1 **reviewer** (credit or treasury lead) who approves or declines provider
funding, and optionally a **viewer** (finance/compliance) who reads and exports. Private workspace, named
log-ins, no customer access.

**What they do today (to confirm in interviews, not assume).** Likely: a spreadsheet or ticket per exception,
approval in chat or email, the payout in the provider's own bank/payout system, and repayment matched later in
the ledger or by hand. The pilot does **not** replace their payout system or ledger: operators record the external
payout reference and evidence; Clearline keeps the case together.

**What the pilot covers (4–6 weeks, synthetic first).**
1. Week 0–1: walk through 3 of their past supported payments on synthetic copies we key in together.
2. Week 2–5: every new supplier payment they agree to support is opened as a case: routes A/B/C, approval,
   reservation, draw, payout reference, delivery, customer receipt, repayments, close.
3. Anonymised pilot data only with the founder's written authorisation; until then, synthetic records only.

**Evidence we request** (only what they already hold; nothing they would have to create for us): the payment
instruction reference, the importer's bank balance they relied on (as-of time and source), any agreed later
funding terms, the approval they recorded, the supplier credit confirmation, and the repayment bank references.

**How we measure improvement** (baseline from their last 5 supported payments, then pilot cases):
- Time from request to an approval decision on record (with policy version, actor, reason).
- For each case, can someone other than the operator answer in under 2 minutes: who funded it, what was approved,
  whether the supplier received it, what is still owed, who acts next? (yes/no, timed).
- Repayments matched to the right case within 1 business day; unmatched/wrong-currency items left unresolved.
- Exceptions (uncertain payouts, overdue repayments) that someone owned before they became urgent.
- Reviewer-reported: number of follow-up messages needed to approve one advance.

**What result tells us to stop or change course.**
- They fund fewer than ~2 supplier payments a month before customer payment → wrong decision/buyer; stop.
- The approval and exposure are already answered well in their existing loan/ledger system and nobody wants a
  separate case view → the gap isn't here; stop building the desk.
- Operators won't record the external payout reference or delivery evidence even with the tool → the workflow
  doesn't fit their day; rethink.
- The reviewer won't use it because credit decisions sit with a partner/lender → the buyer is the partner, not
  the provider; re-target.

**Not in the pilot:** live payouts, holding funds, originating credit, credit scoring, FX booking, accounting
entries. See `PROVIDER_DEPENDENCIES.md`.

## Three questions for the first operator interview
1. "Walk me through the last supplier payment you funded before your customer paid you."
2. "When that payment was approved, what did the approver look at, and where is that record now?"
3. "After the supplier was paid, how did you know what the customer still owed you, and who chased it?"
