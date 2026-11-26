-- v1 phase 1.3 (APPROVAL-ONLY: changes a security control, tightening only). Per-entity scoping of a membership.
-- Runs as the schema owner.
--
-- A membership keeps its one role. It may now ALSO be limited to named entities of its organisation (a Finance member
-- for ENT-SG-01 only). Unscoped (entity_scoped = false, every existing membership) = every entity, exactly as before.
-- Scoped with no entity rows = no entity (fail closed: removing the last entity never widens a membership to all).
-- Scopes are written only by the provisioning path (owner connection, scripts/control/admin.ts); the app reads them.
--
-- Enforcement here adds RESTRICTIVE policies (AND-ed with every existing permissive policy, none of which changes),
-- for the app role only, on every table that carries an entity or hangs off one:
--   predicate:  (SELECT app_entity_scope()) IS NULL  OR  <the row's entity> = ANY ((SELECT app_entity_scope())::text[])
--   (the cast makes the scalar subquery an array expression, as in 0037, so it stays one InitPlan)
-- app_entity_scope() is STABLE SECURITY DEFINER and uncorrelated, so it is ONE InitPlan per statement (the 0037
-- pattern): an unscoped member pays one parameter test per row, never a per-row function call or join. A scoped
-- member's rows are tested by array membership (entity columns) or by a primary-key lookup of the owning row
-- (order-, upload-, batch-, exception- and request-keyed tables), which itself is subject to the same policies.
-- Rows with a NULL entity are hidden from a scoped member (fx_rates: org-wide rates stay visible; notifications: only
-- when their subject is visible). The jobs login (clearline_jobs) and the owner are unaffected.

ALTER TABLE organization_memberships ADD COLUMN entity_scoped boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE membership_entity_scopes (
  org_id uuid NOT NULL,
  user_id text NOT NULL,
  entity_id text NOT NULL,
  granted_by text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT membership_entity_scopes_pk PRIMARY KEY (org_id, user_id, entity_id),
  CONSTRAINT membership_entity_scopes_membership_fk FOREIGN KEY (org_id, user_id) REFERENCES organization_memberships (org_id, user_id),
  CONSTRAINT membership_entity_scopes_entity_fk FOREIGN KEY (org_id, entity_id) REFERENCES merchant_entities (org_id, id),
  CONSTRAINT membership_entity_scopes_granted_by_fk FOREIGN KEY (granted_by) REFERENCES users (id)
);
--> statement-breakpoint
ALTER TABLE membership_entity_scopes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership_entity_scopes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A member reads their own scope (to build the session's context) and the organisation's (the access review).
CREATE POLICY scope_read ON membership_entity_scopes FOR SELECT
  USING (user_id = app_user_id() OR (org_id = app_org_id() AND app_is_member(org_id)));
--> statement-breakpoint
GRANT SELECT ON membership_entity_scopes TO clearline_app;
--> statement-breakpoint

-- NULL = unscoped (every entity) or no active membership in the context's organisation (then the permissive policies
-- already refuse the organisation's rows); otherwise the scoped entity ids ('{}' when none).
CREATE FUNCTION app_entity_scope() RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE WHEN m.entity_scoped THEN coalesce((SELECT array_agg(s.entity_id ORDER BY s.entity_id) FROM public.membership_entity_scopes s
                                                  WHERE s.org_id = m.org_id AND s.user_id = m.user_id), '{}'::text[]) END
  FROM public.organization_memberships m
  WHERE m.org_id = public.app_org_id() AND m.user_id = public.app_user_id() AND m.revoked_at IS NULL
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_entity_scope() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_entity_scope() TO clearline_app;
--> statement-breakpoint

-- An exception now records its entity (set by the run that opens it; an exception without a payment, e.g. an
-- unattributed transfer, has an entity too). Existing rows: the entity of their payment; an existing exception without
-- a payment keeps NULL (visible to unscoped members only).
ALTER TABLE recon_exceptions ADD COLUMN entity_id text;
--> statement-breakpoint
UPDATE recon_exceptions e SET entity_id = i.entity_id FROM invoices i WHERE i.org_id = e.org_id AND i.order_id = e.order_id;
--> statement-breakpoint
ALTER TABLE recon_exceptions ADD CONSTRAINT recon_exceptions_entity_fk FOREIGN KEY (org_id, entity_id) REFERENCES merchant_entities (org_id, id);
--> statement-breakpoint
-- the entity of an exception never changes once set
CREATE FUNCTION keep_exception_entity() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.entity_id IS NOT NULL AND NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
    RAISE EXCEPTION 'an exception''s entity never changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recon_exceptions_keep_entity BEFORE UPDATE ON recon_exceptions FOR EACH ROW EXECUTE FUNCTION keep_exception_entity();
--> statement-breakpoint

-- Tables with their own entity column.
DO $$
DECLARE spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    -- table, entity column, NULL entity visible to a scoped member?
    ['merchant_entities', 'id', 'no'], ['merchant_policy', 'entity_id', 'no'], ['invoices', 'entity_id', 'no'],
    ['bank_accounts', 'entity_id', 'no'], ['bank_lines', 'entity_id', 'no'], ['chain_transfers', 'entity_id', 'no'],
    ['chain_reads', 'entity_id', 'no'], ['settlement_batches', 'entity_id', 'no'], ['settlement_payment_lines', 'entity_id', 'no'],
    ['fx_rates', 'entity_id', 'yes'], ['merchant_journal_proposals', 'entity_id', 'no'], ['reconciliation_runs', 'entity_id', 'no'],
    ['reconciliation_schedules', 'entity_id', 'no'], ['jobs', 'entity_id', 'no'], ['rule_change_notices', 'entity_id', 'no'],
    ['uploads', 'entity_id', 'no'], ['ledger_invoices', 'entity_id', 'no'], ['recon_exceptions', 'entity_id', 'no']]
  LOOP
    EXECUTE format($p$CREATE POLICY entity_scope ON %I AS RESTRICTIVE FOR ALL TO clearline_app
      USING ((SELECT app_entity_scope()) IS NULL OR %s%I = ANY ((SELECT app_entity_scope())::text[]))
      WITH CHECK ((SELECT app_entity_scope()) IS NULL OR %s%I = ANY ((SELECT app_entity_scope())::text[]))$p$,
      spec[1], CASE WHEN spec[3] = 'yes' THEN format('%I IS NULL OR ', spec[2]) ELSE '' END, spec[2],
      CASE WHEN spec[3] = 'yes' THEN format('%I IS NULL OR ', spec[2]) ELSE '' END, spec[2]);
  END LOOP;
