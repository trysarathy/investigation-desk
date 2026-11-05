# Funding decision replay: build contract (v2, 3 Nov 2026: parity review with the supplied original)

This is the binding contract between the engine owner (Python), the interface owner (HTML/JS) and the
challenger. The lead (tech-lead) owns the working demo. Source of truth for the product: the Funding
Decision Whitepaper, the Founder Decision Memo and the Two-Week Validation Plan (3 Nov 2026).

**History of the engine (accurate account).** The engine was first **reconstructed** from the whitepaper
and memo because the original experiment was not available in the first build session. The original package
(`Funding_Replay_Experiment.zip`, SHA-256 `7cbab786925d105ccd902ded51d6c822fd36653e08444c9838f16db915e24a9d`:
`replay.py`, `events.csv`, `test_replay.py`, README, four HTML views) was supplied afterwards and compared with
the rebuild (`docs/PARITY_REVIEW.md`, harness in `parity/`). Decision-changing differences were resolved in the
rebuild (contract v2 below); the original stays a read-only reference outside the app. The engine label in
every response remains `"reconstructed"`. Every fixture is **synthetic**.

## Hard rules
- Python 3.9+ standard library only (Decimal, csv, json, datetime, zoneinfo, http.server). No third-party
  packages. One launch command: `python3 funding-replay/app/server.py` (default port 8765), then open
  http://127.0.0.1:8765. Bind to 127.0.0.1 only.
- **All money uses `decimal.Decimal`**. Never float. Display rounding: ROUND_HALF_UP to 2 dp, only at output.
  Carry differences are computed at full precision and rounded once.
- **The JavaScript never computes money, dates or decisions.** It only renders the engine's JSON. Every
  number and sentence shown comes from the engine response.
- No network calls except browser → local server. No transfers, wallets, keys, credit, accounts, cloud,
  AI narration, analytics, external fonts or CDNs.
- Every screen and API response carries the label **"Synthetic replay — no funds move."**

## Story constants (reference fixture)
- Importer in Singapore owes a US supplier **USD 100,000.00 net** (net amount the supplier must receive).
- Reference rate: **SGD 1.35 per USD**. Principal SGD 135,000.00.
- Candidate funding slots: **Fri 13 Nov 2026 15:00 SGT** (cutoff 16:00 SGT) and **Mon 16 Nov 2026 15:00 SGT**
  (cutoff 16:00 SGT).
- Common provider-release checkpoint: **Wed 18 Nov 2026 15:00 SGT** (02:00 New York).
- Supplier needs **spendable USD by Wed 18 Nov 23:00 SGT = 10:00 New York (EST, UTC−5)**.
- Provider release is **not** evidence of supplier credit. Beneficiary credit is "not observed" unless a
  `beneficiary_credit` record exists.
- Costs per slot (synthetic): FX spread 25 bp on principal = SGD 337.50; rail fixed charge SGD 20.00;
  processing Friday SGD 15.00, Monday SGD 25.00 (+SGD 10.00). Required SGD: Friday 135,372.50; Monday
  135,382.50.
- Cash floor (policy): SGD 50,000.00.
- Simulated last-mile service bound (release → beneficiary usable credit): 7.5 h → 22:30 SGT (≤ 23:00). This
  is a simulated bound, not observed delivery.

## Decision times (evidence cutoff = the decision time itself)
| id | label | as_of |
|---|---|---|
| `friday` | Friday funding decision | 2026-11-13T15:00:00+08:00 |
| `monday` | Monday checkpoint | 2026-11-16T15:00:00+08:00 |
| `retro` | Retrospective comparison | 2026-11-19T09:00:00+08:00 |

A record is **visible** at as_of T iff `known_at <= T`. A visible record is **live** iff `expires_at` is empty
or `expires_at > ` the time it's needed (for a quote: the slot's instruction time). Records known after T must
never appear anywhere in the response (not in options, evidence, charts, tooltips, counts or ids).

