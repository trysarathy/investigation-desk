-- rc6 phase 8: security for the provider console (onboarding, invitations, pilot metrics). Runs as the schema owner.

-- Onboarding and invitation records live in the PROVIDER's tenancy: only its members read them.
ALTER TABLE merchant_onboarding ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant_onboarding FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY provider_isolation ON merchant_onboarding USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND updated_by = app_user_id());
--> statement-breakpoint
ALTER TABLE merchant_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY provider_isolation ON merchant_invitations USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND invited_by = app_user_id());
--> statement-breakpoint

-- Through the app, only an active Provider Admin writes them, only for a merchant of THIS provider, one revision at a
-- time. The owner connection (the admin CLI accepting an invitation) is not the app.
CREATE FUNCTION check_provider_onboarding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF pg_has_role(session_user, 'clearline_app', 'MEMBER') THEN
    IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = public.app_user_id()
                   AND m.role = 'provider_admin' AND m.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'only a Provider Admin onboards merchants' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.merchant_org_id AND o.kind = 'merchant' AND o.provider_org_id = NEW.org_id) THEN
      RAISE EXCEPTION 'not a merchant of this provider' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'merchant_onboarding' THEN
      IF TG_OP = 'UPDATE' AND (NEW.merchant_org_id <> OLD.merchant_org_id OR NEW.revision <> OLD.revision + 1) THEN
        RAISE EXCEPTION 'onboarding changes one revision at a time' USING ERRCODE = 'check_violation';
      ELSIF TG_OP = 'INSERT' AND NEW.revision <> 1 THEN
        RAISE EXCEPTION 'onboarding starts at revision 1' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'an invitation is created pending' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_onboarding_check BEFORE INSERT OR UPDATE ON merchant_onboarding FOR EACH ROW EXECUTE FUNCTION check_provider_onboarding();
--> statement-breakpoint
CREATE TRIGGER merchant_invitations_check BEFORE INSERT OR UPDATE ON merchant_invitations FOR EACH ROW EXECUTE FUNCTION check_provider_onboarding();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON merchant_onboarding TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON merchant_invitations TO clearline_app;
--> statement-breakpoint

-- A merchant's members read the policy defaults and column mapping their provider PROPOSED (never its other rows).
CREATE FUNCTION merchant_onboarding_proposal() RETURNS TABLE (provider_name text, policy_defaults jsonb, column_mapping jsonb, revision integer, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT p.name, ob.policy_defaults, ob.column_mapping, ob.revision, ob.updated_at
  FROM public.organizations m
  JOIN public.organizations p ON p.id = m.provider_org_id AND p.kind = 'provider'
  JOIN public.merchant_onboarding ob ON ob.org_id = p.id AND ob.merchant_org_id = m.id
  WHERE m.id = public.app_org_id() AND m.kind = 'merchant' AND public.app_is_member(m.id)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION merchant_onboarding_proposal() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION merchant_onboarding_proposal() TO clearline_app;
--> statement-breakpoint

-- Pilot metrics for the provider console: aggregates of the provider's own merchants only, no rows. "Batches tied"
-- counts the distinct settlement batches named on match records, and those whose records say tied to the cent.
CREATE FUNCTION provider_pilot_metrics(provider uuid)
RETURNS TABLE (merchant_org_id uuid, merchant_name text, payments bigint, auto_matched bigint, reviewed bigint, reviewed_wrong bigint,
               exceptions_total bigint, exceptions_open bigint, median_minutes_to_resolve double precision, batches bigint, batches_tied bigint, minutes_logged bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.id, m.name,
         (SELECT count(*) FROM public.match_records r WHERE r.org_id = m.id),
         (SELECT count(*) FROM public.match_records r WHERE r.org_id = m.id AND r.decision IN ('matched','matched_with_difference')),
         (SELECT count(DISTINCT v.order_id) FROM public.match_reviews v WHERE v.org_id = m.id),
         (SELECT count(DISTINCT v.order_id) FROM public.match_reviews v WHERE v.org_id = m.id AND v.verdict = 'wrong'),
         (SELECT count(*) FROM public.recon_exceptions e WHERE e.org_id = m.id),
         (SELECT count(*) FROM public.recon_exceptions e WHERE e.org_id = m.id AND e.status <> 'resolved'),
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.closed_at - e.opened_at) / 60)
            FROM public.recon_exceptions e WHERE e.org_id = m.id AND e.closed_at IS NOT NULL),
         (SELECT count(DISTINCT b) FROM public.match_records r, jsonb_array_elements_text(r.bank -> 'batchIds') b WHERE r.org_id = m.id),
         (SELECT count(DISTINCT b) FROM public.match_records r, jsonb_array_elements_text(r.bank -> 'batchIds') b WHERE r.org_id = m.id AND (r.bank ->> 'batchTied')::boolean),
         (SELECT coalesce(sum(l.minutes), 0) FROM public.pilot_time_log l WHERE l.org_id = m.id)
  FROM public.organizations m
  WHERE m.kind = 'merchant' AND m.provider_org_id = provider
    AND provider = public.app_org_id() AND public.app_is_member(provider)
    AND EXISTS (SELECT 1 FROM public.organization_memberships pm WHERE pm.org_id = provider AND pm.user_id = public.app_user_id()
                AND pm.revoked_at IS NULL AND pm.role IN ('provider_admin','provider_ops'))
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION provider_pilot_metrics(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION provider_pilot_metrics(uuid) TO clearline_app;
