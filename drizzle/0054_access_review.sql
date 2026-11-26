-- v1 phase 1.4: what the access review shows (who has access to what, since when, invited by whom, last sign-in).
-- Runs as the schema owner. No existing control is relaxed: two nullable columns and a stamp written by a trigger.

-- Who invited the member: set when a provider's invitation is accepted (the invitation's inviter) or by the
-- provisioning path when it names one. NULL = granted by an operator with the admin command.
ALTER TABLE organization_memberships ADD COLUMN invited_by text;
--> statement-breakpoint
ALTER TABLE organization_memberships ADD CONSTRAINT organization_memberships_invited_by_fk FOREIGN KEY (invited_by) REFERENCES users (id);
--> statement-breakpoint

-- Last sign-in: stamped from the session row Better Auth creates at sign-in (sessions are deleted on sign-out,
-- revocation and expiry, so they cannot answer this later). NULL = never signed in since this migration.
ALTER TABLE users ADD COLUMN last_sign_in_at timestamp with time zone;
--> statement-breakpoint
CREATE FUNCTION stamp_last_sign_in() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.users SET last_sign_in_at = NEW.created_at WHERE id = NEW.user_id AND (last_sign_in_at IS NULL OR last_sign_in_at < NEW.created_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION stamp_last_sign_in() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER sessions_stamp_sign_in AFTER INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION stamp_last_sign_in();