## CSV fixture schema (one row = one evidence record)
Header (exact order not required; all columns required):
`record_id,kind,slot,effective_at,known_at,expires_at,amount,currency,rate,bp,status,source,establishes`
- `record_id`: non-empty, unique per fact. An identical duplicate row (all fields equal) is dropped
  (dedup). Same `record_id` with any different field → **conflict error** for that row (reject file).
- timestamps: ISO 8601 **with offset** (e.g. `2026-11-13T09:00:00+08:00`); `expires_at` may be empty.
- `amount`, `rate`, `bp`: decimal strings or empty; never parsed as float. ASCII digits only, at most 18 integer
  digits and 6 decimal places, no sign, commas or exponent (row error otherwise). Timestamps: ASCII only.
- `slot`: `friday`, `monday`, or empty (applies to both).
- `kind` (and what it establishes):
  - `obligation` — amount (USD net), effective_at = spendable-USD deadline.
  - `release_checkpoint` — effective_at = common provider release time.
  - `funding_slot` — slot, effective_at = instruction time, expires_at = cutoff.
  - `calendar` — slot, **effective_at (the date)**, status `open` | `closed`. The record dated on the
    instruction date says whether that day is open; a weekend instruction date fails. `closed` records on other
    dates are closures.
  - `lead_business_days` — slot, amount = open business dates required after the instruction date (excluded)
    through the release date in New York (included). Weekends and recorded closures don't count; a closed or
    weekend payout date fails. Missing → unknown. (Original: `lead_business_days` and `closure`.)
  - `quote` — slot, rate (SGD per USD), bp (FX spread), expires_at = quote expiry. For the Monday slot, a
    quote known on Friday is only usable if it is still live at the Monday instruction time.
  - `fee` — slot (or empty = both), amount SGD, **status = fee type** `rail` | `processing` | `other` (required).
    Two live fees applying to the same slot with the same type (different amounts, or the same amount under a
    different record_id) → contradictory → fees unknown.
  - `cash_snapshot` — amount SGD, status `settled`, effective_at = balance time. Usable only if effective_at ≤
    known_at (otherwise it is a forecast: warning, never usable), effective_at ≤ the slot instruction time, live at
    it (an earlier `expires_at` still applies), and **no more than 24 h before it — demo policy** (exactly 24 h is
    accepted; older → stale → cash unknown, decision `NEED_NEWER_BALANCE`). Freshness is judged at the funding
    slot being judged, never at the time a screen is opened. An old balance means cash is unknown, not short.
  - `commitment_list` — effective_at, status `complete`: an attestation that the list of competing commitments is
    complete. Needed within the same 24 h (demo policy) of the slot; missing → cash unknown. (Original:
    `reservation_snapshot`.)
  - `cash_support` — slot, amount SGD, status `documented`, expires_at: documented own cash for a later slot,
    after the floor and all commitments. When the Friday view judges the Monday slot, Friday's balance is **not**
    Monday cash; only a cash_support live at the Monday instruction and ≥ required + reservation cost counts.
    (Original: `own_cash_floor_sgd`.)
  - `receivable` — amount SGD, status `forecast` | `settled`; effective_at = when usable. Only `settled`
    and effective_at ≤ slot instruction time adds to usable cash. Forecast never does.
    A `settled` receivable dated after its known_at is treated as a forecast (warning).
  - `commitment` — amount SGD, competing obligation (concurrent payout); effective_at = when it leaves the account.
    Subtracted once. A commitment due at or before the balance time is already reflected in that balance and is
    not deducted again (shown in the cash explanation).
  - `cash_floor` — amount SGD, policy minimum balance; subtracted.
  - `capacity` — slot, amount USD, status `reserved` | `confirmed` | `indicative`, **expires_at required**.
    Feasible only if reserved/confirmed, amount ≥ obligation, live at the instruction and confirmed through the
    release checkpoint (ending earlier → unknown).
  - `forward_terms` — slot monday, rate, bp, status `agreed`, **expires_at required**; known on Friday = a binding
    later option (subject to verification).
  - `reservation_cost` — slot monday, amount SGD: what the importer pays the provider to hold the later terms and
    capacity. Scenario assumption (pre-agreed fixture only; the original does not model it). It must be covered by
    the cash support on Friday, is listed as a review question on Friday, and is subtracted in the retrospective
    comparison. It is not in the reference case.
  - `fallback` — status `documented`, amount (USD) ≥ obligation, currency USD, expires_at ≥ the deadline.
  - `service_bound` — amount = hours (simulated last-mile bound, release → usable credit).
  - `beneficiary_credit` — effective_at = observed usable credit (absent in all samples → "not observed"). When
    visible it overrides the simulated bound in the delivery check ("Observed beneficiary credit"; after the
    deadline → fail "observed late").
