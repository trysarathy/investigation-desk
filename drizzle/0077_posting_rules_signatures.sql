-- v1 phase 4 (APPROVAL-ONLY: a new control; it relaxes nothing). The merchant Admin's signature of one version of the
-- posting rules (src/lib/clearline/merchant/posting-rules.ts). Runs as the schema owner.
--
-- CONTRACT with the ledger integration: postingRulesSigned(orgId) reads this table. A row of the organisation with
-- revoked_at NULL counts as signed (the newest signed_at wins); a missing table, column or grant, or any error, means
-- NOT signed. Signing approves no journal and posts nothing; journal proposals stay "pending_sign_off" (0007 keeps
-- refusing any other value).
--
-- Append-only: a signature is never edited or deleted. The only change ever accepted is a revocation, once (revoked_at,
-- revoked_by_user_id, revoked_reason from NULL to set). The catalogue that was signed is stored with the row, so the
-- version a person signed stays readable exactly as it was shown (locked).
CREATE TABLE posting_rules_signatures (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations (id),
  version text NOT NULL,
  version_sha256 text NOT NULL,
  catalogue jsonb NOT NULL,
  signed_by_user_id text NOT NULL REFERENCES users (id),
  signed_by_name text NOT NULL,
  signed_at timestamp with time zone DEFAULT now() NOT NULL,
  mfa_verified_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  revoked_by_user_id text REFERENCES users (id),
  revoked_reason text,
  CONSTRAINT posting_rules_signatures_version_chk CHECK (version ~ '^PR-[0-9a-f]{12}$' AND version_sha256 ~ '^[0-9a-f]{64}$' AND left(version_sha256, 12) = substr(version, 4)),
  CONSTRAINT posting_rules_signatures_name_chk CHECK (length(signed_by_name) BETWEEN 1 AND 200),
  CONSTRAINT posting_rules_signatures_revoked_chk CHECK ((revoked_at IS NULL AND revoked_by_user_id IS NULL AND revoked_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND length(revoked_reason) BETWEEN 1 AND 500)),
  CONSTRAINT posting_rules_signatures_mfa_chk CHECK (mfa_verified_at <= signed_at AND signed_at - mfa_verified_at <= interval '10 minutes')
);
--> statement-breakpoint
-- one standing signature per organisation and version
CREATE UNIQUE INDEX posting_rules_signatures_active_uq ON posting_rules_signatures (org_id, version) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX posting_rules_signatures_org_idx ON posting_rules_signatures (org_id, signed_at DESC);
--> statement-breakpoint

-- signed_at is the database's time (never back-dated by a client); a new row is never born revoked
CREATE FUNCTION posting_rules_signature_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.signed_at := now();
  IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by_user_id IS NOT NULL OR NEW.revoked_reason IS NOT NULL THEN
    RAISE EXCEPTION 'a posting-rules signature is not created revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER posting_rules_signatures_insert BEFORE INSERT ON posting_rules_signatures FOR EACH ROW EXECUTE FUNCTION posting_rules_signature_insert();
--> statement-breakpoint
CREATE FUNCTION posting_rules_signature_locked() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'posting-rules signatures are append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     OR (NEW.id, NEW.org_id, NEW.version, NEW.version_sha256, NEW.catalogue, NEW.signed_by_user_id, NEW.signed_by_name, NEW.signed_at, NEW.mfa_verified_at)
        IS DISTINCT FROM (OLD.id, OLD.org_id, OLD.version, OLD.version_sha256, OLD.catalogue, OLD.signed_by_user_id, OLD.signed_by_name, OLD.signed_at, OLD.mfa_verified_at) THEN
    RAISE EXCEPTION 'a signed posting-rules version is locked; only a revocation, once, is recorded' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.revoked_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER posting_rules_signatures_locked BEFORE UPDATE OR DELETE ON posting_rules_signatures FOR EACH ROW EXECUTE FUNCTION posting_rules_signature_locked();
--> statement-breakpoint

-- An Admin of the organisation with access to every entity (signing is organisation-wide).
CREATE FUNCTION app_is_unscoped_admin(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = org AND m.user_id = public.app_user_id()
                 AND m.role = 'admin' AND m.revoked_at IS NULL AND NOT m.entity_scoped)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_is_unscoped_admin(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_unscoped_admin(uuid) TO clearline_app;
--> statement-breakpoint

ALTER TABLE posting_rules_signatures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE posting_rules_signatures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Read: inside the organisation's context, by a member (or by server code that set only the organisation, e.g. a job
-- that asks whether the rules are signed before it may send anything to a ledger).
CREATE POLICY signature_read ON posting_rules_signatures FOR SELECT
  USING (org_id = app_org_id() AND (app_user_id() IS NULL OR app_is_member(org_id)));
--> statement-breakpoint
CREATE POLICY signature_sign ON posting_rules_signatures FOR INSERT
  WITH CHECK (org_id = app_org_id() AND signed_by_user_id = app_user_id() AND app_is_unscoped_admin(org_id));
--> statement-breakpoint
CREATE POLICY signature_revoke ON posting_rules_signatures FOR UPDATE
  USING (org_id = app_org_id() AND app_is_unscoped_admin(org_id))
  WITH CHECK (org_id = app_org_id() AND revoked_by_user_id = app_user_id() AND app_is_unscoped_admin(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON posting_rules_signatures TO clearline_app;
--> statement-breakpoint
GRANT UPDATE (revoked_at, revoked_by_user_id, revoked_reason) ON posting_rules_signatures TO clearline_app;
