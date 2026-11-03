# Funding decision replay: build contract (v1, 3 Nov 2026)

This is the binding contract between the engine owner (Python), the interface owner (HTML/JS) and the
challenger. The lead (tech-lead) owns the working demo. Source of truth for the product: the Funding
Decision Whitepaper, the Founder Decision Memo and the Two-Week Validation Plan (3 Nov 2026).

**Missing inputs (named, not invented).** The whitepaper says a separate local Python experiment
(`replay.py`, `events.csv`, `test_replay.py`, README, `friday.html`, `demo.html`, `preagreed.html`,
`delayed.html`) exists with 22 passing tests. **None of those files were supplied to this session**:
they're not in the uploads, on disk or on any repo branch. So:
- The engine is **reconstructed** from the whitepaper's text and the founder's stated walkthroughs. It is
  labelled "reconstructed engine" in the README and the UI footer.
- Every fixture is **synthetic** and labelled so. No customer data, no real provider terms.
- Baseline tests run: 0 (none supplied). Say so in the README and handoff.

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
- `amount`, `rate`, `bp`: decimal strings or empty; never parsed as float.
- `slot`: `friday`, `monday`, or empty (applies to both).
- `kind` (and what it establishes):
  - `obligation` — amount (USD net), effective_at = spendable-USD deadline.
  - `release_checkpoint` — effective_at = common provider release time.
  - `funding_slot` — slot, effective_at = instruction time, expires_at = cutoff.
  - `calendar` — slot, status `open` | `closed` (business day for that slot).
  - `quote` — slot, rate (SGD per USD), bp (FX spread), expires_at = quote expiry. For the Monday slot, a
    quote known on Friday is only usable if it is still live at the Monday instruction time.
  - `fee` — slot (or empty = both), amount SGD, establishes e.g. "rail fixed charge" / "processing".
  - `cash_snapshot` — amount SGD, status `settled`, effective_at = balance time.
  - `receivable` — amount SGD, status `forecast` | `settled`; effective_at = when usable. Only `settled`
    and effective_at ≤ slot instruction time adds to usable cash. Forecast never does.
  - `commitment` — amount SGD, competing obligation (concurrent payout) due before the deadline; always
    subtracted from usable cash.
  - `cash_floor` — amount SGD, policy minimum balance; subtracted.
  - `capacity` — slot, amount USD, status `reserved` | `confirmed` | `indicative`. Feasible only if
    reserved/confirmed and amount ≥ obligation.
  - `forward_terms` — slot monday, rate, status `agreed`, expires_at; known on Friday = a binding later
    option (subject to verification).
  - `reservation_cost` — slot monday, amount SGD: what reserving the later slot costs.
  - `fallback` — status `documented`; an independent fallback route if Monday fails.
  - `service_bound` — amount = hours (simulated last-mile bound, release → usable credit).
  - `beneficiary_credit` — effective_at = observed usable credit (absent in all samples → "not observed").
- `currency`: `USD` or `SGD` as applicable; empty for non-money kinds.
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
 "decision_time": {"id","label","as_of_sgt":"Fri 13 Nov 2026, 15:00 SGT","as_of_ny":"Fri 13 Nov 2026, 02:00 EST"},
 "payment": {"net_usd":"100,000.00","deadline_sgt":"Wed 18 Nov 2026, 23:00 SGT","deadline_ny":"Wed 18 Nov 2026, 10:00 EST",
             "release_sgt":"Wed 18 Nov 2026, 15:00 SGT","release_ny":"...", "beneficiary_credit":"not observed"},
 "decision": {"state": "KEEP_FRIDAY|MANUAL_REVIEW|INSUFFICIENT_CASH|DEADLINE_AT_RISK|MONDAY_FEASIBLE|MONDAY_UNAVAILABLE|HINDSIGHT|NO_DECISION",
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
               "funding_cost_sgd": "SGD 147.95" | null, "fees_sgd": "SGD 372.50" | null,
               "cash_headroom_sgd": "SGD 14,627.50" | null},
              {"slot":"monday", ...} ],
 "comparison": null | {"available": true|false, "withheld_reason": "...",
               "days": {"friday":5,"monday":2}, "sgd_days_less": "405,000",
               "avg_restricted_less_30d":"SGD 13,500.00",
               "carry_reduction": "SGD 88.77", "extra_processing": "SGD 10.00",
               "net_benefit_before_subscription": "SGD 78.77",
               "formula": "135,000.00 × 8% × (5 − 2) / 365 = 88.77; 88.77 − 10.00 = 78.77",
               "framing": "Hindsight only. Not available to the operator on Friday …",
               "zero_rate_note": "If retained cash earns nothing and avoids no borrowing, waiting costs SGD 10.00 more."},
 "assumption": {"funding_rate_pct":"8", "kind":"assumption", "text":"Hypothetical annual rate on retained cash (avoided borrowing or incremental return). Not historical evidence."},
 "evidence": [ {"record_id","kind","slot","fact":"establishes text","effective_sgt","known_sgt","expires_sgt"|"—","status","used_by":["friday: quote", ...]} ],
 "warnings": ["..."]
}
```
Rules for the comparison: only when **both** options are feasible under evidence visible at T, with the same
net amount and deadline. In `friday` view it is present only for `MANUAL_REVIEW` and is framed
"conditional on verifying the forward terms; not a recommendation", with reservation cost subtracted and
shown. In `retro` view, if Friday's view did not support waiting, `framing` must say the Friday decision
stands and the difference was not actionable on Friday (`actionable_on_friday:false`). Changing
`funding_rate_pct` changes only `funding_cost_sgd`, `carry_reduction`, `net_benefit…` and `formula`; it must
never change any feasibility, status, decision state or check.

## Expected outcomes (acceptance; engine tests must assert these)
| scenario id | friday | monday | retro |
|---|---|---|---|
| `reference` | KEEP_FRIDAY ("Keep Friday’s funding window"); Monday `not_evidenced`; no comparison; nothing from Monday records | MONDAY_FEASIBLE | HINDSIGHT; days 5 vs 2; 405,000 SGD-days; carry 88.77; extra 10.00; net 78.77 at 8%; −10.00 at 0%; beneficiary credit not observed; `actionable_on_friday:false` |
| `preagreed` | MANUAL_REVIEW ("Manual review before waiting"); terms to verify listed; reservation cost shown; comparison conditional | MONDAY_FEASIBLE | HINDSIGHT (actionable_on_friday true-but-review: framing says reviewed option existed) |
| `delayed_receivable` | INSUFFICIENT_CASH (Friday settled usable 130,000.00 < 135,372.50; forecast receipt not counted) | INSUFFICIENT_CASH: usable SGD 130,000.00 vs required SGD 135,382.50, short SGD 5,382.50 | comparison withheld: Tuesday receipt cannot finance Monday’s instruction |
| `concurrent_payout` | INSUFFICIENT_CASH after subtracting the concurrent payout | INSUFFICIENT_CASH | withheld |
| `stale_quote` | KEEP_FRIDAY (Monday quote expires before Monday instruction → stale → unknown) | missing valid quote → NO_DECISION / unknown | withheld (Monday quote unknown) |
| `closed_day` | KEEP_FRIDAY (Monday closed → infeasible) | MONDAY_UNAVAILABLE | withheld |
| `low_capacity` | KEEP_FRIDAY | Monday infeasible: capacity USD 60,000.00 < 100,000.00 | withheld |
| `slow_credit` | DEADLINE_AT_RISK (release 15:00 + 9 h simulated bound = Thu 00:00 SGT > 23:00) both slots | DEADLINE_AT_RISK | withheld |
