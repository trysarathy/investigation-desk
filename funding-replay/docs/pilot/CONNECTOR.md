# Payout connector contract

**Sandbox — not a live payment.** The pilot ships only `SandboxConnector` (`pilot/connector.py`), a simulator
that keeps its state in the local SQLite database (`sandbox_payouts`, `sandbox_events`; migration
`0100_sandbox.sql`). It never contacts a bank or payment provider, holds no funds and moves no money. Every
sandbox event carries `provenance: "sandbox_simulation"` and the label "Sandbox — not a live payment".

## Interface every connector provides

```python
class PayoutConnector(Protocol):
    def submit(self, payout_ref, amount_minor, currency, beneficiary) -> dict: ...
    def get_status(self, provider_ref) -> list[dict]: ...
```

`submit` returns `{status, provider_ref, detail}` where `status` is:

| status | meaning | what the desk does |
|---|---|---|
| `accepted` | provider took the instruction. **Not** a credit to the supplier. | wait for `credited` / `failed` / `returned` events |
| `timeout` | no answer: the outcome is **unknown** | never re-instruct; "Query payout status" with the same reference |
| `rejected` | provider refused the instruction outright | fix and, after reviewer authorisation, make a new attempt |

Rules a connector must keep:

1. **Idempotent on `payout_ref`.** Submitting the same `payout_ref` again returns the same `provider_ref` and
   never creates a second payment. Same ref with different amount/currency/beneficiary is an error
   (`ConnectorConflict`), never a new payment. The desk uses one `payout_ref` per payout attempt.
2. **Status by reference.** `get_status(provider_ref)` returns every event the provider has for that payment,
   oldest first, de-duplicated by `provider_event_id`.
3. **Events** have the shape
   `{provider_event_id, provider_ref, payout_ref, kind, occurred_at, provenance, label}` with `kind` in
   `accepted | credited | failed | returned` and `occurred_at` a UTC ISO-8601 instant (`…Z`) — when it happened
   at the provider, not when it was delivered.
4. **Delivery (webhook).** Each event is POSTed as canonical JSON (sorted keys, no spaces, UTF-8) to
   `POST /api/connector/sandbox/events` with header `X-Clearline-Signature: <hex HMAC-SHA256(PILOT_SECRET, body)>`.
   The receiver must:
   - verify the signature over the exact body bytes with `connector.verify` (constant-time); reject with 401
     otherwise;
   - de-duplicate on `provider_event_id` (`connector_events` has it UNIQUE per org); answer 2xx to a replay but
     do not apply it again;
   - apply monotonically: `credited` beats `accepted`; an `accepted` arriving after `credited` is stored, not
     applied; `returned` follows `credited`;
   - never create a draw, reservation or payout attempt from an event.
   Events not answered 2xx stay pending and are retried.

## Sandbox scenarios

Chosen per `submit(..., scenario=...)` (default `normal`); a resubmission never changes it.
`advance(provider_ref, to_kind=None)` moves the simulation one step (or to `to_kind`); `pending_events()` lists
undelivered events; `deliver_pending(post_fn)` signs and posts them; `deliver(events, post_fn, secret)` is the
stateless helper.

| scenario | submit returns | events |
|---|---|---|
| `normal` | accepted | `accepted`; advance → `credited` |
| `timeout_then_accept` | **timeout** | `accepted` is visible via `get_status` / webhook; advance → `credited` |
| `fail` | accepted | `accepted`; advance → `failed` |
| `return` | accepted | `accepted`; advance → `credited`; advance → `returned` |
| `duplicate_events` | accepted | every event is emitted twice with the same `provider_event_id` |
| `out_of_order` | accepted | nothing at submit; advance emits `credited` **then** the delayed `accepted` (earlier `occurred_at`) |

Invalid input (non-positive or non-integer amount, unsupported currency, blank beneficiary) → `rejected`.

## What a real provider integration must provide (not in this pilot)

A live connector would implement the same two methods and webhook contract. Before one can exist Clearline
needs, none of which it has today:

- **A payout partner** (licensed payment institution or bank) and a signed **agreement** covering liability,
  cut-offs, returns and dispute handling.
- **Credentials** issued by that partner (API keys / mTLS certificates) held in a secret store — never in the
  database, repository, logs or exports — plus their webhook signing scheme (map it to the verification step
  above, or verify theirs and re-sign).
- Mapping of the partner's statuses onto `accepted | credited | failed | returned`, with the partner's
  documentation of which status means **beneficiary credit** (acceptance is never shown as "paid").
- The partner's idempotency key mechanism (our `payout_ref`) and its retention window; a status query endpoint by
  reference; their event ids for de-duplication; their clock (`occurred_at`) semantics.
- Beneficiary details handling (validation, sanctions screening by the partner), currency/corridor coverage and
  the funding account the payouts debit.
- Operational contacts and an escalation path for `unknown` outcomes (see RECOVERY.md, "Uncertain payout").
- A separate `route` value and provenance (`provider_event`, not `sandbox_simulation`), and a reviewed change to
  PILOT_CONTRACT before any live use.
