-- 0003 (BACKEND): brief v2 additions (PILOT_CONTRACT §13). Forward-only. Upgrades a database that already has
-- 0001, 0002 and 0100 applied (with data in it) as well as a fresh one. Legacy cases keep NULL in the new columns.

-- 13.1 Facility policy administration: required evidence + an append-only history of policy versions.
ALTER TABLE facilities ADD COLUMN required_evidence TEXT NOT NULL DEFAULT 'balance';

CREATE TABLE IF NOT EXISTS facility_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  org_id TEXT NOT NULL REFERENCES orgs(id),
  policy_version TEXT NOT NULL,
  terms TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  UNIQUE (facility_id, policy_version)
);
CREATE INDEX IF NOT EXISTS ix_facility_versions ON facility_versions(facility_id, changed_at);

CREATE TRIGGER facility_versions_no_update BEFORE UPDATE ON facility_versions
BEGIN SELECT RAISE(ABORT, 'facility versions are append-only'); END;

CREATE TRIGGER facility_versions_no_delete BEFORE DELETE ON facility_versions
BEGIN SELECT RAISE(ABORT, 'facility versions are append-only'); END;

-- Backfill: the row currently in force becomes the first recorded version of each existing facility.
INSERT INTO facility_versions(facility_id, org_id, policy_version, terms, changed_at, changed_by)
SELECT f.id, f.org_id, f.policy_version,
       json_object('name', f.name, 'currency', f.currency, 'limit_minor', f.limit_minor,
                   'fee_flat_minor', f.fee_flat_minor, 'fee_bps', f.fee_bps, 'allocation', f.allocation,
                   'status', f.status, 'suspension_policy', f.suspension_policy, 'policy_version', f.policy_version,
                   'funding_account_start_minor', f.funding_account_start_minor,
                   'balance_max_age_hours', f.balance_max_age_hours, 'repayment_days', f.repayment_days,
                   'reservation_hours', f.reservation_hours, 'payout_lead_hours', f.payout_lead_hours,
                   'required_evidence', f.required_evidence),
       IFNULL((SELECT o.created_at FROM orgs o WHERE o.id = f.org_id), '2000-01-01T00:00:00Z'),
       'migration 0003 (backfill of the version in force)'
FROM facilities f
WHERE NOT EXISTS (SELECT 1 FROM facility_versions v WHERE v.facility_id = f.id AND v.policy_version = f.policy_version);

-- 13.2 Intake fields. invoice_ref is required for new cases by the application; legacy rows stay NULL.
ALTER TABLE cases ADD COLUMN invoice_ref TEXT;
ALTER TABLE cases ADD COLUMN customer_ref TEXT;
ALTER TABLE cases ADD COLUMN quote_source TEXT;
ALTER TABLE cases ADD COLUMN quote_at TEXT;

-- 13.7 Same-provider duplicate check: lookups are always scoped by org_id.
CREATE INDEX IF NOT EXISTS ix_cases_org_supplier ON cases(org_id, supplier);
CREATE INDEX IF NOT EXISTS ix_cases_org_invoice ON cases(org_id, invoice_ref);
