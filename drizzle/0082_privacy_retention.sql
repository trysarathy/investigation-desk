-- v1 phase 5.6 (privacy): what a merchant deletion keeps, and the record of every retention run.
-- Runs as the schema owner. Only the owner (the admin CLI: delete-merchant, retention) reads or writes these tables:
-- no role is granted anything, row-level security is on and forced with NO policy (a future accidental grant reads
-- nothing), and the owner reaches them through BYPASSRLS. No existing control is relaxed.
--
-- [ASSUMPTION — founder to confirm with a lawyer] audit events and approvals are kept for 7 years after they happened.
-- When a merchant is deleted they are kept ONLY in the minimal form below (src/server/privacy/retained.ts): no name,
-- e-mail, free text, order or wallet reference, organisation id or user id; every identifier is replaced by a keyed
-- digest that only someone holding the organisation id (the merchant, from its export) can recompute.

-- One row per deleted merchant: the receipt. org_ref = sha256('clearline-org|' || org id); never the id itself.
CREATE TABLE merchant_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_ref text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  counts jsonb NOT NULL,
  retained integer NOT NULL,
  CONSTRAINT merchant_deletions_ref_chk CHECK (org_ref ~ '^[0-9a-f]{64}$'),
  CONSTRAINT merchant_deletions_retained_chk CHECK (retained >= 0)
);
--> statement-breakpoint
ALTER TABLE merchant_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant_deletions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON merchant_deletions FROM PUBLIC;
--> statement-breakpoint
-- A receipt never changes; it is removed only with its last retained record (retention, after 7 years).
CREATE TRIGGER merchant_deletions_no_update BEFORE UPDATE ON merchant_deletions FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- The minimal form of a deleted merchant's audit events and approvals (kind), in their original order (position).
CREATE TABLE retained_records (
  deletion_id uuid NOT NULL REFERENCES merchant_deletions(id),
  kind text NOT NULL,
  position integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (deletion_id, kind, position),
  CONSTRAINT retained_records_kind_chk CHECK (kind IN ('audit_event', 'approval_request', 'approval_decision')),
  CONSTRAINT retained_records_until_chk CHECK (retain_until > occurred_at)
);
--> statement-breakpoint
CREATE INDEX retained_records_until_idx ON retained_records (retain_until);
--> statement-breakpoint
ALTER TABLE retained_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE retained_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON retained_records FROM PUBLIC;
--> statement-breakpoint
-- Never changed; deleted only once its retention period is over (by anyone, the owner included, unless the owner
-- disables this trigger on purpose).
CREATE FUNCTION retained_records_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'retained records are never changed' USING ERRCODE = '42501'; END IF;
  IF OLD.retain_until > now() THEN RAISE EXCEPTION 'retained record is still inside its retention period' USING ERRCODE = '42501'; END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION retained_records_keep() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER retained_records_keep BEFORE UPDATE OR DELETE ON retained_records FOR EACH ROW EXECUTE FUNCTION retained_records_keep();
--> statement-breakpoint
CREATE TRIGGER retained_records_no_truncate BEFORE TRUNCATE ON retained_records FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Every retention run (src/server/privacy/retention.ts), dry runs included: when, what it would or did remove (counts
-- only), and how it ended. Append-only.
CREATE TABLE retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL,
  dry_run boolean NOT NULL,
  status text NOT NULL,
  counts jsonb NOT NULL,
  error_code text,
  CONSTRAINT retention_runs_status_chk CHECK (status IN ('done', 'failed')),
  CONSTRAINT retention_runs_error_chk CHECK ((status = 'failed') = (error_code IS NOT NULL) AND (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{2,64}$'))
);
--> statement-breakpoint
ALTER TABLE retention_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE retention_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON retention_runs FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER retention_runs_append_only BEFORE UPDATE OR DELETE ON retention_runs FOR EACH ROW EXECUTE FUNCTION refuse_change();
