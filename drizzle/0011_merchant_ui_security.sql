-- rc6 phase 7: security for the merchant reconciliation screens. Runs as the schema owner.

-- Exception notes and attached evidence: merchant rows like any other (forced RLS, provider read only under a full
-- grant), append-only for everyone, written only as the signed-in user.
ALTER TABLE recon_exception_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recon_exception_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON recon_exception_notes USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND author_user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON recon_exception_notes FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
CREATE TRIGGER recon_exception_notes_append_only BEFORE UPDATE OR DELETE ON recon_exception_notes FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT, INSERT ON recon_exception_notes TO clearline_app;
--> statement-breakpoint

-- An exception is assigned only to an active member of its own merchant; its reason, next step and order never change
-- through the app (only a reconciliation run, as the same transaction's tenant, rewrites them).
CREATE FUNCTION check_exception_owner() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.owner_user_id AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'an exception is assigned only to an active member of its merchant' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'an exception belongs to its payment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recon_exceptions_owner BEFORE UPDATE ON recon_exceptions FOR EACH ROW EXECUTE FUNCTION check_exception_owner();
--> statement-breakpoint

-- White-label: a merchant's members read only their provider's display name and theme (never its other columns or
-- rows); a provider's members read their own. Nothing else about the provider is disclosed.
CREATE FUNCTION merchant_provider_theme() RETURNS TABLE (provider_name text, theme jsonb, org_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN o.kind = 'provider' THEN o.name ELSE p.name END,
         CASE WHEN o.kind = 'provider' THEN o.theme ELSE p.theme END,
         o.kind
  FROM public.organizations o LEFT JOIN public.organizations p ON p.id = o.provider_org_id AND p.kind = 'provider'
  WHERE o.id = public.app_org_id() AND public.app_is_member(o.id)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION merchant_provider_theme() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION merchant_provider_theme() TO clearline_app;
