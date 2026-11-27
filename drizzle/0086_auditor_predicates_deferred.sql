-- Wave 2 integration (APPROVAL-ONLY: a security control is re-expressed; what an Auditor sees is unchanged).
-- d2's auditor_read policies (0078) put each visibility predicate INLINE. A predicate that looks at a parent table
-- (EXISTS on invoices, recon_exceptions, ...) is expanded with that parent's own policies, which hold more such
-- predicates: on the integrated stack the unread-notifications count of every Control page planned 604 InitPlans and
-- spent ~410 ms in executor start-up (EXPLAIN ANALYZE on the demo world), so the demo's 1 s page budget failed.
-- Here every such predicate moves, word for word (0078's list, repeated below), into a SECURITY INVOKER plpgsql
-- function of the row (auditor_sees_<table>): it runs as the same role, so the parent tables' row-level security
-- applies exactly as in the inline form, but it is planned only when it is called, i.e. only for an Auditor. For
-- everyone else (SELECT app_auditor_period()) IS NULL is true and the function is never reached.
DO $do$
DECLARE
  rel record;
  fn text;
  P constant text := '(SELECT app_auditor_period())';
  -- (an Auditor with no active grant has the empty period: even the organisation's member and entity lists are hidden)
  -- a row's date inside the period, exactly: the entity's own calendar date for invoices and chain transfers (as the
  -- evidence pack counts a month), the provider's (UTC) day for settlement batches, the bank's value date for bank lines
  local_in constant text := '(((%1$s AT TIME ZONE ''UTC'') + make_interval(mins => (SELECT e.utc_offset_minutes FROM merchant_entities e WHERE e.org_id = %2$I.org_id AND e.id = %2$I.entity_id)))::date <@ ' || P || ')';
  allow jsonb := jsonb_build_object(
    'organization_memberships', 'NOT isempty(' || P || ')',
    'membership_entity_scopes', 'NOT isempty(' || P || ')',
    'merchant_entities', 'NOT isempty(' || P || ')',
    'auditor_grants', 'NOT isempty(' || P || ')',
    'invoices', format(local_in, 'issued_at', 'invoices'),
    'chain_transfers', format(local_in, 'block_time', 'chain_transfers'),
    'settlement_batches', '((day_start AT TIME ZONE ''UTC'')::date <@ ' || P || ')',
    'bank_lines', '(CASE WHEN value_date ~ ''^\d{4}-\d{2}-\d{2}$'' THEN value_date::date <@ ' || P || ' ELSE false END)',
    'merchant_journal_proposals', '(CASE WHEN (evidence_refs ->> ''entryDate'') ~ ''^\d{4}-\d{2}-\d{2}$'' THEN (evidence_refs ->> ''entryDate'')::date <@ ' || P || ' ELSE false END)',
    'match_records', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = match_records.org_id AND p.order_id = match_records.order_id)',
    'differences', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = differences.org_id AND p.order_id = differences.order_id)',
    'writeoff_proposals', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = writeoff_proposals.org_id AND p.order_id = writeoff_proposals.order_id)',
    'merchant_quotes', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = merchant_quotes.org_id AND p.order_id = merchant_quotes.order_id)',
    'payment_links', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = payment_links.org_id AND p.order_id = payment_links.order_id)',
    'provider_payment_records', '(EXISTS (SELECT 1 FROM merchant_quotes p WHERE p.org_id = provider_payment_records.org_id AND p.quote_id = provider_payment_records.quote_id)
       OR EXISTS (SELECT 1 FROM payment_links p WHERE p.org_id = provider_payment_records.org_id AND p.link_id = provider_payment_records.link_id))',
    'settlement_batch_lines', 'EXISTS (SELECT 1 FROM settlement_batches p WHERE p.org_id = settlement_batch_lines.org_id AND p.batch_id = settlement_batch_lines.batch_id)',
    'settlement_payment_lines', 'EXISTS (SELECT 1 FROM settlement_batches p WHERE p.org_id = settlement_payment_lines.org_id AND p.batch_id = settlement_payment_lines.batch_id)',
    'recon_exceptions', '(CASE WHEN order_id IS NOT NULL THEN EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = recon_exceptions.org_id AND p.order_id = recon_exceptions.order_id)
       ELSE (opened_at AT TIME ZONE ''UTC'')::date <@ ' || P || ' END)',
    'recon_exception_notes', 'EXISTS (SELECT 1 FROM recon_exceptions p WHERE p.org_id = recon_exception_notes.org_id AND p.id = recon_exception_notes.exception_id)',
    'approval_requests', '((subject_kind = ''merchant_writeoff'' AND EXISTS (SELECT 1 FROM writeoff_proposals p WHERE p.org_id = approval_requests.org_id AND p.id = approval_requests.subject_id))
       OR (subject_kind = ''merchant_resolution'' AND EXISTS (SELECT 1 FROM recon_exceptions p WHERE p.org_id = approval_requests.org_id AND p.id = approval_requests.subject_id)))',
    'approval_decisions', 'EXISTS (SELECT 1 FROM approval_requests p WHERE p.org_id = approval_decisions.org_id AND p.id = approval_decisions.request_id)',
    'audit_events', '(actor_user_id = app_user_id()
       OR EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = audit_events.org_id AND p.order_id = audit_events.entity_id)
       OR EXISTS (SELECT 1 FROM recon_exceptions p WHERE p.org_id = audit_events.org_id AND p.id = audit_events.entity_id)
       OR EXISTS (SELECT 1 FROM writeoff_proposals p WHERE p.org_id = audit_events.org_id AND p.id = audit_events.entity_id)
       OR EXISTS (SELECT 1 FROM approval_requests p WHERE p.org_id = audit_events.org_id AND p.id::text = audit_events.entity_id)
       OR EXISTS (SELECT 1 FROM settlement_batches p WHERE p.org_id = audit_events.org_id AND p.batch_id = audit_events.entity_id))');
BEGIN
  FOR rel IN SELECT key AS t, value AS p FROM jsonb_each_text(allow) WHERE value LIKE '%SELECT%' ORDER BY key LOOP
    fn := 'auditor_sees_' || rel.t;
    -- the predicate is evaluated against the row under the table's own name, so qualified and bare column names
    -- resolve exactly as in the policy
    EXECUTE format($f$CREATE FUNCTION %I(r public.%I) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
      SET search_path = pg_catalog, public, pg_temp AS $b$ BEGIN RETURN (SELECT %s FROM (SELECT (r).*) AS %I); END $b$ $f$, fn, rel.t, rel.p, rel.t);
    EXECUTE format('REVOKE ALL ON FUNCTION %I(public.%I) FROM PUBLIC', fn, rel.t);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I(public.%I) TO clearline_app', fn, rel.t);
    EXECUTE format('ALTER POLICY auditor_read ON %I USING (%s IS NULL OR %I(%I))', rel.t, P, fn, rel.t);
  END LOOP;
END $do$;
