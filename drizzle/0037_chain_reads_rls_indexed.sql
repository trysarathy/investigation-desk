-- v1 phase 0 (APPROVAL-ONLY: changes a security control). chain_reads' row-level security policies, rewritten so the
-- organisation check is ONE indexed predicate, "org_id = ANY(<the organisations this statement may read>)", and the
-- SECURITY DEFINER membership and grant checks run ONCE per statement (an InitPlan) instead of once per row.
-- Runs as the schema owner. Who may read and write which rows is unchanged:
--
--   before (0022, kept in 0036):
--     merchant_isolation (ALL):          USING / WITH CHECK  org_id = app_org_id() AND app_is_member(org_id)   per row
--     provider_full_grant_read (SELECT): USING               app_provider_full_access(org_id)                  per row
--   after:
--     chain_reads_read (SELECT):   USING       org_id = ANY ((SELECT app_readable_org_ids())::uuid[])          once
--     chain_reads_insert (INSERT): WITH CHECK  org_id = app_org_id() AND (SELECT app_is_member(app_org_id()))  once
--
-- Why the rows are the same:
--   * app_readable_org_ids() = {app_org_id()} when app_is_member(app_org_id()), plus every merchant m for which
--     app_provider_full_access(m) holds (app_provider_full_access_merchants(): the same joins and conditions as
--     app_provider_full_access, returning the set instead of testing one id). A row was readable before iff
--     (org_id = app_org_id() AND app_is_member(org_id)) OR app_provider_full_access(org_id) — i.e. iff org_id is in
--     that set. STABLE functions see one snapshot per statement, so the once-per-statement answer equals the
--     per-row answer.
--   * Inserts: wherever org_id = app_org_id() holds, app_is_member(org_id) = app_is_member(app_org_id()).
--   * merchant_isolation also covered UPDATE and DELETE; the app login holds neither privilege on chain_reads and the
--     append-only trigger refuses both for everyone, so no UPDATE/DELETE policy (= deny) keeps them refused.
--
-- Before, the two SELECT policies were OR-ed with a per-row SECURITY DEFINER call on each side, so the organisation
-- check could not be an index condition: a query without its own org filter (count(*), a provider read) walked every
-- row of every organisation, and every query paid two function calls per candidate row.

CREATE FUNCTION app_provider_full_access_merchants() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(g.merchant_org_id), '{}'::uuid[]) FROM public.provider_grants g
  JOIN public.organizations m ON m.id = g.merchant_org_id AND m.provider_org_id = g.provider_org_id
  WHERE g.provider_org_id = public.app_org_id()
    AND g.scope = 'full' AND g.revoked_at IS NULL AND public.app_is_member(g.provider_org_id)
$$;
--> statement-breakpoint
CREATE FUNCTION app_readable_org_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN public.app_is_member(public.app_org_id()) THEN ARRAY[public.app_org_id()] ELSE '{}'::uuid[] END
         || public.app_provider_full_access_merchants()
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_provider_full_access_merchants(), app_readable_org_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_provider_full_access_merchants(), app_readable_org_ids() TO clearline_app;
--> statement-breakpoint
DROP POLICY merchant_isolation ON chain_reads;
--> statement-breakpoint
DROP POLICY provider_full_grant_read ON chain_reads;
--> statement-breakpoint
-- The cast makes the scalar subquery an array expression (not "= ANY (subquery)"), so it is one InitPlan whose
-- result the index scan uses.
CREATE POLICY chain_reads_read ON chain_reads FOR SELECT
  USING (org_id = ANY ((SELECT app_readable_org_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY chain_reads_insert ON chain_reads FOR INSERT
  WITH CHECK (org_id = app_org_id() AND (SELECT app_is_member(app_org_id())));
