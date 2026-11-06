# Pilot operating desk — shared contract (integration owner: lead)

Status: binding for every agent. Change it only through the integration owner. **Simulated / sandbox activity is
never described as live execution.** No real credit, no held funds, no private keys, no real transfers.

## 0. Layout and ownership (do not edit another owner's files)
```
funding-replay/pilot/                     Python 3.9+ standard library only (sqlite3, hashlib, hmac, http.server)
  __init__.py            lead
  money.py               BACKEND   integer minor units, currency table, parse/format (no float anywhere)
  db.py                  BACKEND   connect(), migrate(), tx() with BEGIN IMMEDIATE, clock
  migrations/NNNN_*.sql  BACKEND   forward-only, numbered; schema_migrations table
  domain.py              BACKEND   pure: fold events -> CaseState; assess routes; allocation; identities; actions
  commands.py            BACKEND   command handlers: permissions, idempotency, versioning, writes in one tx
  auth.py                BACKEND   users, scrypt hashes, sessions, CSRF, roles, login throttle
  server.py              BACKEND   HTTP JSON API + serves pilot/static; security headers; wires DATA modules
  cli.py                 BACKEND   migrate | seed | create-org | create-user | serve | check (calls ops.* for backup/restore)
  imports.py             DATA      parse_cases_csv(text, *, funding_currency_default) -> (rows, errors)
  connector.py           DATA      PayoutConnector protocol; SandboxConnector; signing/verification of events
  export.py              DATA      render_case_history(case_view, events, fmt) -> (bytes, content_type, filename)
  ops.py                 DATA      backup(db_path, dest), restore(src, db_path), health(conn) ; RECOVERY.md content
  static/                UI        index.html, app.js, app.css (same-origin, no CDN), no amounts computed in JS
funding-replay/tests/pilot/          test_* owned by whoever owns the module under test; browser: tests/browser/pilot.cjs (UI)
funding-replay/deploy/pilot/         Dockerfile, fly.toml / render.yaml (lead)
```
The public mentor demo (`app/static/lifecycle.*`, `engine/`, `tools/export_site.py`, the Vercel deploy repo) is
**frozen** in this build. Do not edit it.

## 1. Environments
`PILOT_ENV` = `dev` | `test` | `pilot`. `PILOT_DB` = path to the SQLite file. `PILOT_SECRET` = server secret (HMAC for
sandbox events; required in `pilot`). In `pilot`: cookies are `Secure`, seeding synthetic users is refused unless
`--synthetic` is passed, and `/api/health` reveals only `{ok, db, migrations}`. The public demo is a separate static
site and never talks to this server. No pilot data, credentials or real names appear in any static export, test
fixture, screenshot or log line (log case ids and event types, never party names or amounts).

## 2. Money
- Stored as integer minor units plus an ISO currency: `amount_minor INTEGER, currency TEXT`. Currency exponents:
  SGD 2, USD 2, EUR 2, GBP 2, HKD 2, JPY 0. Unknown currency → validation error.
- `money.parse("48,250.00", "USD") -> Money(4825000, "USD")`. Reject floats, exponents, too many decimals and
  negatives where not allowed. Adding or comparing different currencies raises `CurrencyMismatch`.
- Display: `"USD 48,250.00"`. The JS never adds, subtracts or compares amounts: every figure comes from the server.
- FX is not converted by Clearline. A case has a **payout amount** (what the supplier must receive, e.g. USD) and a
  **funding amount** (what must be funded, in the facility/funding currency, e.g. SGD), taken from an
  operator-entered quote reference. Both are shown with their currency.

## 3. Time
All instants are stored UTC ISO-8601 (`2026-11-18T15:00:00Z`). Every case stores its `deadline_tz` (IANA, e.g.
`Asia/Singapore`). Display shows local time plus zone abbreviation, plus UTC on hover/title. `db.now()` reads an
injectable clock (`PILOT_CLOCK=2026-12-01T09:00:00Z` or `db.set_clock()` in tests). Every event has
`effective_at` (when it happened, supplied or defaulted to now) and `known_at` (server time it was recorded; never
supplied by the client). Route assessment at time T uses only records with `known_at <= T`.

## 4. Tenancy, auth, roles
- Tables carry `org_id`. Every query is scoped by the session's org. A case id from another org returns **404**
  (never 403) on read, search, export, evidence download and commands.
