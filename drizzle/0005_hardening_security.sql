-- rc5 security hardening (review findings M2, M3, M4; H1 storage). Runs as the schema owner.

-- M3: no temporary tables for anyone but the owner (a TEMP table could shadow a table inside a SECURITY DEFINER
-- function); definer functions resolve pg_temp LAST and are callable only by the app role.
DO $$ BEGIN EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()); END $$;
--> statement-breakpoint
ALTER FUNCTION app_is_member(uuid) SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION check_approval_decision() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION check_import_transition() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app_org_id() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION app_user_id() SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_is_member(uuid), app_org_id(), app_user_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_member(uuid), app_org_id(), app_user_id() TO clearline_app;
--> statement-breakpoint

-- M2: the database binds the acting person, not only the columns.
CREATE OR REPLACE FUNCTION check_approval_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE r public.approval_requests%ROWTYPE;
BEGIN
  IF NEW.decided_by IS DISTINCT FROM public.app_user_id() THEN
    RAISE EXCEPTION 'maker-checker: a decision is recorded only for the signed-in user' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.approval_requests WHERE org_id = NEW.org_id AND id = NEW.request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval request not found' USING ERRCODE = 'foreign_key_violation'; END IF;
  IF r.requested_by = NEW.decided_by THEN
    RAISE EXCEPTION 'maker-checker: the requester cannot decide their own request' USING ERRCODE = 'check_violation';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'approval request is %, not pending', r.status USING ERRCODE = 'check_violation'; END IF;
  IF r.payload_sha256 <> NEW.payload_sha256 THEN
    RAISE EXCEPTION 'decision is for a different version of the request' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.decided_by
                 AND m.role = 'approver' AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'maker-checker: decider is not an active approver' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- A request is created pending, by the signed-in user; it becomes approved/rejected only with a matching decision.
CREATE FUNCTION check_request_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'an approval request is created pending' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.requested_by IS DISTINCT FROM public.app_user_id() THEN
    RAISE EXCEPTION 'an approval request is recorded only for the signed-in user' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_requests_insert BEFORE INSERT ON approval_requests FOR EACH ROW EXECUTE FUNCTION check_request_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_request_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'approval request is closed (%)', OLD.status USING ERRCODE = 'check_violation'; END IF;
  IF NEW.payload_sha256 <> OLD.payload_sha256 OR NEW.payload::text <> OLD.payload::text OR NEW.version <> OLD.version
     OR NEW.requested_by <> OLD.requested_by OR NEW.subject_id <> OLD.subject_id THEN
    RAISE EXCEPTION 'approval request content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('approved', 'rejected') AND NOT EXISTS (
       SELECT 1 FROM public.approval_decisions d WHERE d.org_id = NEW.org_id AND d.request_id = NEW.id
       AND d.decision = CASE NEW.status WHEN 'approved' THEN 'approve' ELSE 'reject' END) THEN
    RAISE EXCEPTION 'approval request can only be % with a matching decision', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Imports: created only as pending/rejected by the signed-in importer; confirmed only by the signed-in approver.
CREATE FUNCTION check_import_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('pending_confirmation', 'rejected') OR NEW.confirmed_by IS NOT NULL THEN
    RAISE EXCEPTION 'a statement import is created pending (or rejected), never confirmed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.imported_by IS DISTINCT FROM public.app_user_id() THEN
    RAISE EXCEPTION 'a statement import is recorded only for the signed-in user' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER statement_imports_insert BEFORE INSERT ON statement_imports FOR EACH ROW EXECUTE FUNCTION check_import_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_import_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'pending_confirmation' THEN RAISE EXCEPTION 'statement import is closed (%)', OLD.status USING ERRCODE = 'check_violation'; END IF;
  IF NEW.status NOT IN ('imported', 'declined') THEN RAISE EXCEPTION 'a pending import can only be confirmed or declined' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.file_sha256 <> OLD.file_sha256 OR NEW.lines::text <> OLD.lines::text OR NEW.imported_by <> OLD.imported_by
     OR NEW.lines_sha256 IS DISTINCT FROM OLD.lines_sha256 THEN
    RAISE EXCEPTION 'statement import content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.confirmed_by IS NULL OR NEW.confirmed_by = OLD.imported_by OR NEW.confirmed_by IS DISTINCT FROM public.app_user_id() THEN
    RAISE EXCEPTION 'maker-checker: an import is confirmed by the signed-in approver, never by its importer' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.confirmed_by
                 AND m.role = 'approver' AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'maker-checker: confirmer is not an active approver' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- M4: least privilege. No pilot path creates payments or provider events, or rewrites stored responses.
REVOKE INSERT, UPDATE ON provider_events FROM clearline_app;
--> statement-breakpoint
REVOKE INSERT ON payment_intents FROM clearline_app;
--> statement-breakpoint
REVOKE UPDATE ON idempotency_records FROM clearline_app;
--> statement-breakpoint
-- A payment's identity and amount never change (in the columns or inside the engine record).
CREATE FUNCTION keep_payment_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency OR NEW.internal_reference <> OLD.internal_reference
     OR NEW.beneficiary_name <> OLD.beneficiary_name
     OR (NEW.record->'amountMinor') IS DISTINCT FROM (OLD.record->'amountMinor')
     OR (NEW.record->'sourceCurrency') IS DISTINCT FROM (OLD.record->'sourceCurrency')
     OR (NEW.record->'destinationCurrency') IS DISTINCT FROM (OLD.record->'destinationCurrency')
     OR (NEW.record->'beneficiaryRef') IS DISTINCT FROM (OLD.record->'beneficiaryRef') THEN
    RAISE EXCEPTION 'a payment''s identity and amount are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_intents_identity_immutable BEFORE UPDATE ON payment_intents FOR EACH ROW EXECUTE FUNCTION keep_payment_identity();
--> statement-breakpoint

-- H1: per-account sign-in failures (no tenant data; written by the auth route).
GRANT SELECT, INSERT, DELETE ON login_failures TO clearline_app;
