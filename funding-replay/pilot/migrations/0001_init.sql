-- Pilot operating desk: initial schema (forward-only). Money is integer minor units + ISO currency.

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator','reviewer','viewer','admin')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE login_failures (
  email TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX ix_login_failures ON login_failures(email, at);

CREATE TABLE facilities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
  fee_flat_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_flat_minor >= 0),
  fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (fee_bps >= 0),
  allocation TEXT NOT NULL DEFAULT 'fees_first' CHECK (allocation IN ('fees_first','principal_first')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspension_policy TEXT NOT NULL DEFAULT 'unset' CHECK (suspension_policy IN ('block_draws','honour_existing','unset')),
  policy_version TEXT NOT NULL,
  funding_account_start_minor INTEGER NOT NULL CHECK (funding_account_start_minor >= 0),
  balance_max_age_hours INTEGER NOT NULL DEFAULT 24,
  repayment_days INTEGER NOT NULL DEFAULT 3,
  reservation_hours INTEGER NOT NULL DEFAULT 72,
  payout_lead_hours INTEGER NOT NULL DEFAULT 8
);

CREATE TABLE case_counters (
  year INTEGER PRIMARY KEY,
  last INTEGER NOT NULL
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  owner_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  importer TEXT NOT NULL,
  supplier TEXT NOT NULL,
  payout_minor INTEGER NOT NULL CHECK (payout_minor > 0),
  payout_currency TEXT NOT NULL,
  funding_minor INTEGER NOT NULL CHECK (funding_minor > 0),
  funding_currency TEXT NOT NULL,
  quote_ref TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  deadline_tz TEXT NOT NULL,
  window_a_at TEXT NOT NULL,
  window_a_cutoff_at TEXT NOT NULL,
  later_permitted INTEGER NOT NULL DEFAULT 0,
  contract_ref TEXT,
  window_b_at TEXT,
  window_b_cutoff_at TEXT,
  facility_id TEXT REFERENCES facilities(id),
  reference TEXT
);
CREATE INDEX ix_cases_org ON cases(org_id, status);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  effective_at TEXT NOT NULL,
  known_at TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role TEXT,
  provenance TEXT NOT NULL CHECK (provenance IN ('operator_entered','external_record','provider_event','sandbox_simulation','system')),
  reason TEXT,
  corrects_event_id INTEGER REFERENCES events(id),
  idempotency_key TEXT,
  UNIQUE (case_id, seq)
);
CREATE INDEX ix_events_case ON events(org_id, case_id, seq);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  event_id INTEGER REFERENCES events(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf','image/png','image/jpeg','text/csv','text/plain')),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  provenance TEXT NOT NULL,
  known_at TEXT NOT NULL
);
CREATE INDEX ix_evidence_case ON evidence(org_id, case_id);

CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence is retained'); END;

CREATE TRIGGER evidence_no_content_update BEFORE UPDATE OF data, sha256, size, filename, content_type, case_id, org_id ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence content is immutable'); END;

CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('active','consumed','released','expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_reservation_live_per_case ON reservations(case_id) WHERE status IN ('active','consumed');
CREATE INDEX ix_reservations_facility ON reservations(facility_id, status);

CREATE TABLE draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  principal_minor INTEGER NOT NULL CHECK (principal_minor > 0),
  fee_minor INTEGER NOT NULL CHECK (fee_minor >= 0),
  effective_at TEXT NOT NULL,
  principal_repaid_minor INTEGER NOT NULL DEFAULT 0,
  CHECK (principal_repaid_minor >= 0 AND principal_repaid_minor <= principal_minor)
);

-- Database-level capacity guard: an active reservation may never push the facility past its limit or its
-- funding account (application checks run first inside BEGIN IMMEDIATE; this is defence in depth).
CREATE TRIGGER reservations_capacity BEFORE INSERT ON reservations
WHEN NEW.status = 'active' AND (
  SELECT MIN(f.limit_minor, f.funding_account_start_minor)
         - IFNULL((SELECT SUM(r.amount_minor) FROM reservations r WHERE r.facility_id = f.id AND r.status = 'active'), 0)
         - IFNULL((SELECT SUM(d.principal_minor - d.principal_repaid_minor) FROM draws d WHERE d.facility_id = f.id), 0)
  FROM facilities f WHERE f.id = NEW.facility_id
) < NEW.amount_minor
BEGIN SELECT RAISE(ABORT, 'insufficient_capacity'); END;

CREATE TRIGGER draws_need_consumed_reservation BEFORE INSERT ON draws
WHEN NOT EXISTS (SELECT 1 FROM reservations r WHERE r.case_id = NEW.case_id AND r.status = 'consumed'
                 AND r.amount_minor = NEW.principal_minor)
BEGIN SELECT RAISE(ABORT, 'draw requires the consumed reservation of the same amount'); END;

CREATE TABLE payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  route TEXT NOT NULL CHECK (route IN ('manual','sandbox')),
  external_ref TEXT NOT NULL,
  provider_ref TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('instructed','unknown','accepted','credited','failed','returned')),
  created_at TEXT NOT NULL,
  UNIQUE (case_id, attempt),
  UNIQUE (org_id, route, external_ref)
);
-- One live attempt per case: a new attempt can exist only once every earlier one has failed or been returned.
CREATE UNIQUE INDEX ux_payout_live_per_case ON payouts(case_id) WHERE status NOT IN ('failed','returned');

CREATE TABLE connector_events (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  provider_event_id TEXT NOT NULL,
  payout_id INTEGER REFERENCES payouts(id),
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, provider_event_id)
);

CREATE TABLE idempotency (
  org_id TEXT NOT NULL,
  key TEXT NOT NULL,
  command TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, key)
);
