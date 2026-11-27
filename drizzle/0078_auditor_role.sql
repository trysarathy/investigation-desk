-- v1 phase 4 (APPROVAL-ONLY: a new role and a security control; it relaxes nothing for any existing role).
-- The Auditor: read-only, scoped to one period (whole months) and optionally to some entities (the existing entity
-- scope of 0053), time-limited, every download audited. Runs as the schema owner.
--
-- Enforced here, for the app role only, by RESTRICTIVE policies (AND-ed with every existing permissive policy, none
-- of which changes; for every other role each new predicate is true after one InitPlan per statement):
--   * an Auditor writes nothing, except the audit rows of its own downloads (actor = itself);
--   * an Auditor reads only the tables an evidence pack is made of, and only rows of the granted period:
--       dated rows (invoices, chain transfers, bank lines, settlement batches, journal proposals) whose date is within
--       the period (the entity's calendar date where the evidence pack uses it); rows hanging off them (match records, differences,
--       write-offs, quotes, links, provider records, batch lines, exceptions and notes, approvals, audit rows) only
--       when their parent is visible; every other organisation table not at all;
--   * no active grant (expired, revoked, not yet made) = the empty period = nothing.
-- An order belongs to the period by its invoice's issue date [decision recorded in the report: the most conservative
-- reading; a payment received in the period for an invoice issued before it needs a grant covering both months].
-- Grants are written only by the provisioning path (owner connection, `npm run control:admin -- grant-auditor`).

INSERT INTO roles (code, description) VALUES
  ('auditor', 'Auditor: read only, one period (and optionally some entities), time-limited; downloads evidence packs')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

CREATE TABLE auditor_grants (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  org_id uuid NOT NULL,
  user_id text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  granted_by text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT auditor_grants_membership_fk FOREIGN KEY (org_id, user_id) REFERENCES organization_memberships (org_id, user_id),
  -- whole months, at most twelve
  CONSTRAINT auditor_grants_period_chk CHECK (period_start = date_trunc('month', period_start)::date
    AND period_end = (date_trunc('month', period_end) + interval '1 month' - interval '1 day')::date
    AND period_end >= period_start AND period_end < (period_start + interval '12 months')::date),
  -- time-limited: at most 90 days from the grant
  CONSTRAINT auditor_grants_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days'),
  CONSTRAINT auditor_grants_by_chk CHECK (length(granted_by) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX auditor_grants_member_idx ON auditor_grants (org_id, user_id, created_at DESC);
--> statement-breakpoint
-- append-only: a grant is never edited or deleted; it is revoked once
CREATE FUNCTION auditor_grant_locked() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'auditor grants are append-only' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
     OR (NEW.id, NEW.org_id, NEW.user_id, NEW.period_start, NEW.period_end, NEW.expires_at, NEW.granted_by, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.org_id, OLD.user_id, OLD.period_start, OLD.period_end, OLD.expires_at, OLD.granted_by, OLD.created_at) THEN
    RAISE EXCEPTION 'an auditor grant is never changed; it is revoked once' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER auditor_grants_locked BEFORE UPDATE OR DELETE ON auditor_grants FOR EACH ROW EXECUTE FUNCTION auditor_grant_locked();
--> statement-breakpoint

-- Whether the context's member is an Auditor of the context's organisation (an active membership with that role).
CREATE FUNCTION app_is_auditor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = public.app_org_id() AND m.user_id = public.app_user_id()
                 AND m.role = 'auditor' AND m.revoked_at IS NULL)
$$;
--> statement-breakpoint
-- NULL = not an Auditor (no restriction from these policies); otherwise the period of the newest active grant,
-- or 'empty' when there is none (expired, revoked or never made): every dated predicate is then false.
CREATE FUNCTION app_auditor_period() RETURNS daterange LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN NOT public.app_is_auditor() THEN NULL ELSE coalesce(
    (SELECT daterange(g.period_start, g.period_end, '[]') FROM public.auditor_grants g
      WHERE g.org_id = public.app_org_id() AND g.user_id = public.app_user_id() AND g.revoked_at IS NULL AND g.expires_at > now()
      ORDER BY g.created_at DESC LIMIT 1), 'empty'::daterange) END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_is_auditor() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_auditor_period() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_auditor() TO clearline_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_auditor_period() TO clearline_app;
--> statement-breakpoint

ALTER TABLE auditor_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auditor_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- the Auditor reads its own grants (to build its session's context); an Admin with every entity reads the organisation's
CREATE POLICY grant_read ON auditor_grants FOR SELECT USING (user_id = app_user_id() OR (org_id = app_org_id() AND app_is_unscoped_admin(org_id)));
--> statement-breakpoint
GRANT SELECT ON auditor_grants TO clearline_app;
--> statement-breakpoint

DO $$
DECLARE
  rel record;
  pred text;
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
  -- every organisation table with row-level security (org_id, merchant_org_id or provider_org_id), except organizations
  -- (member_read only) — a table NOT in the list above is hidden from an Auditor entirely
  FOR rel IN SELECT DISTINCT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname IN ('org_id', 'merchant_org_id', 'provider_org_id') AND NOT a.attisdropped
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relrowsecurity AND c.relname <> 'organizations'
             ORDER BY c.relname
  LOOP
    pred := coalesce(allow ->> rel.relname, 'false');
    EXECUTE format('CREATE POLICY auditor_read ON %I AS RESTRICTIVE FOR SELECT TO clearline_app USING (%s IS NULL OR %s)', rel.relname, P, pred);
    EXECUTE format('CREATE POLICY auditor_no_insert ON %I AS RESTRICTIVE FOR INSERT TO clearline_app WITH CHECK (NOT (SELECT app_is_auditor())%s)', rel.relname,
      CASE WHEN rel.relname = 'audit_events' THEN ' OR actor_user_id = app_user_id()' ELSE '' END);
    EXECUTE format('CREATE POLICY auditor_no_update ON %I AS RESTRICTIVE FOR UPDATE TO clearline_app USING (NOT (SELECT app_is_auditor()))', rel.relname);
    EXECUTE format('CREATE POLICY auditor_no_delete ON %I AS RESTRICTIVE FOR DELETE TO clearline_app USING (NOT (SELECT app_is_auditor()))', rel.relname);
  END LOOP;
END $$;
