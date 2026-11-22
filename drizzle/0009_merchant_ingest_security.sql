-- rc6 phase 6: security for ingestion and persistence. Runs as the schema owner.

-- Address facts are merchant rows like any other: forced RLS, provider read only under a full grant, append-only.
ALTER TABLE address_facts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE address_facts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON address_facts USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON address_facts FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON address_facts TO clearline_app;
--> statement-breakpoint

-- Matching policy can make auto-matching more permissive (tolerance, write-off threshold, imported bank lines as
-- verified), so through the app only an active Admin of the merchant may create or change it, one revision at a time
-- (a stale edit is refused). The owner connection (migrations, the admin CLI, the fictional seed) is not the app.
CREATE FUNCTION check_policy_change() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF pg_has_role(current_user, 'clearline_app', 'MEMBER') AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = public.app_user_id()
       AND m.role = 'admin' AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'merchant policy is created or changed only by an Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.org_id <> OLD.org_id OR NEW.entity_id <> OLD.entity_id THEN
      RAISE EXCEPTION 'a merchant policy belongs to its entity' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'a merchant policy changes one revision at a time (expected %)', OLD.revision + 1 USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.revision <> 1 THEN
    RAISE EXCEPTION 'a merchant policy starts at revision 1' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchant_policy_change BEFORE INSERT OR UPDATE ON merchant_policy FOR EACH ROW EXECUTE FUNCTION check_policy_change();
--> statement-breakpoint

-- A write-off is approved only by an approved two-person request FOR THAT write-off (subject_id). A decided or
-- superseded write-off (the engine no longer proposes it after a rerun) never changes again.
CREATE OR REPLACE FUNCTION check_writeoff_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.difference_ids::text <> OLD.difference_ids::text OR NEW.order_id <> OLD.order_id
     OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'a write-off proposal''s amount and differences are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('approved', 'rejected', 'superseded') THEN
    RAISE EXCEPTION 'a decided write-off (%) never changes', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'awaiting_approval' AND NOT EXISTS (
       SELECT 1 FROM public.approval_requests r WHERE r.org_id = NEW.org_id AND r.id = NEW.approval_request_id
       AND r.subject_kind = 'merchant_writeoff' AND r.subject_id = NEW.id AND r.status = 'pending') THEN
    RAISE EXCEPTION 'a write-off awaits approval only with a pending request for it' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('approved', 'rejected') AND NOT EXISTS (
       SELECT 1 FROM public.approval_requests r WHERE r.org_id = NEW.org_id AND r.id = NEW.approval_request_id
       AND r.subject_kind = 'merchant_writeoff' AND r.subject_id = NEW.id AND r.status = NEW.status) THEN
    RAISE EXCEPTION 'a write-off is % only by a % two-person request for it', NEW.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Chain facts: the new columns (entity, claimed symbol, earlier hops) are facts too and never change.
CREATE OR REPLACE FUNCTION keep_chain_fact() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amount_base_units <> OLD.amount_base_units OR NEW.from_address <> OLD.from_address OR NEW.to_address <> OLD.to_address
     OR NEW.token_contract <> OLD.token_contract OR NEW.decimals <> OLD.decimals OR NEW.source <> OLD.source OR NEW.block_time <> OLD.block_time
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.claimed_symbol IS DISTINCT FROM OLD.claimed_symbol
     OR NEW.prior_hops::text IS DISTINCT FROM OLD.prior_hops::text THEN
    RAISE EXCEPTION 'a chain transfer''s facts are immutable (only confirmations and finality change)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
