-- v1 phase 3: period close. Runs as the schema owner. Nothing existing is relaxed; this only refuses more.
--  * A month of an entity is closed in two steps (maker-checker): Finance or an Admin asks for the sign-off, then a
--    DIFFERENT person, an Admin of the organisation, locks it (or rejects the request). The database refuses a lock by
--    the requester, by a non-Admin, an unlock, a change to a lock, and any delete.
--  * In a locked month (a payment's month is its invoice's issue date in the entity's own time; a journal proposal's
--    is its entry date) nothing a run or a person writes may change: decisions, differences, exceptions, write-offs
--    and journal proposals refuse INSERT and UPDATE. Deletes are left to retention (owner only; the runtime login
--    cannot delete these rows).
--  * A run that would decide a locked month's payment differently writes a correction instead, in the next open month,
--    naming what it corrects (period_corrections).

CREATE TABLE period_locks (
  org_id uuid NOT NULL REFERENCES organizations(id),
  entity_id text NOT NULL,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  requested_by text NOT NULL REFERENCES users(id),
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  reason text NOT NULL,
  decided_by text REFERENCES users(id),
  decided_at timestamp with time zone,
  decision_reason text,
  PRIMARY KEY (org_id, entity_id, period),
  FOREIGN KEY (org_id, entity_id) REFERENCES merchant_entities(org_id, id),
  CONSTRAINT period_locks_period_chk CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT period_locks_status_chk CHECK (status IN ('requested', 'locked', 'rejected')),
  CONSTRAINT period_locks_reason_chk CHECK (length(reason) BETWEEN 3 AND 500 AND (decision_reason IS NULL OR length(decision_reason) BETWEEN 3 AND 500)),
  CONSTRAINT period_locks_decided_chk CHECK ((status = 'requested') = (decided_by IS NULL) AND (decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT period_locks_two_people_chk CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
--> statement-breakpoint
CREATE FUNCTION period_lock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'period_locks: a sign-off is never deleted' USING ERRCODE = 'P0001'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' THEN RAISE EXCEPTION 'period_locks: a period is first requested, then locked by another person' USING ERRCODE = 'P0001'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'locked' THEN RAISE EXCEPTION 'period_locks: a locked period cannot change' USING ERRCODE = 'P0001'; END IF;
  IF NEW.org_id <> OLD.org_id OR NEW.entity_id <> OLD.entity_id OR NEW.period <> OLD.period THEN RAISE EXCEPTION 'period_locks: the period cannot change' USING ERRCODE = 'P0001'; END IF;
  IF OLD.status = 'requested' AND NEW.status IN ('locked', 'rejected') THEN
    IF NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at OR NEW.reason <> OLD.reason THEN RAISE EXCEPTION 'period_locks: the request cannot change' USING ERRCODE = 'P0001'; END IF;
    IF NEW.decided_by = OLD.requested_by THEN RAISE EXCEPTION 'period_locks: the preparer never approves' USING ERRCODE = 'P0001'; END IF;
    IF NEW.status = 'locked' AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.decided_by AND m.role = 'admin' AND m.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'period_locks: only an Admin of the organisation locks a period' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'rejected' AND NEW.status = 'requested' AND NEW.decided_by IS NULL THEN RETURN NEW; END IF; -- asked again
  RAISE EXCEPTION 'period_locks: % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION period_lock_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER period_locks_guard BEFORE INSERT OR UPDATE OR DELETE ON period_locks FOR EACH ROW EXECUTE FUNCTION period_lock_guard();
--> statement-breakpoint
ALTER TABLE period_locks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE period_locks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON period_locks TO clearline_app USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND (decided_by IS NULL OR decided_by = app_user_id()) AND (status <> 'requested' OR requested_by = app_user_id()));
--> statement-breakpoint
CREATE POLICY entity_scope ON period_locks AS RESTRICTIVE FOR ALL TO clearline_app
  USING ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]))
  WITH CHECK ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT ON period_locks TO clearline_app;
--> statement-breakpoint
GRANT UPDATE (status, requested_by, requested_at, reason, decided_by, decided_at, decision_reason) ON period_locks TO clearline_app;
--> statement-breakpoint

