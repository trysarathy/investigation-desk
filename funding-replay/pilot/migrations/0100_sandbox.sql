-- 0100_sandbox.sql (DATA-owned). Forward-only. Sandbox payout simulator state.
-- Sandbox — not a live payment. Nothing here moves money; rows are simulations only.

CREATE TABLE IF NOT EXISTS sandbox_payouts (
    provider_ref   TEXT PRIMARY KEY,
    org_id         TEXT NOT NULL,
    payout_ref     TEXT NOT NULL,
    amount_minor   INTEGER NOT NULL,
    currency       TEXT NOT NULL,
    beneficiary    TEXT NOT NULL,
    scenario       TEXT NOT NULL,
    status         TEXT NOT NULL,          -- submitted | accepted | credited | failed | returned | rejected
    submit_count   INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (org_id, payout_ref)
);

CREATE TABLE IF NOT EXISTS sandbox_events (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,  -- emission (delivery) order
    org_id             TEXT NOT NULL,
    provider_event_id  TEXT NOT NULL,                      -- repeated on purpose by scenario duplicate_events
    provider_ref       TEXT NOT NULL REFERENCES sandbox_payouts(provider_ref),
    kind               TEXT NOT NULL,                      -- accepted | credited | failed | returned
    occurred_at        TEXT NOT NULL,
    delivered          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sandbox_events_pending ON sandbox_events (org_id, delivered, id);
CREATE INDEX IF NOT EXISTS sandbox_events_ref ON sandbox_events (org_id, provider_ref, id);