- Users are created by CLI only (no self sign-up). Passwords: `hashlib.scrypt` (n=2**14, r=8, p=1, 16-byte salt).
  Sessions: random 32-byte token in cookie `cl_session` (HttpOnly, SameSite=Strict, Secure in pilot), stored
  hashed, 12 h idle expiry. CSRF: every mutating request carries header `X-CSRF-Token` equal to the session's token
  (returned by `/api/login` and `/api/me`). Login throttle: 5 failures per email per 15 min → 429.
- Roles: `operator`, `reviewer`, `viewer`. (`admin` is CLI-only.) Matrix:

| Command | operator | reviewer | viewer |
|---|---|---|---|
| create/import case, add evidence/observation, supersede observation, add note, assign/hand off | ✓ | ✓ | – |
| select_route A/B, request_advance, record_prefunding, record_draw, instruct_payout, record_delivery, query_payout_status, record_customer_receipt, record_repayment, match_repayment, resolve_duplicate, close_case | ✓ | – | – |
| approve_and_reserve, decline, request_evidence, release_reservation, authorize_draw, return_unmatched, reverse_match, close_with_exception, authorize_reinstruction | – | ✓ | – |
| read, search, queue, export | ✓ | ✓ | ✓ |

  Four-eyes: the reviewer who approves must not be the user who requested. Enforced on the server.

## 5. Records (migration 0001)
`orgs(id, name)`, `users(id, org_id, email UNIQUE, name, role, password_hash, created_at, disabled)`,
`sessions(token_hash PK, user_id, csrf, created_at, last_seen)`, `login_failures(email, at)`,
`facilities(id, org_id, name, currency, limit_minor, fee_flat_minor, fee_bps, allocation ('fees_first'|'principal_first'),
 status ('active'|'suspended'), suspension_policy ('block_draws'|'honour_existing'|'unset'), policy_version,
 funding_account_start_minor, balance_max_age_hours (default 24), repayment_days, reservation_hours, payout_lead_hours)`,
`cases(id TEXT 'CL-YYYY-NNNNN' per org, org_id, created_by, owner_user_id, status, version INTEGER, created_at,
 importer, supplier, payout_minor, payout_currency, funding_minor, funding_currency, quote_ref,
 deadline_at, deadline_tz, window_a_at, window_a_cutoff_at, later_permitted INTEGER, contract_ref,
 window_b_at, window_b_cutoff_at, facility_id, reference)`,
`events(id, org_id, case_id, seq, type, payload JSON, effective_at, known_at, actor_user_id, actor_role,
 provenance ('operator_entered'|'external_record'|'provider_event'|'sandbox_simulation'|'system'),
 reason, corrects_event_id, idempotency_key, UNIQUE(case_id, seq))` — append-only (no UPDATE/DELETE; enforce with
 triggers),
`evidence(id, org_id, case_id, event_id, filename, content_type, size, sha256, data BLOB, provenance, known_at)`
 — max 5 MB, types pdf/png/jpeg/csv/txt,
`reservations(id, org_id, facility_id, case_id, amount_minor, status ('active'|'consumed'|'released'|'expired'),
 expires_at, created_at)` with **partial unique index: one active-or-consumed reservation per case**,
`draws(id, org_id, case_id, facility_id, principal_minor, fee_minor, effective_at, UNIQUE(case_id))`,
`payouts(id, org_id, case_id, attempt INTEGER, route ('manual'|'sandbox'), external_ref, status, UNIQUE(case_id, attempt),
 UNIQUE(org_id, route, external_ref))`,
`connector_events(org_id, provider_event_id UNIQUE per org, payout_id, kind, occurred_at, received_at, applied INTEGER)`,
`idempotency(org_id, key, command, request_hash, response JSON, PRIMARY KEY(org_id, key))`.
The event log is the source of truth for the case view; the constraint tables exist so the **database** rejects a
second reservation/draw/payout attempt even if application checks race.

## 6. Commands
`POST /api/cases/{id}/commands` with JSON `{type, idempotency_key (client UUID, required), expected_version, ...}`.
- Same `idempotency_key` + same body → the stored response, no new event. Same key, different body → 409
  `idempotency_conflict`. `expected_version` ≠ current → 409 `stale_version` ("Case changed since you loaded it").
- Every command runs in one `BEGIN IMMEDIATE` transaction: check permission → load case → check preconditions with
  `domain` → insert events → update constraint tables → bump version → store idempotency → commit.
- Errors: `{error: {code, message, field?}}` with 400/401/403/404/409/413/422/429. Messages say what to do next.

