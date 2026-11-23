-- rc7 phase 1: security for rows normalised from uploads. Runs as the schema owner. No existing control is relaxed:
-- this adds checks on new columns and new sources only.

ALTER TABLE upload_row_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE upload_row_targets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON upload_row_targets USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON upload_row_targets FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON upload_row_targets TO clearline_app;
--> statement-breakpoint

-- A row may name an upload only while that upload is confirmed (being normalised), only for the file types that
-- produce it, with the upload's own uploader and template. A statement line ('file_import') additionally needs the
-- second person: the upload was confirmed by someone other than its uploader. A provider file's claimed transfer is
-- recorded unconfirmed and not final.
CREATE FUNCTION check_upload_provenance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE u record; allowed text[]; r jsonb := to_jsonb(NEW); upload uuid := (to_jsonb(NEW) ->> 'upload_id')::uuid;
BEGIN
  IF TG_TABLE_NAME = 'bank_lines' AND r ->> 'source' = 'file_import' AND upload IS NULL THEN
    RAISE EXCEPTION 'an imported statement line names its upload' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'chain_transfers' AND r ->> 'source' = 'provider_export' AND (upload IS NULL OR (r ->> 'finalised')::boolean OR (r ->> 'confirmations')::int <> 0) THEN
    RAISE EXCEPTION 'a transfer claimed by a provider file is recorded from its upload, unconfirmed and not final' USING ERRCODE = 'check_violation';
  END IF;
  IF upload IS NULL THEN RETURN NEW; END IF;
  allowed := CASE TG_TABLE_NAME WHEN 'invoices' THEN ARRAY['orders_invoices', 'provider_export']
    WHEN 'settlement_batches' THEN ARRAY['settlement_report'] WHEN 'settlement_batch_lines' THEN ARRAY['settlement_report']
    WHEN 'bank_lines' THEN ARRAY['bank_statement'] ELSE ARRAY['provider_export'] END;
  SELECT * INTO u FROM public.uploads x WHERE x.org_id = (r ->> 'org_id')::uuid AND x.id = upload;
  IF NOT FOUND OR u.status <> 'confirmed' OR NOT (u.file_type = ANY (allowed)) OR r ->> 'uploaded_by' IS DISTINCT FROM u.uploaded_by
     OR (r ->> 'mapping_template_id')::uuid IS DISTINCT FROM u.template_id OR (r ->> 'mapping_template_version')::int IS DISTINCT FROM u.template_version THEN
    RAISE EXCEPTION 'a row comes from a confirmed upload of a matching file type, with that upload''s provenance' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'bank_lines' AND (r ->> 'source' <> 'file_import' OR u.confirmed_by IS NULL OR u.confirmed_by = u.uploaded_by) THEN
    RAISE EXCEPTION 'maker-checker: a statement line is written only after a second person confirmed its upload' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'chain_transfers' AND r ->> 'source' <> 'provider_export' THEN
    RAISE EXCEPTION 'a transfer from a provider file is a provider claim (source provider_export)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION keep_upload_provenance() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.upload_id IS DISTINCT FROM OLD.upload_id OR NEW.source_row IS DISTINCT FROM OLD.source_row OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.mapping_template_id IS DISTINCT FROM OLD.mapping_template_id OR NEW.mapping_template_version IS DISTINCT FROM OLD.mapping_template_version THEN
    RAISE EXCEPTION 'a row''s upload provenance is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'chain_transfers' AND to_jsonb(OLD) ->> 'source' = 'provider_export' AND ((to_jsonb(NEW) ->> 'finalised')::boolean OR (to_jsonb(NEW) ->> 'confirmations')::int <> 0) THEN
    RAISE EXCEPTION 'a transfer claimed by a provider file is never confirmed or finalised by it; chain data must verify it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['invoices','merchant_quotes','payment_links','provider_payment_records','chain_transfers','settlement_batches',
    'settlement_batch_lines','bank_lines']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION check_upload_provenance()', tbl || '_upload_provenance', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION keep_upload_provenance()', tbl || '_provenance_immutable', tbl);
  END LOOP;
END $$;
--> statement-breakpoint

-- Targets are recorded while an upload is being normalised; afterwards only retention (the owner) removes them.
CREATE FUNCTION check_upload_target() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.uploads u WHERE u.org_id = NEW.org_id AND u.id = NEW.upload_id AND u.status = 'confirmed') THEN
    RAISE EXCEPTION 'normalised rows are recorded only while a confirmed upload is normalised' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER upload_row_targets_check BEFORE INSERT ON upload_row_targets FOR EACH ROW EXECUTE FUNCTION check_upload_target();
--> statement-breakpoint

-- A validation row gains its normalisation outcome (and target) once, while its confirmed upload is normalised.
CREATE OR REPLACE FUNCTION check_upload_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE parent text;
BEGIN
  SELECT u.status INTO parent FROM public.uploads u WHERE u.org_id = coalesce(NEW.org_id, OLD.org_id) AND u.id = coalesce(NEW.upload_id, OLD.upload_id);
  IF TG_OP = 'INSERT' AND (parent NOT IN ('stored', 'mapped') OR NEW.target_ref IS NOT NULL OR NEW.normalise_outcome IS NOT NULL) THEN
    RAISE EXCEPTION 'validation rows are written while an upload is validated' USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    IF pg_has_role(session_user, 'clearline_app', 'MEMBER') AND parent NOT IN ('stored', 'mapped', 'validated') THEN
      RAISE EXCEPTION 'a decided upload''s validation rows are kept until retention deletes them' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.upload_id <> OLD.upload_id OR NEW.row_number <> OLD.row_number OR NEW.status <> OLD.status
        OR NEW.reason_codes::text <> OLD.reason_codes::text OR NEW.row_hash IS DISTINCT FROM OLD.row_hash OR OLD.target_ref IS NOT NULL
        OR OLD.normalise_outcome IS NOT NULL OR NEW.normalise_outcome IS NULL OR parent <> 'confirmed') THEN
    RAISE EXCEPTION 'a validation row only gains its normalisation outcome, once, while its confirmed upload is normalised' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- The normalisation result is recorded once, with the move from confirmed to normalised.
CREATE FUNCTION check_upload_normalised() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (NEW.normalised_counts::text IS DISTINCT FROM OLD.normalised_counts::text OR NEW.normalised_at IS DISTINCT FROM OLD.normalised_at)
     AND NOT (OLD.status = 'confirmed' AND NEW.status = 'normalised' AND OLD.normalised_counts IS NULL AND NEW.normalised_counts IS NOT NULL AND NEW.normalised_at IS NOT NULL) THEN
    RAISE EXCEPTION 'an upload''s normalisation result is recorded once, when it is normalised' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'normalised' AND OLD.status = 'confirmed' AND NEW.normalised_counts IS NULL THEN
    RAISE EXCEPTION 'a normalised upload records its result' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER uploads_normalised_check BEFORE UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION check_upload_normalised();
