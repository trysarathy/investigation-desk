-- v1 wave 1 integration (security control, tightens only): the setup wizard's provisioning functions (0049) are
-- SECURITY DEFINER, so the entity-scope policies of 0053 (written after them, for the runtime role) do not apply inside
-- them. An Admin limited to some entities could otherwise add entities, bank accounts, ledgers or members for the
-- whole organisation through the wizard. Like every other organisation-wide change (0053), setup now needs an
-- UNSCOPED Admin membership. Runs as the schema owner. Only prov_admin_org() changes; every wizard function calls it.
CREATE OR REPLACE FUNCTION prov_admin_org() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.app_org_id(); u text := public.app_user_id();
BEGIN
  IF o IS NULL OR u IS NULL THEN PERFORM public.prov_refuse('no signed-in user and organisation in this transaction'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = o AND m.user_id = u AND m.role = 'admin' AND m.revoked_at IS NULL) THEN
    PERFORM public.prov_refuse('only an Admin of this organisation runs its setup');
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = o AND m.user_id = u AND m.revoked_at IS NULL AND m.entity_scoped) THEN
    PERFORM public.prov_refuse('setup changes the whole organisation: an Admin limited to some entities cannot run it');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = o AND kind = 'merchant') THEN PERFORM public.prov_refuse('setup is for a merchant organisation'); END IF;
  RETURN o;
END $$;