- `currency`: `USD` or `SGD` as applicable; empty for non-money kinds.
- `obligation` amount must be > 0. A `quote` or agreed `forward_terms` without `rate` or `bp` gives pricing
  unknown (a missing spread is never assumed to be 0).
- Fees: both a `rail` and a `processing` fee must be live for the slot; a missing type → fees unknown (never
  cheaper). The funding cutoff is **exclusive**: an instruction at or after the cutoff fails, also in retro.
- Mandatory evidence missing, stale (expired before needed) or contradictory (two visible records of the same
  mandatory kind+slot with different values) → that check is **unknown**, never assumed.

## Engine API (Python)
`funding-replay/engine/replay.py`:
- `load_events(text: str) -> (events, errors)`; errors are `[{row, column, message}]` (row = 1-based CSV line
  number incl. header line 1).
- `evaluate(events, decision_time: str, funding_rate_pct: Decimal) -> dict` — pure, deterministic.
- `SCENARIOS` sample fixtures loaded from `funding-replay/fixtures/*.csv`.

## HTTP API (stdlib `http.server`, JSON)
- `GET /` → `app/static/index.html`; `GET /static/...`.
- `GET /api/meta` → `{label, scenarios:[{id,name,description,synthetic:true}], decision_times:[...],
  default_rate_pct:"8", current_dataset:"sample"|"imported"}`.
- `POST /api/evaluate` body `{scenario, decision_time, funding_rate_pct}` → evaluation (below).
- `POST /api/import` body = raw CSV text (≤ 1 MB) → `{ok:true, scenario:"imported"}` or `400 {ok:false,
  errors:[{row,column,message}]}`. On error the last good dataset is kept unchanged.
- `POST /api/reset` → restores the sample dataset; removes the imported scenario.
- Content-Type JSON; reject other methods; no CORS; 127.0.0.1 only.