| type | key params | effect / rule |
|---|---|---|
| `add_observation` | `kind`: `balance` {amount, currency, as_of, source} · `commitment` {amount, currency, due_at, description} · `cash_support` {amount, currency, effective_at, document_ref} · `expected_receipt` {amount, currency, expected_at, payer} · `terms` {later_permitted, contract_ref} ; `provenance`, optional `evidence_id` | provenance `external_record` only if an evidence file is linked, else `operator_entered` |
| `supersede_observation` | `event_id`, replacement fields, `reason` | correction event linked by `corrects_event_id`; old record shown struck through, never deleted |
| `select_route` | `route` A or B, `reason` | only if that route is feasible now |
| `request_advance` | `reason` | route C; snapshot of the assessment + evidence ids |
| `approve_and_reserve` | `reason` | reviewer ≠ requester; route C feasible at approval time; **atomic capacity check** (§7); stores policy_version, fee, due date, reservation expiry |
| `decline` / `request_evidence` | `reason` / `what` | nothing reserved; request_evidence returns case to operator |
| `release_reservation` | `reason` | active reservation → released |
| (sweep) `expire_reservation` | system | lazily on any read/command when `now >= expires_at` and not drawn |
| `record_draw` | `effective_at`, `reference` | needs active reservation; facility suspended → `block_draws`: refuse; `honour_existing`: allow; `unset`: refuse with `referred` until reviewer `authorize_draw` |
| `record_prefunding` | amount, currency, effective_at, reference | routes A/B: importer's funds received by the provider (must equal funding amount, same currency) |
| `instruct_payout` | `route` manual {external_ref, evidence_id?} or sandbox; amount = payout amount | needs draw (C) or prefunding (A/B); **one live attempt**; a new attempt only after `failed`/`returned` **and** reviewer `authorize_reinstruction`; never after `unknown` |
| `record_delivery` | `status` accepted / credited / failed / returned / unknown, `effective_at`, `reference`, `location`, `evidence_id?` | manual route; monotonic: credited beats accepted; out-of-order accepted after credited is stored, not applied |
| `query_payout_status` | – | sandbox: asks the connector with the **same** reference; never re-submits |
| `record_customer_receipt` | amount, currency, effective_at, reference | the importer's own incoming money; **never** reduces provider debt |
| `record_repayment` | amount, currency, effective_at, bank_ref | creates an unallocated item; same bank_ref + amount + date as an existing item → `possible_duplicate` (not counted until `resolve_duplicate`) |
| `match_repayment` | `repayment_id` | facility allocation (fees first default); other currency → unmatched (wrong currency); excess → unmatched (excess) |
| `return_unmatched` | `item_id`, `reason`, `reference` | reviewer; never reduces what is owed |
| `reverse_match` | `match_id`, `reason` | reviewer; reversal event restores amounts |
| `add_note` / `assign_owner` | `text` / `user_id`, `note` | handoff recorded in history |
| `close_case` | – | only if delivery `credited` AND nothing owed AND nothing unallocated/unmatched/duplicate-pending |
| `close_with_exception` | `disposition` (e.g. `write_off_referred`, `supplier_paid_outside`, `cancelled_before_payout`), `reason` | reviewer only; amounts still owed stay on record and are shown |

## 7. Capacity (the atomic part)
Inside `BEGIN IMMEDIATE`: `headroom = limit − Σ active reservations − Σ principal outstanding (all cases on the
facility)`; `funding_cash = funding_account_start − Σ active reservations − Σ principal outstanding`. Reserve only if
both ≥ funding amount; else 409 `insufficient_capacity` naming which one is short. Identities, checked after every
command and shown on the case and facility: `limit = available + reserved + principal_outstanding`;
`drawn = principal_repaid + principal_outstanding`; `fees_charged = fees_repaid + fees_outstanding`;
`Σ repayments received (per currency) = matched_fees + matched_principal + unmatched + unallocated + returned +
duplicates_pending`; customer receipts are excluded from all of them.

