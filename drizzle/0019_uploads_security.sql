-- rc7 phase 1: security for uploads, their validation reports and the merchant's retention setting. Runs as the
-- schema owner. File bytes are never in the database.

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['uploads','upload_rows','merchant_data_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format($p$CREATE POLICY merchant_isolation ON %I USING (org_id = app_org_id() AND app_is_member(org_id))
                     WITH CHECK (org_id = app_org_id() AND app_is_member(org_id))$p$, tbl);
    EXECUTE format($p$CREATE POLICY provider_full_grant_read ON %I FOR SELECT USING (app_provider_full_access(org_id))$p$, tbl);
  END LOOP;
END $$;
--> statement-breakpoint

-- An upload goes only to a LIVE merchant (sample organisations hold fictional data only), is recorded for the
-- signed-in Finance or Payment Operations member, and moves through its statuses one step at a time. Its file facts
-- never change. A bank statement is confirmed (or declined) only by an active Approver who did not upload it; other
-- files by Finance or Payment Operations. Confirmed data is deleted only by retention (the owner connection).
CREATE FUNCTION check_upload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  app boolean := pg_has_role(session_user, 'clearline_app', 'MEMBER');
  actor_role text;
BEGIN
  IF app THEN
    SELECT m.role INTO actor_role FROM public.organization_memberships m
    WHERE m.org_id = NEW.org_id AND m.user_id = public.app_user_id() AND m.revoked_at IS NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF (SELECT o.data_mode FROM public.organizations o WHERE o.id = NEW.org_id AND o.kind = 'merchant') IS DISTINCT FROM 'live' THEN
      RAISE EXCEPTION 'uploads go to a live merchant organisation; sample organisations hold fictional data only' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('stored', 'rejected') OR NEW.confirmed_by IS NOT NULL OR NEW.template_id IS NOT NULL OR NEW.rows_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'an upload is created stored (or rejected), unmapped and unconfirmed' USING ERRCODE = 'check_violation';
    END IF;
    IF app AND (NEW.uploaded_by IS DISTINCT FROM public.app_user_id() OR actor_role IS NULL OR actor_role NOT IN ('finance', 'payment_ops')) THEN
      RAISE EXCEPTION 'an upload is recorded for the signed-in Finance or Payment Operations member' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.org_id <> OLD.org_id OR NEW.id <> OLD.id OR NEW.entity_id <> OLD.entity_id OR NEW.file_type <> OLD.file_type OR NEW.file_format <> OLD.file_format
     OR NEW.original_name <> OLD.original_name OR NEW.byte_size <> OLD.byte_size OR NEW.content_sha256 <> OLD.content_sha256 OR NEW.encrypted <> OLD.encrypted
     OR NEW.uploaded_by <> OLD.uploaded_by OR NEW.created_at <> OLD.created_at OR NEW.delete_after <> OLD.delete_after THEN
    RAISE EXCEPTION 'an upload''s file facts are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'deleted' THEN
    RAISE EXCEPTION 'a deleted upload never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD.status, NEW.status) IN (('stored','mapped'), ('stored','validated'), ('stored','rejected'), ('stored','deleted'),
      ('mapped','mapped'), ('mapped','validated'), ('mapped','deleted'), ('validated','mapped'), ('validated','confirmed'),
      ('validated','rejected'), ('validated','deleted'), ('rejected','deleted'), ('confirmed','normalised'), ('confirmed','deleted'),
      ('normalised','deleted'), ('confirmed','confirmed'), ('normalised','normalised'))) THEN
    RAISE EXCEPTION 'an upload cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.status = 'deleted') <> (NEW.storage_key IS NULL AND NEW.deleted_at IS NOT NULL) OR (NEW.status <> 'deleted' AND NEW.storage_key IS DISTINCT FROM OLD.storage_key) THEN
    RAISE EXCEPTION 'an upload''s file is removed only when it is deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF app AND NEW.status = 'deleted' AND OLD.status IN ('confirmed', 'normalised') THEN
    RAISE EXCEPTION 'confirmed data is deleted by retention only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('confirmed', 'normalised') AND (NEW.mapping::text IS DISTINCT FROM OLD.mapping::text OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.rows_sha256 IS DISTINCT FROM OLD.rows_sha256 OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.accepted_count <> OLD.accepted_count
     OR NEW.rejected_count <> OLD.rejected_count OR NEW.warning_count <> OLD.warning_count OR NEW.duplicate_count <> OLD.duplicate_count
     OR NEW.row_count <> OLD.row_count OR NEW.template_version IS DISTINCT FROM OLD.template_version OR NEW.notes::text <> OLD.notes::text
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
    RAISE EXCEPTION 'a confirmed upload''s mapping and validation are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('confirmed', 'rejected') AND OLD.status = 'validated' THEN
    IF NEW.mapping::text IS DISTINCT FROM OLD.mapping::text OR NEW.rows_sha256 IS DISTINCT FROM OLD.rows_sha256 OR NEW.template_id IS DISTINCT FROM OLD.template_id THEN
      RAISE EXCEPTION 'the decision binds the validated upload; its mapping and rows cannot change with it' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_by IS NULL OR (app AND NEW.confirmed_by IS DISTINCT FROM public.app_user_id()) THEN
      RAISE EXCEPTION 'an upload is decided by the signed-in user' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.file_type = 'bank_statement' THEN
      IF NEW.confirmed_by = OLD.uploaded_by OR NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id
           AND m.user_id = NEW.confirmed_by AND m.role = 'approver' AND m.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'maker-checker: a bank statement is confirmed by an active approver who did not upload it' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF app AND actor_role NOT IN ('finance', 'payment_ops') THEN
      RAISE EXCEPTION 'an upload is confirmed by Finance or Payment Operations' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by THEN
    RAISE EXCEPTION 'the confirmer is recorded only with the decision' USING ERRCODE = 'check_violation';
  ELSIF app AND OLD.status IN ('stored', 'mapped', 'validated', 'rejected') AND (actor_role IS NULL OR actor_role NOT IN ('finance', 'payment_ops')) THEN
    RAISE EXCEPTION 'uploads are mapped, validated or deleted by Finance or Payment Operations' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.template_id IS NOT NULL AND NEW.template_id IS DISTINCT FROM OLD.template_id THEN
    IF NOT public.mapping_template_usable(NEW.org_id, NEW.template_id) OR NEW.template_version IS DISTINCT FROM
       (SELECT mt.version FROM public.mapping_templates mt WHERE mt.org_id = NEW.org_id AND mt.id = NEW.template_id) THEN
      RAISE EXCEPTION 'this mapping template cannot be used for this merchant' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER uploads_check BEFORE INSERT OR UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION check_upload();
