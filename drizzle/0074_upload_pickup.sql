-- v1 phase 2.1: scheduled pickup of uploads from an SFTP folder or an email inbox, optional per merchant. Runs as the
-- schema owner. No existing control is relaxed: picked-up files go through the same uploads table, triggers and
-- second-person confirmation as a file a person uploads (the upload is recorded for the source's configured Finance or
-- Payment Operations member, who can never confirm their own bank statement). Two new tables and one new column:
--   upload_pickup_sources: what to read (a folder or mailbox location and, for a real server, the NAME of the
--     environment variable / secret holding its credential, never the credential), for which entity and file type,
--     as which member, how often. Created and switched on/off by an Admin.
--   upload_pickup_items: every remote item seen (a hash of its remote identity), so nothing is read twice, with the
--     outcome (stored, duplicate, refused) and a stable code. No names, no contents.
--   uploads.pickup_source_id: the source a picked-up upload came from (set at creation, never changed).
CREATE TABLE upload_pickup_sources (
  org_id uuid NOT NULL REFERENCES organizations (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  name text NOT NULL,
  entity_id text NOT NULL,
  file_type text NOT NULL,
  bank_account_id uuid,
  template_id uuid,
  location text NOT NULL,
  credential_ref text,
  allowed_senders jsonb NOT NULL DEFAULT '[]',
  run_as_user_id text NOT NULL REFERENCES users (id),
  interval_minutes integer NOT NULL DEFAULT 60,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamp with time zone,
  created_by text NOT NULL REFERENCES users (id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT upload_pickup_sources_pk PRIMARY KEY (org_id, id),
  CONSTRAINT upload_pickup_sources_entity_fk FOREIGN KEY (org_id, entity_id) REFERENCES merchant_entities (org_id, id),
  CONSTRAINT upload_pickup_sources_bank_account_fk FOREIGN KEY (org_id, bank_account_id) REFERENCES bank_accounts (org_id, id),
  CONSTRAINT upload_pickup_sources_template_fk FOREIGN KEY (org_id, template_id) REFERENCES mapping_templates (org_id, id),
  CONSTRAINT upload_pickup_sources_kind_chk CHECK (kind IN ('sftp', 'email')),
  CONSTRAINT upload_pickup_sources_name_chk CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT upload_pickup_sources_type_chk CHECK (file_type IN ('provider_export','settlement_report','orders_invoices','bank_statement','ledger_invoices','settlement_payments')),
  CONSTRAINT upload_pickup_sources_bank_chk CHECK ((file_type = 'bank_statement') = (bank_account_id IS NOT NULL)),
  -- a relative folder or mailbox name: letters, digits, . _ - and /, no "..", no leading /
  CONSTRAINT upload_pickup_sources_location_chk CHECK (location ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' AND location !~ '(^|/)\.\.?(/|$)' AND length(location) <= 300),
  CONSTRAINT upload_pickup_sources_credential_chk CHECK (credential_ref IS NULL OR credential_ref ~ '^CLEARLINE_PICKUP_[A-Z0-9_]{1,64}$'),
  CONSTRAINT upload_pickup_sources_senders_chk CHECK (jsonb_typeof(allowed_senders) = 'array' AND jsonb_array_length(allowed_senders) <= 50
    AND (kind <> 'email' OR jsonb_array_length(allowed_senders) >= 1) AND (kind <> 'sftp' OR jsonb_array_length(allowed_senders) = 0)),
  CONSTRAINT upload_pickup_sources_interval_chk CHECK (interval_minutes BETWEEN 5 AND 1440)
);
--> statement-breakpoint
CREATE TABLE upload_pickup_items (
  org_id uuid NOT NULL REFERENCES organizations (id),
  source_id uuid NOT NULL,
  item_key text NOT NULL,
  outcome text NOT NULL,
  code text,
  upload_id uuid,
  picked_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT upload_pickup_items_pk PRIMARY KEY (org_id, source_id, item_key),
  CONSTRAINT upload_pickup_items_source_fk FOREIGN KEY (org_id, source_id) REFERENCES upload_pickup_sources (org_id, id),
  CONSTRAINT upload_pickup_items_upload_fk FOREIGN KEY (org_id, upload_id) REFERENCES uploads (org_id, id),
  CONSTRAINT upload_pickup_items_key_chk CHECK (item_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT upload_pickup_items_outcome_chk CHECK (outcome IN ('stored', 'duplicate', 'refused')),
  CONSTRAINT upload_pickup_items_code_chk CHECK (code IS NULL OR code ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT upload_pickup_items_upload_chk CHECK ((outcome = 'stored') = (upload_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE uploads ADD COLUMN pickup_source_id uuid;
--> statement-breakpoint
ALTER TABLE uploads ADD CONSTRAINT uploads_pickup_source_fk FOREIGN KEY (org_id, pickup_source_id) REFERENCES upload_pickup_sources (org_id, id);
--> statement-breakpoint
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['upload_pickup_sources', 'upload_pickup_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format($p$CREATE POLICY merchant_isolation ON %I USING (org_id = app_org_id() AND app_is_member(org_id))
                     WITH CHECK (org_id = app_org_id() AND app_is_member(org_id))$p$, tbl);
  END LOOP;
END $$;
--> statement-breakpoint
-- entity scope (0053): a scoped member sees only its entities' sources, and their items through the source
CREATE POLICY entity_scope ON upload_pickup_sources AS RESTRICTIVE FOR ALL TO clearline_app
  USING ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]))
  WITH CHECK ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]));
--> statement-breakpoint
CREATE POLICY entity_scope ON upload_pickup_items AS RESTRICTIVE FOR ALL TO clearline_app
  USING ((SELECT app_entity_scope()) IS NULL OR EXISTS (SELECT 1 FROM upload_pickup_sources p WHERE p.org_id = upload_pickup_items.org_id AND p.id = upload_pickup_items.source_id))
  WITH CHECK ((SELECT app_entity_scope()) IS NULL OR EXISTS (SELECT 1 FROM upload_pickup_sources p WHERE p.org_id = upload_pickup_items.org_id AND p.id = upload_pickup_items.source_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON upload_pickup_sources TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON upload_pickup_items TO clearline_app;
--> statement-breakpoint
CREATE TRIGGER upload_pickup_items_no_change BEFORE UPDATE OR DELETE ON upload_pickup_items FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER upload_pickup_sources_no_delete BEFORE DELETE ON upload_pickup_sources FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Who may do what with a source (the app also checks; this is the database's own guard):
--   create: an active Admin of a LIVE merchant, for a member who uploads (Finance or Payment Operations) and whose
--     entity scope covers the source's entity; created_by is the Admin;
--   change: only `enabled` (an Admin) and `last_run_at` (the run, as the configured member); nothing else ever changes.
CREATE FUNCTION check_pickup_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  app boolean := pg_has_role(session_user, 'clearline_app', 'MEMBER');
  actor text := public.app_member_role(NEW.org_id);
  runner text;
  scoped boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT o.data_mode FROM public.organizations o WHERE o.id = NEW.org_id AND o.kind = 'merchant') IS DISTINCT FROM 'live' THEN
      RAISE EXCEPTION 'pickup is configured for a live merchant organisation only' USING ERRCODE = 'check_violation';
    END IF;
    SELECT m.role, m.entity_scoped INTO runner, scoped FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.run_as_user_id AND m.revoked_at IS NULL;
    IF runner IS NULL OR runner NOT IN ('finance', 'payment_ops') THEN
      RAISE EXCEPTION 'a pickup source runs as an active Finance or Payment Operations member' USING ERRCODE = 'check_violation';
    END IF;
    IF scoped AND NOT EXISTS (SELECT 1 FROM public.membership_entity_scopes s WHERE s.org_id = NEW.org_id AND s.user_id = NEW.run_as_user_id AND s.entity_id = NEW.entity_id) THEN
      RAISE EXCEPTION 'the pickup member cannot act on this entity' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.last_run_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new pickup source has not run' USING ERRCODE = 'check_violation';
    END IF;
    IF app AND (actor IS DISTINCT FROM 'admin' OR NEW.created_by IS DISTINCT FROM public.app_user_id()) THEN
      RAISE EXCEPTION 'a pickup source is created by the signed-in Admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'enabled' - 'last_run_at') <> (to_jsonb(OLD) - 'enabled' - 'last_run_at') THEN
    RAISE EXCEPTION 'a pickup source changes only its on/off switch and last run time' USING ERRCODE = 'check_violation';
  END IF;
  IF app AND NEW.enabled IS DISTINCT FROM OLD.enabled AND actor IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'a pickup source is switched on or off by an Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app AND NEW.last_run_at IS DISTINCT FROM OLD.last_run_at AND public.app_user_id() IS DISTINCT FROM OLD.run_as_user_id THEN
    RAISE EXCEPTION 'a pickup run is recorded by its configured member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_pickup_source() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER upload_pickup_sources_check BEFORE INSERT OR UPDATE ON upload_pickup_sources FOR EACH ROW EXECUTE FUNCTION check_pickup_source();
--> statement-breakpoint

-- An upload names a pickup source only when it is recorded for that source's member, from an enabled source of the
-- same entity and file type; and the link never changes afterwards.
CREATE FUNCTION check_upload_pickup_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pickup_source_id IS DISTINCT FROM OLD.pickup_source_id THEN
      RAISE EXCEPTION 'an upload''s pickup source never changes' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.pickup_source_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.upload_pickup_sources p WHERE p.org_id = NEW.org_id AND p.id = NEW.pickup_source_id
       AND p.enabled AND p.run_as_user_id = NEW.uploaded_by AND p.entity_id = NEW.entity_id AND p.file_type = NEW.file_type
       AND p.bank_account_id IS NOT DISTINCT FROM NEW.bank_account_id) THEN
    RAISE EXCEPTION 'a picked-up upload comes from an enabled source of its entity and file type, as that source''s member' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_upload_pickup_source() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER uploads_pickup_source BEFORE INSERT OR UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION check_upload_pickup_source();
--> statement-breakpoint
-- The items' outcome is written by the run (as the source's member) for its own source only.
CREATE FUNCTION check_pickup_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF pg_has_role(session_user, 'clearline_app', 'MEMBER') AND NOT EXISTS (SELECT 1 FROM public.upload_pickup_sources p
       WHERE p.org_id = NEW.org_id AND p.id = NEW.source_id AND p.run_as_user_id = public.app_user_id()) THEN
    RAISE EXCEPTION 'pickup items are recorded by their source''s member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.upload_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.uploads u WHERE u.org_id = NEW.org_id AND u.id = NEW.upload_id AND u.pickup_source_id = NEW.source_id) THEN
    RAISE EXCEPTION 'a stored pickup item names an upload from its own source' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION check_pickup_item() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER upload_pickup_items_check BEFORE INSERT ON upload_pickup_items FOR EACH ROW EXECUTE FUNCTION check_pickup_item();