## 8. Route assessment (`domain.assess(case, observations, facility, now)`)
Per route: `status` feasible | infeasible | unknown, `whose_money`, `needed_at`, `amount`, `cost` (A/B: "Not
modelled — importer's cost of cash"; C: facility fee), `risk_bearer`, `capacity_ok`/`cash_ok` (C), `missing[]`,
`disqualifiers[]`, `evidence_ids[]`.
- A: `now < window_a_cutoff_at`; latest balance in funding currency with `known_at <= now`, age at window ≤
  `balance_max_age_hours` (exactly the limit is fresh); usable = balance − commitments due ≤ cutoff not already in
  the balance; usable ≥ funding amount. Missing/stale/other-currency balance → unknown (never "short").
- B: `later_permitted` true (else infeasible: "Contract fixes the funding date"); `now < window_b_cutoff_at`; cash
  support in funding currency, ≥ amount, effective ≤ window_b_at, known now; `window_b_at + payout_lead_hours ≤
  deadline`. Forecast/expected receipts never count.
- C: facility exists, active (suspended → unavailable), headroom and funding cash ≥ amount, fresh importer balance on
  record, `now + payout_lead_hours ≤ deadline`, reservation expiry before deadline.
- "No feasible route" is a valid outcome. The decision text never recommends waiting on information learned later.

## 9. Read models (all JSON from the server; the UI renders them)
- `GET /api/me` → `{user:{id,name,email,role}, org:{id,name}, csrf, env}`.
- `GET /api/queue` → `{generated_at, sections:[{key, title, rows:[{case_id, importer, supplier, payout, funding,
  deadline_local, owner, reason, next_action:{label, command?, role}, due_at, severity}]}]}`, keys:
  `awaiting_review`, `evidence_requested`, `approaching_cutoff` (≤ 24 h), `uncertain_delivery`, `overdue_repayment`,
  `unmatched_cash`, `my_open`, `all_open`.
- `GET /api/cases?q=` → search by id, importer, supplier, reference (org-scoped).
- `GET /api/cases/{id}` → `case_view`: `{id, version, status, header{importer, supplier, payout, funding, quote_ref,
  deadline_local, deadline_tz, deadline_utc, owner, reference}, decision{headline, tone, binding_constraint,
  next_action, owner_role}, supplier_panel{status, label, last_evidenced, location, provenance, attempt},
  exposure_panel{status 'none'|'reserved'|'outstanding'|'ended', reserved, principal_outstanding, fees_outstanding,
  total_outstanding, due_at_local, owed_by, owed_to}, routes[3], evidence[], timeline[], collections{expected_receipt,
  customer_receipts[], repayments[{id, amount, status, allocation{fees, principal, unmatched}, bank_ref}],
  unmatched[]}, identities[{name, ok, detail}], actions[{type, label, enabled, disabled_reason, role, params[]}]}`.
  Labels to use: "Request advance", "Approve and reserve capacity", "Decline", "Request evidence", "Record draw",
  "Instruct payout", "Record provider acceptance", "Record beneficiary credit", "Record payout failure",
  "Record customer receipt (importer's account)", "Record repayment to provider", "Match repayment",
  "Return unmatched amount", "Close case". A reservation is never called a draw; acceptance never "paid";
  a customer receipt never "repayment".
- `GET /api/cases/{id}/export?format=json|csv|html` → full history: every event with actor, role, effective_at,
  known_at, provenance, reason, corrections, plus totals and identities.
- `GET /api/facilities` → per facility: limit, reserved, principal outstanding, available, funding cash, status,
  suspension policy, identity check.
- `GET /api/health` → `{ok, db, migrations, env}` (no secrets).

## 10. DATA module interfaces (pure where possible; BACKEND wires them)
- `imports.parse_cases_csv(text: str) -> (rows: list[dict], errors: list[str])`. Columns: `importer, supplier,
  payout_amount, payout_currency, funding_amount, funding_currency, quote_ref, deadline_local, deadline_tz,
  window_a_local, window_a_cutoff_local, later_permitted, contract_ref, window_b_local, window_b_cutoff_local,
  expected_receipt_amount, expected_receipt_local, balance_amount, balance_as_of_local, balance_source, reference`
  (local times in `deadline_tz`). Each error is `"Row N, column C: message"`. If any error, `rows` is empty
  (all-or-nothing). Output row dict uses the same keys as the `POST /api/cases` body (§11) with UTC times and
  amounts as strings.
- `connector.PayoutConnector`: `submit(payout_ref, amount_minor, currency, beneficiary) -> {status: 'accepted'|'timeout'|'rejected', provider_ref, detail}`;
  `get_status(provider_ref) -> list[event]`. `SandboxConnector(secret, scenario='normal'|'timeout_then_accept'|'fail'|'return'|'duplicate_events'|'out_of_order')`
  stores its own state in table `sandbox_payouts` (DATA-owned migration `0100_sandbox.sql`), and emits events
  `{provider_event_id, provider_ref, kind: accepted|credited|failed|returned, occurred_at}` signed with
  `connector.sign(secret, body)` → hex HMAC-SHA256; `connector.verify(secret, body, sig)`. Every sandbox event is
  labelled provenance `sandbox_simulation` and the UI shows "Sandbox — not a live payment".
- `export.render_case_history(case_view: dict, events: list[dict], fmt: 'json'|'csv'|'html') -> (bytes, content_type, filename)`.
- `ops.backup(db_path, dest_path)` (sqlite3 online backup + integrity_check + sha256 manifest),
  `ops.restore(src_path, db_path)` (refuses if src fails integrity_check; keeps the replaced file as `.pre-restore`),
  `ops.health(conn) -> dict`.

## 11. `POST /api/cases` body
`{importer, supplier, payout_amount, payout_currency, funding_amount, funding_currency, quote_ref, deadline_at,
deadline_tz, window_a_at, window_a_cutoff_at, later_permitted, contract_ref, window_b_at?, window_b_cutoff_at?,
facility_id?, reference?, observations?: [...add_observation params], idempotency_key}` → `case_view`. Validation
errors list every bad field. `POST /api/cases/import` `{csv, dry_run}` → `{created:[ids]}` or `{errors:[...]}`;
nothing is created when any row fails.

## 12. Acceptance (pilot)
Blank workspace, new fictional invoice, no code edits: operator creates + evidences + submits; a different
reviewer approves/declines; restart keeps everything; reserve and draw once; external payout without implying
credit; delivery recorded while provider balance outstanding; customer receipt doesn't reduce debt; partial match
shows the right remainder, balance settles; close; export explains who did what and why. Plus: cross-org isolation
(read/search/export/mutate by exact id → 404), concurrent reservations at the DB boundary (threads and processes),
duplicate/delayed connector events never create a second draw or payout, stale balance / missed cutoff /
unavailable facility / fixed contract date make routes infeasible, wrong-currency repayment returnable and never
reduces principal, public demo and its deep links still work.

## 13. Brief v2 additions (6 Nov 2026 build brief) — binding
Ownership this round: **BACKEND** owns all `pilot/*.py` (incl. `imports.py`, `export.py`) and `pilot/migrations/0003_*`;
**UI** owns `pilot/static/*` and `tests/browser/pilot.cjs`; **lead** owns `tests/pilot/test_scenarios.py`,
`tests/browser/pilot_lead_journey.cjs`, docs. Migrations stay forward-only and must upgrade a database created at
`d94177e` (migrations 0001, 0002, 0100 applied) as well as a fresh one.

13.1 **Facility policy administration (CLI, P10).** `cli create-facility --org --id --name --currency --limit --fee-flat
--fee-bps --allocation --funding-cash --policy-version [--required-evidence invoice,balance] [--balance-max-age-hours]
[--repayment-days] [--reservation-hours] [--payout-lead-hours] [--suspension-policy]` and `cli update-facility --id …`
(any subset; **every change requires a new `--policy-version`** and is appended to `facility_versions(facility_id,
policy_version, terms JSON, changed_at, changed_by)`; the case decision binds to the version in force when the
reviewer acts). `cli list-facilities`, `cli list-users`, `cli disable-user --email`. New facility column
`required_evidence` (comma list of observation kinds the policy requires before route C can be approved; default
`balance`).

13.2 **Intake fields (P02).** Case adds `invoice_ref` (supplier invoice number, required), `customer_ref` (importer's
own reference, optional), `quote_source` (who issued the quote: free text, e.g. "Provider FX desk"), `quote_at`
(UTC, when quoted), and `owner_user_id` may be set at intake (must be an operator/reviewer in the org).
CSV: first line may be `#clearline-cases v2`; v2 adds columns `invoice_ref, customer_ref, quote_source, quote_at_local,
owner_email`; a file without the marker is v1 and still accepted (invoice_ref then required → row error "v1 file:
invoice_ref is required for import; add it or use v2"). Replay protection unchanged (row-hash idempotency keys).

13.3 **Evidence fields (P03).** Every observation may carry `issuer` (who produced it), `record_ref` (their
reference) and `scope` (`case` default | `importer`). New observation kind **`invoice`** {amount, currency, invoice_ref,
issuer, issued_at} (the supplier invoice). The view marks each fact `fresh | stale | superseded | conflicting`
(two active records of the same kind with different amounts and overlapping as-of → `conflicting`, which makes the
dependent route `unknown` with "Conflicting records: …").

13.4 **Policy-required facts (scenario B).** For route C, every kind in `facility.required_evidence` must have an
active, non-stale, non-conflicting record known at the evaluation time; each missing one is a **blocker** named
"Policy POL-x requires <kind>: not on record" and makes C `unknown` (never `feasible`). Cash/headroom shortfalls are
separate blockers and keep C `infeasible` even when all evidence is present (scenario C). Blockers are listed in
`routes[i].blockers[] = {code, kind: 'evidence'|'cash'|'credit'|'time'|'contract'|'facility', text, evidence_ids}`.

13.5 **Decision record (§4 of the brief).** `case_view.decision_record = {checkpoints:[{at, trigger_event_seq,
trigger: 'observation'|'evidence'|'review'|'clock'|'command', route_c_before, route_c_after, blockers_cleared[],
blockers_added[], facts:{observed:[...], policy:[...], judgment:[...]}}], waiting_for[], changed[], uncertain[]}`.
A checkpoint is appended (as event `eligibility_evaluated`, provenance `system`) whenever an observation/evidence
event or review action changes any route's status or blockers. `observed` = operator/external facts with ids,
`policy` = rule evaluations with policy_version, `judgment` = reviewer decisions with reason. An earlier decline is
never rewritten; a later approval is a new judgment. `waiting_for` = current blockers; `changed` = last checkpoint's
cleared/added; `uncertain` = unknowns (stale, conflicting, delivery unknown, unmatched cash).

13.6 **As-of replay (P09, scenario B).** `GET /api/cases/{id}?as_of=<UTC>` returns the view computed only from events
with `known_at <= as_of` and the clock at `as_of`, flagged `{replay:{as_of, note:"Replay: shows only what was known
at …"}}`, with no actions. Same org scoping.

13.7 **Same-provider duplicate check (§4).** On create/import and when an `invoice` observation is added, look for
other cases **in the same org** with the same normalised `invoice_ref` + supplier, or same supplier + payout
amount/currency within 30 days of deadline. Result `case_view.duplicate_check = {status: 'no_match'|'potential_match'|
'overridden', matches:[case ids], text}`; the no-match text is exactly "No matching record in this provider's book."
(never "not financed elsewhere"). A potential match blocks `request_advance` until a reviewer runs
`resolve_duplicate_check {decision: 'not_duplicate'|'duplicate', reason}` (duplicate → case may only be closed with
exception `duplicate_case`). Never searches other orgs.

13.8 **Overdue vs default (P07).** After due date with money owed: `exposure_panel.status_label` "Overdue — not a
default determination". Default is only a reviewer's `close_with_exception disposition=write_off_referred` or a new
command `declare_default {reason}` (reviewer) which records the judgment; nothing becomes "default" automatically.

13.9 **Pilot measurement (P09, scenario H).** Commands `log_work {minutes, activity, provenance:'operator_reported'}`
(operator/reviewer) and `record_baseline {provenance:'recorded'|'estimated'|'synthetic', operator_minutes?,
touchpoints?, evidence_requests?, decision_hours?, deadline_met?, outcome?, source_note}`. `GET
/api/cases/{id}/report?format=json|html` → one-page comparison: Clearline side computed from the event log
(touchpoints = human events, repeated evidence requests, decision elapsed hours request→judgment, active minutes =
Σ log_work else "not measured", elapsed wait = request→judgment minus active), baseline side as recorded, every
number labelled `recorded|estimated|synthetic|computed|not measured`; with no baseline every baseline cell is "not
measured". Never reports capital released, advance principal or transferred credit risk as savings (the report states
this explicitly).

13.10 **Rules settled by the second challenger round (binding).** (a) Facts that satisfy `required_evidence` must be
`scope=case`; importer-scoped records are context only. (b) An `invoice` satisfies the policy only if its normalised
ref, currency and amount equal the case's invoice_ref and payout. (c) Balances in a currency other than the funding
currency never satisfy route C. (d) The duplicate check considers the case invoice_ref and every active invoice
observation; a potential match is cleared only by `resolve_duplicate_check` and blocks both `request_advance` and
`approve_and_reserve`. (e) Fee, due date, allocation rule and policy version are bound at approval; a reserved/drawn
case shows the approved terms (`header.current_policy_version` shows the facility's current one). (f) Money shortfalls
are the binding constraint even when evidence is also missing. (g) API/export event ids are per-case `seq`; evidence
ids `EV-n` are numbered per org (no cross-org volume signal). (h) `?as_of=` later than the server clock → 422.
