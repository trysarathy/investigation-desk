-- Wave 2 integration (APPROVAL-ONLY: security controls; every change here only TIGHTENS). Runs as the schema owner.
--
-- 1. ledger_journal_drafts (c3, 0073) carries an entity but was written before wave 1's entity scope (0053): it gets the
--    same RESTRICTIVE entity_scope policy as every other table with an entity (tests/control/entity-scope.test.ts).
-- 2. The Auditor's RESTRICTIVE policies (d2, 0078) were created for the tables that existed then; the organisation
--    tables made after it (d1's job_events, period_locks, period_corrections; e2's org_data_keys) get them too. Hidden
--    from an Auditor, as 0078 does for every table outside the evidence pack, except org_data_keys: readable while the
--    Auditor's grant is active (NOT isempty), as merchant_entities is, because the server needs the organisation's
--    wrapped data keys to open the sealed addresses of the evidence pack the Auditor may download (e2). An Auditor
--    writes none of them.
-- 3. period_is_locked(org, ...) and payment_period(org, ...) (d1, 0080) are SECURITY DEFINER and took any organisation:
--    the web app's role could ask about another organisation's months and orders, or an entity outside its scope. No app
--    code calls them (the period guards call them as the owner), so the app role's EXECUTE is revoked.

CREATE POLICY entity_scope ON ledger_journal_drafts AS RESTRICTIVE FOR ALL TO clearline_app
  USING ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]))
  WITH CHECK ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]));
--> statement-breakpoint

DO $$
DECLARE
  spec text[];
  P constant text := '(SELECT app_auditor_period())';
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['job_events', 'false'], ['period_locks', 'false'], ['period_corrections', 'false'], ['org_data_keys', 'NOT isempty(' || P || ')']]
  LOOP
    EXECUTE format('CREATE POLICY auditor_read ON %I AS RESTRICTIVE FOR SELECT TO clearline_app USING (%s IS NULL OR %s)', spec[1], P, spec[2]);
    EXECUTE format('CREATE POLICY auditor_no_insert ON %I AS RESTRICTIVE FOR INSERT TO clearline_app WITH CHECK (NOT (SELECT app_is_auditor()))', spec[1]);
    EXECUTE format('CREATE POLICY auditor_no_update ON %I AS RESTRICTIVE FOR UPDATE TO clearline_app USING (NOT (SELECT app_is_auditor()))', spec[1]);
    EXECUTE format('CREATE POLICY auditor_no_delete ON %I AS RESTRICTIVE FOR DELETE TO clearline_app USING (NOT (SELECT app_is_auditor()))', spec[1]);
  END LOOP;
END $$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION period_is_locked(uuid, text, text), payment_period(uuid, text) FROM clearline_app;
