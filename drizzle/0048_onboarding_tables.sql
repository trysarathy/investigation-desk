-- v1 phase 1.1 (onboarding): platform operators, invitations to an organisation and the setup wizard's progress.
-- Runs as the schema owner. These tables are written and read ONLY through the SECURITY DEFINER functions of
-- migration 0049 (EXECUTE granted to the narrow `clearline_provisioning` role) and by the owner's admin CLI. Nobody
-- else holds a privilege on them: row-level security is on and forced with NO policy, so even a future accidental
-- grant reads nothing. The runtime role's grants are unchanged (tests/control/provisioning.test.ts).

-- A platform operator may open the platform console (create an organisation, invite its first admin). Granted and
-- revoked only with the admin CLI (`grant-platform-operator`), and the console also needs CLEARLINE_PLATFORM_CONSOLE=1.
CREATE TABLE platform_operators (
  user_id text PRIMARY KEY REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
--> statement-breakpoint
ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_operators FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An invitation to join one organisation with one role. Only the SHA-256 of the one-time token is stored; the token
-- itself is only in the invitation email. Invite-only: this is the sole way a new person gets an account besides the
-- operator's CLI (there is no public sign-up).
CREATE TABLE org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  email text NOT NULL,
  role text NOT NULL REFERENCES roles(code),
  token_sha256 text NOT NULL UNIQUE,
  invited_by text REFERENCES users(id),
  invited_via text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  accepted_user_id text REFERENCES users(id),
  CONSTRAINT org_invitations_email_chk CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254 AND email = lower(email)),
  CONSTRAINT org_invitations_token_chk CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT org_invitations_via_chk CHECK (invited_via IN ('platform', 'merchant_admin', 'cli')),
  CONSTRAINT org_invitations_status_chk CHECK (status IN ('pending', 'accepted', 'revoked')),
  CONSTRAINT org_invitations_closed_chk CHECK ((status = 'pending') = (closed_at IS NULL) AND (status = 'accepted') = (accepted_user_id IS NOT NULL)),
  CONSTRAINT org_invitations_expiry_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '14 days')
);
--> statement-breakpoint
CREATE UNIQUE INDEX org_invitations_pending_uq ON org_invitations (org_id, email) WHERE status = 'pending';
--> statement-breakpoint
ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An invitation's organisation, person, role and token never change; a closed one (accepted or revoked) never reopens.
CREATE FUNCTION keep_org_invitation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.email <> OLD.email OR NEW.role <> OLD.role OR NEW.token_sha256 <> OLD.token_sha256
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by OR NEW.invited_via <> OLD.invited_via OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'an invitation''s organisation, person, role, token and expiry never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a closed invitation (%) never changes', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- (A trigger function needs no EXECUTE privilege to fire; revoking PUBLIC's keeps the runtime role's grants unchanged.)
REVOKE ALL ON FUNCTION keep_org_invitation() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER org_invitations_keep BEFORE UPDATE ON org_invitations FOR EACH ROW EXECUTE FUNCTION keep_org_invitation();
--> statement-breakpoint
CREATE TRIGGER org_invitations_no_delete BEFORE DELETE ON org_invitations FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- The setup wizard: which steps a merchant's Admin has marked done (append-only), and when setup was finished.
CREATE TABLE org_setup_steps (
  org_id uuid NOT NULL REFERENCES organizations(id),
  step text NOT NULL,
  done_by text NOT NULL REFERENCES users(id),
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, step),
  CONSTRAINT org_setup_steps_step_chk CHECK (step IN ('entities', 'ledger', 'bank_accounts', 'tolerance', 'provider', 'mapping_templates', 'members', 'finish'))
);
--> statement-breakpoint
ALTER TABLE org_setup_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_setup_steps FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER org_setup_steps_append_only BEFORE UPDATE OR DELETE ON org_setup_steps FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
REVOKE ALL ON platform_operators, org_invitations, org_setup_steps FROM PUBLIC;
