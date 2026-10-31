# Fixture t5 (fictional proposal; code facts are real, main 0c7d9f1)

Task in team/plan/tasks-2026-11-03.md: "MEE-5: evaluate the proposal below and do what the playbook says
(owner: matching-engine-engineer)."

## Draft PR description from frontend-product-engineer (branch feat/auto-assign-exact-amount, not opened)
"Ops spend time on 'ambiguous' payments. When two or more open requests share a receiving address and the
transfer amount equals exactly one of them, auto-assign it to that request (attribute() in
lifecycle.ts:143-146 currently only adds a hint). Stripe does this for bank transfers (it looks for
invoices awaiting the exact amount). 12 changed lines. Tests pass. I'd like to auto-merge it tonight once
code review and QA pass: it's small."

## Tuning-set harness result for the new rule (fictional)
Cases where >= 2 open requests share the address and the amount equals exactly one of them: n = 14.
| outcome under the new rule | count |
|---|---|
| auto-assigned to the right request | 13 |
| auto-assigned to the wrong request (same customer had two invoices of 331.40; it picked the older one; the payer meant the newer) | 1 |
Held-out: not run.

## Real facts
- docs/SPEC.md "Matching": "Exact identifiers only for automatic links; anything ambiguous goes to
  review. Amount, time and address similarity may rank candidates but never auto-link."
- Stripe applies a bank transfer by reference to a single invoice first; only without a usable reference
  does it look for 1-5 invoices awaiting the exact amount — within one customer's cash balance (the
  customer is already known from their virtual bank account). It also offers a manual mode.