## Evaluation JSON (the UI renders exactly this)
```
{
 "label": "Synthetic replay — no funds move.",
 "engine": "reconstructed",
 "scenario": {"id","name","description","synthetic": true},
 "decision_time": {"id","label","as_of_sgt":"Fri 13 Nov 2026, 15:00 SGT","as_of_ny":"Fri 13 Nov 2026, 02:00 EST",
                  "note": null | "Counterfactual: assumes the SGD had been held after Friday. On Friday’s evidence the decision was: <Friday headline>." (monday) | "Hindsight: each slot is judged only on records known by its own instruction time (…)." (retro)},
 "payment": {"net_usd":"100,000.00","deadline_sgt":"Wed 18 Nov 2026, 23:00 SGT","deadline_ny":"Wed 18 Nov 2026, 10:00 EST",
             "release_sgt":"Wed 18 Nov 2026, 15:00 SGT","release_ny":"...", "beneficiary_credit":"not observed"},
 "decision": {"state": "KEEP_FRIDAY|MANUAL_REVIEW|INSUFFICIENT_CASH|DEADLINE_AT_RISK|MONDAY_FEASIBLE|MONDAY_UNAVAILABLE|HINDSIGHT|NO_DECISION|NEED_NEWER_BALANCE",
              "balance_check": null | {"slot","slot_sgt","problem":"stale|missing","balance_id","balance_sgt","balance_known_sgt","age_at_slot":"73 h 00 min","expired_sgt","limit":"24 h before the funding slot (demo policy)"},
              "headline": "Keep Friday’s funding window",
              "reason": "one plain-English sentence",
              "binding_constraint": "plain English",
              "cash_after_commitments": {"amount":"SGD 150,000.00","explain":"settled 200,000.00 − floor 50,000.00 − commitments 0.00"} | null,
              "missing_evidence": ["..."],
              "next_actions": ["what the operator can do with their existing bank/provider"],
              "actionable_on_friday": true|false},
 "options": [ {"slot":"friday", "label":"Fund Fri 13 Nov 15:00 SGT", "status":"feasible|infeasible|unknown|passed|not_evidenced",
               "checks":[{"name","state":"ok|fail|unknown","detail","record_ids":[...]}],
               "required_sgd": "SGD 135,372.50" | null, "principal_sgd": "SGD 135,000.00" | null,
               "restricted_days": 5 | null, "sgd_days": "675,000" | null, "avg_restricted_30d": "SGD 22,500.00" | null,
               "funding_cost_sgd": "SGD 147.95" | null,
               "funding_cost_formula": "135,000.00 × 8% × 5 / 365 = 147.95" | null,
               "fees_sgd": "SGD 372.50" | null,
               "cash_headroom_sgd": "SGD 14,627.50" | null},
              {"slot":"monday", ...} ],
 "comparison": null | {"available": true|false, "withheld_reason": "...",
               "days": {"friday":5,"monday":2}, "sgd_days_less": "405,000",
               "avg_restricted_less_30d":"SGD 13,500.00",
               "carry_reduction": "SGD 88.77", "extra_processing": "SGD 10.00",
               "reservation_cost": "SGD 25.00" | null,
               "net_benefit_before_subscription": "SGD 78.77",
               "formula": "135,000.00 × 8% × (5 − 2) / 365 = 88.77; 88.77 − 10.00 = 78.77",
               "framing": "Hindsight only. Not available to the operator on Friday …",
               "zero_rate_note": "If retained cash earns nothing and avoids no borrowing, waiting costs SGD 10.00 more.",
               "risk_note": "A missed deadline can swamp either figure." | null},
 "assumption": {"funding_rate_pct":"8", "kind":"assumption", "text":"Hypothetical annual rate on retained cash (avoided borrowing or incremental return). Not historical evidence."},
 "evidence": [ {"record_id","kind","slot","fact":"establishes text","effective_sgt","known_sgt","expires_sgt"|"—","status","used_by":["friday: quote", ...]} ],
 "warnings": ["..."]
}
```
Rules for the comparison: only when **both** options are feasible under evidence visible at T, with the same
net amount and deadline. **In the `friday` view the comparison is always null** (v2, as in the original): even under `MANUAL_REVIEW` no modelled benefit is shown; the reservation cost appears only as a review question. In `retro` view, if Friday's view did not support waiting, `framing` must say the Friday decision
stands and the difference was not actionable on Friday (`actionable_on_friday:false`). Changing
`funding_rate_pct` changes only `funding_cost_sgd`, `funding_cost_formula`, `carry_reduction`, `net_benefit…` and
`formula`; it must
never change any feasibility, status, decision state or check. `reservation_cost` is the Monday reservation cost
(subtracted in `net_benefit…` and shown in `formula`), null when none is on file. An option whose status is
`not_evidenced` returns null for every numeric field (`required_sgd` … `cash_headroom_sgd`, incl.
`restricted_days` and `funding_cost_formula`): only its status and checks.

