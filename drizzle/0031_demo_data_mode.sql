-- Demo build: a third organisation data mode, 'demo' ("Demo · fictional data"). Runs as the schema owner.
-- A demo organisation holds fictional data only, like 'sample', but goes through the real upload pipeline like 'live'
-- (every upload, confirmation, second-person and provenance rule unchanged). Nothing else changes: the runtime login's
-- grants and policies are untouched, and only the owner can set an organisation's mode. Recorded chain data is still
-- refused for every organisation outside a demo build (src/server/demo-build.ts); this migration only adds the value.
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_data_mode_chk";
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_data_mode_chk" CHECK ("organizations"."data_mode" in ('sample','live','demo'));
--> statement-breakpoint
-- check_upload (0019), unchanged except that a demo merchant organisation may also receive uploads.
CREATE OR REPLACE FUNCTION check_upload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  app boolean := pg_has_role(session_user, 'clearline_app', 'MEMBER');
  actor_role text;
BEGIN
  IF app THEN
    SELECT m.role INTO actor_role FROM public.organization_memberships m
    WHERE m.org_id = NEW.org_id AND m.user_id = public.app_user_id() AND m.revoked_at IS NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE((SELECT o.data_mode FROM public.organizations o WHERE o.id = NEW.org_id AND o.kind = 'merchant'), '') NOT IN ('live', 'demo') THEN
      RAISE EXCEPTION 'uploads go to a live merchant organisation (or a demo one); sample organisations hold fictional data only' USING ERRCODE = 'check_violation';
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