-- Is this entity's month locked? (One index lookup; used by the guards below and by runs.)
CREATE FUNCTION period_is_locked(org uuid, entity text, at_month text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.period_locks p WHERE p.org_id = org AND p.entity_id = entity AND p.period = at_month AND p.status = 'locked')
$$;
--> statement-breakpoint
-- A payment's month: its invoice's issue time in the entity's own (fixed) offset.
CREATE FUNCTION payment_period(org uuid, order_id text) RETURNS TABLE (entity_id text, period text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT i.entity_id, to_char((i.issued_at AT TIME ZONE 'UTC') + make_interval(mins => e.utc_offset_minutes), 'YYYY-MM')
  FROM public.invoices i JOIN public.merchant_entities e ON e.org_id = i.org_id AND e.id = i.entity_id
  WHERE i.org_id = org AND i.order_id = payment_period.order_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION period_is_locked(uuid, text, text), payment_period(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION period_is_locked(uuid, text, text), payment_period(uuid, text) TO clearline_app;
--> statement-breakpoint

-- The guards. Statement-level with transition tables (one join per statement, however many rows a run writes); a
-- statement touching nothing in a locked month costs one lookup of period_locks.
CREATE FUNCTION refuse_locked_payments() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE hit text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.period_locks WHERE status = 'locked') THEN RETURN NULL; END IF;
  SELECT n.order_id INTO hit FROM changed n
    JOIN public.invoices i ON i.org_id = n.org_id AND i.order_id = n.order_id
    JOIN public.merchant_entities e ON e.org_id = i.org_id AND e.id = i.entity_id
    JOIN public.period_locks p ON p.org_id = i.org_id AND p.entity_id = i.entity_id AND p.status = 'locked'
      AND p.period = to_char((i.issued_at AT TIME ZONE 'UTC') + make_interval(mins => e.utc_offset_minutes), 'YYYY-MM')
    LIMIT 1;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: % of payment % is in a locked period', TG_TABLE_NAME, hit USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION refuse_locked_payments() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['match_records', 'differences', 'writeoff_proposals', 'recon_exceptions'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION refuse_locked_payments()', tbl || '_period_ins', tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION refuse_locked_payments()', tbl || '_period_upd', tbl);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION refuse_locked_journals() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE hit text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.period_locks WHERE status = 'locked') THEN RETURN NULL; END IF;
  SELECT n.id INTO hit FROM changed n
    JOIN public.period_locks p ON p.org_id = n.org_id AND p.entity_id = n.entity_id AND p.status = 'locked'
      AND p.period = substr(n.evidence_refs ->> 'entryDate', 1, 7)
    LIMIT 1;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: journal proposal % is in a locked period', hit USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION refuse_locked_journals() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER merchant_journal_proposals_period_ins AFTER INSERT ON merchant_journal_proposals REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION refuse_locked_journals();
--> statement-breakpoint
CREATE TRIGGER merchant_journal_proposals_period_upd AFTER UPDATE ON merchant_journal_proposals REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION refuse_locked_journals();
--> statement-breakpoint

-- Corrections: what a run would now decide for a locked month's payment, filed in the next open month.
CREATE TABLE period_corrections (
  org_id uuid NOT NULL REFERENCES organizations(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id text NOT NULL,
  order_id text NOT NULL,
  corrects_period text NOT NULL,
  correction_period text NOT NULL,
  run_id uuid NOT NULL,
  stored_decision text,
  stored_rule_id text,
  new_decision text NOT NULL,
  new_rule_id text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, order_id) REFERENCES invoices(org_id, order_id),
  FOREIGN KEY (org_id, entity_id) REFERENCES merchant_entities(org_id, id),
  CONSTRAINT period_corrections_period_chk CHECK (corrects_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND correction_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND correction_period > corrects_period)
);
--> statement-breakpoint
CREATE UNIQUE INDEX period_corrections_once ON period_corrections (org_id, order_id, fingerprint);
--> statement-breakpoint
CREATE FUNCTION period_correction_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'period_corrections is append-only' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.period_is_locked(NEW.org_id, NEW.entity_id, NEW.corrects_period) THEN RAISE EXCEPTION 'PERIOD_NOT_LOCKED: a correction names a locked period' USING ERRCODE = 'P0001'; END IF;
  IF public.period_is_locked(NEW.org_id, NEW.entity_id, NEW.correction_period) THEN RAISE EXCEPTION 'PERIOD_LOCKED: a correction goes to an open period' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION period_correction_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER period_corrections_guard BEFORE INSERT OR UPDATE OR DELETE ON period_corrections FOR EACH ROW EXECUTE FUNCTION period_correction_guard();
--> statement-breakpoint
ALTER TABLE period_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE period_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON period_corrections TO clearline_app USING (org_id = app_org_id() AND app_is_member(org_id)) WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY entity_scope ON period_corrections AS RESTRICTIVE FOR ALL TO clearline_app
  USING ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]))
  WITH CHECK ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]));
--> statement-breakpoint
GRANT SELECT, INSERT ON period_corrections TO clearline_app;
