# Money and state model — provider funding lifecycle (simulated)

**Simulated — no funds move.** All parties, the facility FAC-NW-01, policy POL-ADV v2026.11-1, balances and events
are fictional (`fixtures/lifecycle/*.json`, each marked `"synthetic": true`). Roles are labels, not authentication.
The authority is `engine/lifecycle.py`; the browser only renders its view JSON (see `LIFECYCLE_CONTRACT.md`).

## State
A state is `(case id, ordered event log)`. Every other number is derived by folding the log over the fixture.
`state_id` is a SHA-256 of the canonical JSON of that pair, so the same actions always give the same id and view.
`apply(state, action)` is pure: it appends the action's events, or returns the same state when the action is
disabled, a duplicate or unknown. Each event carries `effective_at` (when it happened) and `known_at` (when the
desk first learned of it).

## Clock and visibility
The simulation clock starts at the case's `start_clock` and moves only through "Simulated event" actions: the
next clock step (`Advance to Mon 16 Nov 15:00 SGT`, `… Wed 18 Nov 23:00 SGT`, `… Thu 19 Nov 10:00 SGT`) or an event
with its own time (fresh balance +20 min, beneficiary credit/return at the fixture time). When the clock advances,
responses already due by the target (pending provider acceptance, a requested balance, a delivery record known by
then) are recorded first, exactly as their explicit actions would record them, and the reservation expiry is
evaluated at the new clock. Evidence, timeline, options, rules, warnings and actions use only records with
`known_at <= clock`. A forecast is never cash, cash support or repayment; the Thursday receipt (known Thu 19 Nov
10:00) cannot appear in any earlier view.

## Four independent facts
1. **Authorisation/reservation:** `none → requested → (evidence_requested → requested) → reserved | declined`;
   `reserved → released` (reviewer withdraws, or expiry at Mon 16 Nov 16:00 SGT evaluated at the clock) or
   `→ consumed` (draw). Approval needs every deterministic rule to pass (no score). Rules are split into
   **Authorised to lend** (facility active, company-limit headroom, importer balance ≤ 24 h old, before the draw
   cutoff) and **Cash available to pay** (provider funding account deployable cash after other payouts'
   reservations). A stale balance is *unknown* (need newer evidence), not insufficient.
2. **Cash movement:** `none → drawn`. Draw moves the reserved amount to principal (SGD 135,382.50) and charges the
   flat fee (SGD 150.00) separately. After a draw nothing can erase principal; "release" is disabled.
3. **Supplier delivery:** `none → instructed → accepted (provider) → credited | returned`. Acceptance is not
   credit; credit exists only through a delivery-record event. A return records where the money was last
   evidenced, a recovery owner and next action; no second payment is ever generated and the case stays open.
4. **Repayment:** principal and fees outstanding, matched repayments, customer receipts into the importer's own
   account (shown, never counted as repayment) and unmatched items.

Committed capacity (reserved) and outstanding principal are always separate fields.

## Identities (checked on every state, shown in `view.invariants`; the export fails if any is false)
- `company_limit = company_available + reserved + principal_outstanding` (SGD, available ≥ 0)
- `funding_start = funding_available + reserved (this payout + other payouts) + principal_outstanding`;
  repaid principal returns to available; fees are income, tracked separately, never netted against principal
- `principal_outstanding = drawn − principal_repaid ≥ 0`; `fees_outstanding = fees_charged − fees_repaid ≥ 0`
- each repayment: `fees + principal + unmatched = amount`; SGD received = fees repaid + principal repaid + SGD unmatched
- each lifecycle step at most once (no double reservation, draw, instruction, acceptance, credit or close)
- delivery stages in order and funded; draw equals the reservation
- closed ⇒ credited, principal = fees = 0, no open unmatched items, no open conflict
- evidence and timeline contain only records with `known_at <= clock`

## Currency and allocation
`Money` holds a `Decimal` and a currency; adding SGD to USD raises. Floats are rejected. Rounding (half-up, 2 dp)
happens only for display. The facility, its limit, fee, principal and matching are SGD. **Allocation rule:** each
SGD repayment pays fees first, then principal; any excess is held as unmatched for review and never netted.
A payment in another currency (e.g. USD 1,000.00) is held as unmatched in its own currency and blocks close until a
reviewer returns it. Example: SGD 100,000.00 → fees 150.00, principal 99,850.00; SGD 35,532.50 remains.

## Idempotency and contention
Repeating approve, draw, instruct, accept, credit or a repayment shows the action disabled ("Already done …") and
applying it returns the identical state. The competing case shows a reservation already on the funding account:
the remaining cash cannot be reserved twice, so approval is disabled with the reason.

## Limits of this simulation versus production
- A static, single-user simulation: there is no real concurrency control, locking or ledger; "two requests" are
  modelled as fixture reservations, not as racing writers.
- No authentication or authorisation: "Reviewer" and "Importer" are labels anyone can click.
- The exported site is plain static files: anyone with the folder or URL can read every state, including future
  ones. Do not put real data in it.
- The state space is pre-computed (≤ 400 states per case); unusual paths outside the modelled actions do not exist.
- Times, cutoffs, balances and the 24 h freshness limit are demo policy, not provider or bank rules.