--> statement-breakpoint
CREATE TRIGGER uploads_no_delete BEFORE DELETE ON uploads FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Validation rows are written while the upload is being validated, replaced only before a decision, and afterwards
-- only gain the reference of the row they became. Retention (the owner) removes them.
CREATE FUNCTION check_upload_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE parent text;
BEGIN
  SELECT u.status INTO parent FROM public.uploads u WHERE u.org_id = coalesce(NEW.org_id, OLD.org_id) AND u.id = coalesce(NEW.upload_id, OLD.upload_id);
  IF TG_OP = 'INSERT' AND parent NOT IN ('stored', 'mapped') THEN
    RAISE EXCEPTION 'validation rows are written while an upload is validated' USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    IF pg_has_role(session_user, 'clearline_app', 'MEMBER') AND parent NOT IN ('stored', 'mapped', 'validated') THEN
      RAISE EXCEPTION 'a decided upload''s validation rows are kept until retention deletes them' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.upload_id <> OLD.upload_id OR NEW.row_number <> OLD.row_number OR NEW.status <> OLD.status
        OR NEW.reason_codes::text <> OLD.reason_codes::text OR NEW.row_hash IS DISTINCT FROM OLD.row_hash OR OLD.target_ref IS NOT NULL
        OR parent NOT IN ('confirmed', 'normalised')) THEN
    RAISE EXCEPTION 'a validation row only gains the reference of the row it became, once, after confirmation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER upload_rows_check BEFORE INSERT OR UPDATE OR DELETE ON upload_rows FOR EACH ROW EXECUTE FUNCTION check_upload_row();
--> statement-breakpoint

-- Retention is a merchant Admin's setting (the owner connection may set it too).
CREATE FUNCTION check_data_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF pg_has_role(session_user, 'clearline_app', 'MEMBER') AND (NEW.updated_by IS DISTINCT FROM public.app_user_id() OR NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.updated_by AND m.role = 'admin' AND m.revoked_at IS NULL)) THEN
    RAISE EXCEPTION 'data retention is set by an Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_data_settings_check BEFORE INSERT OR UPDATE ON merchant_data_settings FOR EACH ROW EXECUTE FUNCTION check_data_settings();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON uploads, merchant_data_settings TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON upload_rows TO clearline_app;
