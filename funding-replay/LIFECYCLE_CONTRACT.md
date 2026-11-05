# Provider funding lifecycle — build contract (v1, 5 Nov 2026)

**Simulated.** Every party, facility, limit, fee, balance, date and event below is fictional. No real provider has
agreed to fund anything. No money moves. Role switches are labelled "Simulated role" and are not authentication.

**Question the product answers:** "Can we get this supplier paid by the deadline, let the importer keep its cash
longer, and show exactly who funds the gap, who approved it, and when that exposure ends?"

**Primary user:** the payment provider's operator. **Second actor:** an authorised reviewer (Simulated role).

## Architecture (smallest that works offline)
- `engine/lifecycle.py` (Python 3.9+ stdlib, `Decimal` only, owned by the model owner) is the authority:
  case fixtures → `initial_state(case)`; `apply(state, action_id) -> state` (pure, deterministic); `view(state)
  -> dict` (the JSON below); `available_actions(state)`; `check_invariants(state)`.
- `tools/export_site.py` does a breadth-first walk of every reachable state from each case's start (following
  only `actions[].enabled`), writes one `states/lc-<case>-<stateid>.js` per state (same script-tag delivery as
  `tools/export_tester.py`, works from file:// and any static host), `lc-meta.js` (cases + start ids), the
  provider desk at `index.html`, and the existing importer replay tester under `replay/`.
- `app/static/lifecycle.html|lifecycle.js` (owned by the interface owner) **renders only the view JSON** and
  follows `actions[].next`. No money, dates or rules in JS. Reset = load the case start state.
- State ids are deterministic (hash of the canonical event log). Repeating an action that the engine treats as a
  duplicate returns the same state (no-op) and is shown as such.

## The case (reference, all times explicit)
Importer **Northwind Foods SG Pte Ltd** (fictional) owes **Harbor Provisions LLC** (fictional, US) **USD 100,000.00
net**, spendable by **Wed 18 Nov 2026 23:00 SGT (10:00 EST)**. Provider release checkpoint Wed 18 Nov 15:00 SGT.
Quote SGD 1.35/USD + 25 bp; payout charges SGD 45.00 (rail 20 + processing 25) → SGD cost of the payout
**SGD 135,382.50** (as the Monday slot in the replay). Original customer funding window: Fri 13 Nov 15:00 SGT
(cutoff 16:00, exclusive). Later window: Mon 16 Nov 15:00 SGT (cutoff 16:00). The importer expects a customer
receipt of SGD 140,000.00 on **Tue 17 Nov** (forecast, known Thu 12 Nov) and would prefer to fund after it.
**Surprise:** the receipt actually settles **Thu 19 Nov 10:00 SGT** (first known then).

Simulated facility **FAC-NW-01** "Supplier payment advance", policy **POL-ADV v2026.11-1**, denomination **SGD**:
company limit SGD 300,000.00; fee SGD 150.00 flat per advance (separate from principal); repayment due
**Fri 20 Nov 2026 17:00 SGT**; reservation expires at the draw cutoff Mon 16 Nov 16:00 SGT; route deadline = the
supplier deadline. Provider deployable funding (simulated SGD funding account) SGD 500,000.00, of which other
committed payouts may already use some. Eligibility rules are deterministic and listed in the view.

## Four independent facts (never one "Completed")
1. **Authorisation/reservation:** none → requested → (evidence_requested) → reserved | declined; reserved →
   released (declined later / expired unused) | consumed (drawn).
2. **Cash movement:** none → drawn (principal outstanding, SGD) .
3. **Supplier delivery:** none → instructed → accepted by provider → beneficiary credited | returned/failed.
4. **Customer repayment:** principal outstanding, fees outstanding, matched repayments, customer receipts
   (importer's own account — NOT repayment), unmatched/excess cash.

Accounting identities (checked after every event, shown in the view):
- company_limit = available + reserved + principal_outstanding (SGD)
- provider funding: start = available_cash + reserved_cash + principal_outstanding − 0 (repaid principal returns
  to available; fees are income, tracked separately, never netted against principal)
- principal_outstanding = drawn − principal_repaid ≥ 0; fees_outstanding = fees_charged − fees_repaid ≥ 0
- every repayment is allocated explicitly: fees then principal (rule stated in the view); excess → unmatched,
  held for review, never netted. Wrong currency → unmatched, cannot close.
- Close only if: delivery = beneficiary credited, principal_outstanding = 0, fees_outstanding = 0, no unmatched
  items, no conflicts. Otherwise "open for review".

## View JSON (per state)
```
{ "label":"Simulated — no funds move.", "case":{"id","name","description"}, "state_id",
  "clock":{"sgt","ny","label"},                       // simulation clock
  "header":{"importer","supplier","amount":"USD 100,000.00 net","deadline_sgt","deadline_ny"},
  "decision":{"tone","headline","binding_constraint","next_action","owner"},
  "options":[{"key":"A|B|C","title","status","whose_money","committed_at","amount","duration","modeled_cost",
              "risk_bearer","evidence":[ids],"disqualifiers":[...]}],   // short texts (≤ 48 chars per field)
  "options_note":"why costs are/aren't ranked",
  "facility":null|{"id","name","label","status":"active|suspended","policy_version","denomination",
                   "company_limit","company_available","reserved","committed_capacity","principal_outstanding",
                   "funding_account","funding_start","funding_available_cash","funding_reserved",
                   "funding_reserved_this_payout","funding_reserved_other_payouts",
                   "fee","fees_outstanding","fees_collected",
                   "repayment_due_sgt","reservation_expiry_sgt","route_deadline_sgt",
                   "rules":[{"group":"Authorised to lend|Cash available to pay","rule","ok":true|false|null,"detail"}]},
  "facts":{"authorization":{"status","label","detail"},"cash":{"status","label","detail"},
           "delivery":{"status","label","detail","last_evidenced"},
           "repayment":{"status","label","principal_outstanding","fees_outstanding","due_sgt","owner","allocation_rule",
                        "unallocated":[{"id","amount","received_sgt","note"}],
                        "matched":[{"id","amount","received_sgt","at_sgt","fees","principal","unmatched"}],
                        "customer_receipts":[{"id","amount","at_sgt","note"}],
                        "unmatched":[{"id","amount","reason","status":"open|returned to payer"}]}},
  "exposure":null|{"status":"outstanding|ended","amount","principal","fees","currency":"SGD","owner","ends_when"},
  "evidence":[{"id","kind","fact","source","effective_sgt","known_sgt","status"}],   // known_at <= clock only
  "timeline":[{"at_sgt","known_sgt","actor","text"}],                               // known_at <= clock only
  "actions":[{"id","label","role":"Operator|Reviewer|Simulated event|Importer","enabled","disabled_reason",
              "consequence","next"}],   // disabled: next = this state_id (applying it is a no-op)
  "invariants":[{"name","ok","detail"}], "warnings":[...] }
```
`exposure` is null until a draw. All money fields are display strings.

### Status and tone values (the UI may rely on exactly these)
- `decision.tone`: `decide` (a person must act), `blocked`, `unknown` (evidence missing/stale or waiting on a
  response), `review` (conflict, unmatched cash, missed cutoff/deadline, overdue), `delivered_exposure` (supplier
  credited, importer still owes), `closed`, `declined` (advance declined, or reservation released/expired unused:
  nothing reserved; the importer funds at the original window or not at all), `failed` (payout returned).
- `options[].status`: `feasible`, `infeasible`, `unknown`, `unavailable`, `selected`, `not_selected`.
- `facts.authorization.status`: `none`, `requested`, `evidence_requested`, `reserved`, `declined`, `released`, `consumed`.
- `facts.cash.status`: `none`, `drawn`.
- `facts.delivery.status`: `none`, `instructed`, `accepted`, `credited`, `returned`.
- `facts.repayment.status`: `not_started` (nothing drawn), `not_applicable` (Option A, no advance), `outstanding`,
  `partially_repaid`, `repaid`.
- `exposure.status`: `outstanding`, `ended`.

### Action ids (labels in brackets)
`request_advance` [Request advance] · `approve_reserve` [Reserve capacity — approves and reserves limit + funding
under FAC-NW-01; does not draw cash or pay the supplier] · `request_evidence` [Request evidence] ·
`sim_fresh_balance` · `decline` [Decline] · `release` · `select_a` · `draw` [Record simulated draw] ·
`instruct` [Instruct payout] · `sim_accept` [Provider accepts payout] · `sim_credit` [Record beneficiary credit] ·
`sim_return` · `sim_conflict` · `resolve_conflict` · `sim_receipt` [Record customer receipt (importer's account);
listed only once the clock is at or after its known time] · `sim_pay_partial` [Importer pays provider SGD
100,000.00] · `sim_pay_balance` [Importer pays provider SGD 35,532.50 (balance)] · `sim_pay_usd` [Importer pays
provider USD 100.00] · `match_repayment` [Match repayment] · `return_unmatched` [Return unmatched amount] ·
`close` · `advance_clock` [Advance to …]. Incoming payments are unallocated until `match_repayment` applies them
(fees first, then principal); USD and excess stay unmatched and block close.

Money strings like "SGD 135,382.50" / "USD 100,000.00"; times "Fri 13 Nov 2026, 15:00 SGT" and NY with EST.

## Cases (fixtures `fixtures/lifecycle/*.json`)
`reference` (main journey incl. Thursday surprise), `stale_balance` (importer balance > 24 h old → "need newer
evidence"; Request evidence → simulated fresh balance → eligible), `fixed_terms` (contract fixes prefunding, no
facility → "Later funding unavailable"), `no_cash` (credit headroom but provider funding insufficient → blocked/
referred), `competing` (another payout already reserved funding → this one blocked), `failed_payout` (payout
returned → money last evidenced, recovery owner, no auto resend, case open), `all_infeasible` (decision after
cutoff, facility unavailable, no cash support → no feasible option). The existing replay fixtures and tests are
unchanged.
