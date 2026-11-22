-- Clearline Control: roles, row-level security, append-only and maker-checker triggers, grants.
-- Runs as the schema owner. The runtime login `clearline_runtime` (created by the operator, see
-- docs/runbooks/DEPLOYMENT_RUNBOOK_RC5.md) must be NOBYPASSRLS and must NOT own these tables.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearline_app') THEN
    CREATE ROLE clearline_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO roles (code, description) VALUES
  ('admin', 'Admin: manages members and settings; no financial authority'),
  ('payment_ops', 'Payment Operations: investigates payments and requests approvals'),
  ('finance', 'Finance: imports statements and prepares accounting entries and exports'),
  ('approver', 'Approver: approves or rejects requests prepared by someone else'),
  ('viewer', 'Viewer: read only')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

CREATE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint

-- Membership lookup used by policies; SECURITY DEFINER so the policy itself does not recurse through RLS.
CREATE FUNCTION app_is_member(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM organization_memberships m
                  WHERE m.org_id = org AND m.user_id = app_user_id() AND m.revoked_at IS NULL) $$;
--> statement-breakpoint

-- Tenant tables: visible and writable only inside the transaction's organisation, and only to an active member.
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'org_engine_state','payment_intents','provider_events','settlement_evidence','reconciliation_records','exceptions',
    'investigations','investigation_notes','funding_obligations','repayment_allocations','accounting_proposals',
    'accounting_exports','engine_records','approval_requests','approval_decisions','audit_events','idempotency_records',
    'statement_imports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (org_id = app_org_id() AND app_is_member(org_id))
                     WITH CHECK (org_id = app_org_id() AND app_is_member(org_id))$p$, tbl);
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_read ON organizations FOR SELECT USING (app_is_member(id));
--> statement-breakpoint

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A user sees their own memberships (to choose an organisation) and, inside an organisation, its members.
CREATE POLICY membership_read ON organization_memberships FOR SELECT
  USING (user_id = app_user_id() OR (org_id = app_org_id() AND app_is_member(org_id)));
--> statement-breakpoint

-- Audit history is append-only for everyone, including the owner.
CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER investigation_notes_append_only BEFORE UPDATE OR DELETE ON investigation_notes FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER approval_decisions_append_only BEFORE UPDATE OR DELETE ON approval_decisions FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Maker-checker in the database: the decider is not the requester, the request is pending, the decision is for the
-- exact payload hash that was requested, and the decider is an active Approver of the same organisation.
CREATE FUNCTION check_approval_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM approval_requests WHERE org_id = NEW.org_id AND id = NEW.request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval request not found' USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.requested_by = NEW.decided_by THEN
    RAISE EXCEPTION 'maker-checker: the requester cannot decide their own request' USING ERRCODE = 'check_violation';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'approval request is %, not pending', r.status USING ERRCODE = 'check_violation';
  END IF;
  IF r.payload_sha256 <> NEW.payload_sha256 THEN
    RAISE EXCEPTION 'decision is for a different version of the request' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.decided_by
                 AND m.role = 'approver' AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'maker-checker: decider is not an active approver' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_decisions_check BEFORE INSERT ON approval_decisions FOR EACH ROW EXECUTE FUNCTION check_approval_decision();
--> statement-breakpoint

-- A closed request never reopens.
CREATE FUNCTION check_request_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'approval request is closed (%)', OLD.status USING ERRCODE = 'check_violation'; END IF;
  IF NEW.payload_sha256 <> OLD.payload_sha256 OR NEW.payload::text <> OLD.payload::text OR NEW.version <> OLD.version
     OR NEW.requested_by <> OLD.requested_by OR NEW.subject_id <> OLD.subject_id THEN
    RAISE EXCEPTION 'approval request content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_requests_transition BEFORE UPDATE ON approval_requests FOR EACH ROW EXECUTE FUNCTION check_request_transition();
--> statement-breakpoint
CREATE TRIGGER approval_requests_no_delete BEFORE DELETE ON approval_requests FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Least privilege for the runtime role.
GRANT USAGE ON SCHEMA public TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON users, sessions, accounts, verifications TO clearline_app;
--> statement-breakpoint
GRANT DELETE ON sessions, verifications TO clearline_app;
--> statement-breakpoint
GRANT SELECT ON roles, organizations, organization_memberships TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON org_engine_state, payment_intents, provider_events, settlement_evidence,
  reconciliation_records, exceptions, investigations, funding_obligations, repayment_allocations, accounting_proposals,
  accounting_exports, engine_records, approval_requests, idempotency_records, statement_imports TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events, investigation_notes, approval_decisions TO clearline_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_id(), app_user_id(), app_is_member(uuid) TO clearline_app;