Hindsight and counterfactual rules (challenger fixes, v1.1):
- **Retro** judges each slot only on records known by that slot's own instruction time (Friday slot: ≤ Fri 15:00
  SGT; Monday slot: ≤ Mon 15:00 SGT), not everything known by Thu 19 Nov. If either slot is not feasible on its
  own-time evidence, the comparison is withheld. An observed `beneficiary_credit` visible at retro still applies
  to both slots' delivery check. `framing` states each late record kind's actual first-known time.
- The comparison is also withheld if the two slots' FX rates or principals differ ("Rates differ between slots;
  the difference would mix a market move with timing."). `extra_processing` is the fee difference only. No text
  ever says waiting "saves".
- Retro headlines: available and not actionable on Friday → "In hindsight, Monday tied up cash for fewer days —
  waiting was not supported on Friday"; available after a Friday MANUAL_REVIEW → "Hindsight comparison: a
  reviewed Monday option existed on Friday"; otherwise "Hindsight comparison withheld".
- **Monday** is a counterfactual: `decision_time.note` says so and quotes the Friday headline. Monday headlines
  say "would have been". Monday `next_actions` never instruct funding unless Friday's state was MANUAL_REVIEW
  (then "If you held the funds after review: confirm …"), and always include "If the Friday instruction was
  kept, do not instruct the same payment again on Monday."
- Fixture `scenarios.json` names and descriptions are Friday-safe: they state no fact first known after Fri 15:00.
- The delivery check is named "Simulated delivery bound (not observed)" (or "Observed beneficiary credit").
- The server answers any internal error with labelled JSON 500 `{ok:false, error}`, never a dropped connection.

## Expected outcomes (acceptance; engine tests must assert these)
| scenario id | friday | monday | retro |
|---|---|---|---|
| `reference` | KEEP_FRIDAY ("Keep Friday’s funding window"); Monday `not_evidenced`; no comparison; nothing from Monday records | MONDAY_FEASIBLE | HINDSIGHT; days 5 vs 2; 405,000 SGD-days; carry 88.77; extra 10.00; net 78.77 at 8%; −10.00 at 0%; beneficiary credit not observed; `actionable_on_friday:false` |
| `preagreed` | MANUAL_REVIEW ("Manual review before waiting"); terms to verify listed; reservation cost shown; no comparison; reservation cost SGD 25.00 is a review question; needs SUP-MON cash support | MONDAY_FEASIBLE | HINDSIGHT (actionable_on_friday true-but-review: framing says reviewed option existed) |
| `delayed_receivable` | INSUFFICIENT_CASH (Friday settled usable 130,000.00 < 135,372.50; forecast receipt not counted) | INSUFFICIENT_CASH: usable SGD 130,000.00 vs required SGD 135,382.50, short SGD 5,382.50 | comparison withheld: Tuesday receipt cannot finance Monday’s instruction |
| `concurrent_payout` | INSUFFICIENT_CASH after subtracting the concurrent payout | INSUFFICIENT_CASH | withheld |
| `stale_quote` | KEEP_FRIDAY (Monday quote expires before Monday instruction → stale → unknown) | missing valid quote → NO_DECISION / unknown | withheld (Monday quote unknown) |
| `closed_day` | KEEP_FRIDAY (Monday closed → infeasible) | MONDAY_UNAVAILABLE | withheld |
| `low_capacity` | KEEP_FRIDAY | Monday infeasible: capacity USD 60,000.00 < 100,000.00 | withheld |
| `stale_balance` | KEEP_FRIDAY | NEED_NEWER_BALANCE ("We need a newer bank balance to assess Monday’s funding."; CASH-FRI Fri 14:00 is 73 h 00 min old at Mon 15:00) | withheld (Monday balance stale at its own slot) |
| `slow_credit` | DEADLINE_AT_RISK (release 15:00 + 9 h simulated bound = Thu 00:00 SGT > 23:00) both slots | DEADLINE_AT_RISK | withheld |
