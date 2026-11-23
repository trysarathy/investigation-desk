-- rc7 phase 1: security for mapping templates. Runs as the schema owner.

-- Merchant rows like any other: forced RLS, provider read only under the merchant's explicit full grant.
ALTER TABLE mapping_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mapping_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON mapping_templates USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON mapping_templates FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint

-- A template is created for a merchant; a provider-file template only for the merchant's OWN provider; versions count
-- up one at a time per (merchant, file type, name). Through the app, only the signed-in Finance or Payment Operations
-- member creates one.
CREATE FUNCTION check_mapping_template() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE merchant record; latest integer;
BEGIN
  SELECT kind, provider_org_id INTO merchant FROM public.organizations WHERE id = NEW.org_id;
  IF merchant.kind IS DISTINCT FROM 'merchant' THEN
    RAISE EXCEPTION 'mapping templates belong to a merchant' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.provider_org_id IS NOT NULL AND NEW.provider_org_id IS DISTINCT FROM merchant.provider_org_id THEN
    RAISE EXCEPTION 'a mapping template reads files of the merchant''s own provider only' USING ERRCODE = 'check_violation';
  END IF;
  IF pg_has_role(session_user, 'clearline_app', 'MEMBER') THEN
    IF NEW.created_by IS DISTINCT FROM public.app_user_id() OR NOT EXISTS (
         SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.created_by
         AND m.role IN ('finance', 'payment_ops') AND m.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'a mapping template is created by the signed-in Finance or Payment Operations member' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  SELECT max(version) INTO latest FROM public.mapping_templates WHERE org_id = NEW.org_id AND file_type = NEW.file_type AND name = NEW.name;
  IF NEW.version <> coalesce(latest, 0) + 1 THEN
    RAISE EXCEPTION 'a mapping template changes one version at a time (expected %)', coalesce(latest, 0) + 1 USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER mapping_templates_check BEFORE INSERT ON mapping_templates FOR EACH ROW EXECUTE FUNCTION check_mapping_template();
--> statement-breakpoint
-- Versions are immutable: a change is a new version.
CREATE TRIGGER mapping_templates_immutable BEFORE UPDATE OR DELETE ON mapping_templates FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- Whether a template may be used for this merchant now: it is the merchant's, and a provider-file template still
-- reads the merchant's current provider. Runs as the caller, so RLS applies.
CREATE FUNCTION mapping_template_usable(org uuid, template uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.mapping_templates mt JOIN public.organizations m ON m.id = mt.org_id
                 WHERE mt.org_id = org AND mt.id = template AND m.kind = 'merchant'
                   AND (mt.provider_org_id IS NULL OR mt.provider_org_id = m.provider_org_id))
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION mapping_template_usable(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mapping_template_usable(uuid, uuid) TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON mapping_templates TO clearline_app;