END $$;
--> statement-breakpoint

-- Tables keyed by a parent row: visible to a scoped member only when that parent is (the parent's own policies,
-- including its entity_scope policy, apply inside the EXISTS). Each lookup is the parent's primary key.
DO $$
DECLARE spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['match_records', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = match_records.org_id AND p.order_id = match_records.order_id)'],
    ['differences', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = differences.org_id AND p.order_id = differences.order_id)'],
    ['writeoff_proposals', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = writeoff_proposals.org_id AND p.order_id = writeoff_proposals.order_id)'],
    ['merchant_quotes', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = merchant_quotes.org_id AND p.order_id = merchant_quotes.order_id)'],
    ['payment_links', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = payment_links.org_id AND p.order_id = payment_links.order_id)'],
    ['match_reviews', 'EXISTS (SELECT 1 FROM invoices p WHERE p.org_id = match_reviews.org_id AND p.order_id = match_reviews.order_id)'],
    ['recon_exception_notes', 'EXISTS (SELECT 1 FROM recon_exceptions p WHERE p.org_id = recon_exception_notes.org_id AND p.id = recon_exception_notes.exception_id)'],
    ['settlement_batch_lines', 'EXISTS (SELECT 1 FROM settlement_batches p WHERE p.org_id = settlement_batch_lines.org_id AND p.batch_id = settlement_batch_lines.batch_id)'],
    ['provider_payment_records', '(EXISTS (SELECT 1 FROM merchant_quotes p WHERE p.org_id = provider_payment_records.org_id AND p.quote_id = provider_payment_records.quote_id)
       OR EXISTS (SELECT 1 FROM payment_links p WHERE p.org_id = provider_payment_records.org_id AND p.link_id = provider_payment_records.link_id))'],
    ['upload_rows', 'EXISTS (SELECT 1 FROM uploads p WHERE p.org_id = upload_rows.org_id AND p.id = upload_rows.upload_id)'],
    ['upload_row_targets', 'EXISTS (SELECT 1 FROM uploads p WHERE p.org_id = upload_row_targets.org_id AND p.id = upload_row_targets.upload_id)'],
    ['rule_change_acks', 'EXISTS (SELECT 1 FROM rule_change_notices p WHERE p.org_id = rule_change_acks.org_id AND p.id = rule_change_acks.notice_id)'],
    -- merchant approval requests follow their subject; other kinds (rc5 Control) are organisation-level, unchanged
    ['approval_requests', '(approval_requests.subject_kind NOT IN (''merchant_writeoff'', ''merchant_resolution'')
       OR (approval_requests.subject_kind = ''merchant_writeoff'' AND EXISTS (SELECT 1 FROM writeoff_proposals p WHERE p.org_id = approval_requests.org_id AND p.id = approval_requests.subject_id))
       OR (approval_requests.subject_kind = ''merchant_resolution'' AND EXISTS (SELECT 1 FROM recon_exceptions p WHERE p.org_id = approval_requests.org_id AND p.id = approval_requests.subject_id)))'],
    -- a decision may be read or recorded only on a request the member can see: an Approver scoped to one entity
    -- cannot decide another entity's request, even though the decision trigger itself is SECURITY DEFINER
    ['approval_decisions', 'EXISTS (SELECT 1 FROM approval_requests p WHERE p.org_id = approval_decisions.org_id AND p.id = approval_decisions.request_id)'],
    -- an organisation-level notification (no entity) is shown only when its subject is visible
    ['notifications', 'CASE WHEN notifications.entity_id IS NOT NULL THEN notifications.entity_id = ANY ((SELECT app_entity_scope())::text[])
       WHEN notifications.subject_type = ''exception'' THEN EXISTS (SELECT 1 FROM recon_exceptions p WHERE p.org_id = notifications.org_id AND p.id = notifications.subject_id)
       WHEN notifications.subject_type = ''approval'' AND notifications.subject_id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''
         THEN EXISTS (SELECT 1 FROM approval_requests p WHERE p.org_id = notifications.org_id AND p.id = notifications.subject_id::uuid)
       ELSE false END']]
  LOOP
    EXECUTE format($p$CREATE POLICY entity_scope ON %I AS RESTRICTIVE FOR ALL TO clearline_app
      USING ((SELECT app_entity_scope()) IS NULL OR %s) WITH CHECK ((SELECT app_entity_scope()) IS NULL OR %s)$p$, spec[1], spec[2], spec[2]);
  END LOOP;
END $$;
