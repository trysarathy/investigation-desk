-- v1 wave 1 integration: ONE EmailSender (src/server/email). The local stand-in is the email_outbox table of 0051 (the
-- web app may insert, never read). An invitation and its email must be one transaction: the platform console and the
-- setup wizard write through the provisioning role, which holds no table privilege, so the invitation email is queued
-- by prov_queue_invitation_email() INSIDE the provisioning transaction that created the invitation. Runs as the schema
-- owner. Nothing here sends e-mail or calls a service.
--
-- prov_queue_invitation_email(to, subject, text) queues one message ONLY for an address that has a pending invitation
-- created in this same transaction (created_at = now(), the transaction's start), by this acting user: it cannot be used
-- to send arbitrary mail, and a rolled-back invitation takes its email with it.

ALTER TABLE email_outbox ADD COLUMN kind text;
--> statement-breakpoint
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_kind_chk CHECK (kind IS NULL OR kind ~ '^[a-z_]{1,40}$');
--> statement-breakpoint

CREATE FUNCTION prov_queue_invitation_email(p_to text, p_subject text, p_text text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE u text := public.app_user_id(); e text := lower(btrim(coalesce(p_to, '')));
BEGIN
  IF u IS NULL THEN PERFORM public.prov_refuse('no signed-in user in this transaction'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_invitations i WHERE i.email = e AND i.status = 'pending' AND i.invited_by = u AND i.created_at = now()) THEN
    PERFORM public.prov_refuse('an invitation email goes only with an invitation created in the same transaction');
  END IF;
  IF p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 300 OR p_subject ~ '[\r\n]' THEN PERFORM public.prov_invalid('a subject is one line of 1-300 characters'); END IF;
  IF p_text IS NULL OR length(p_text) > 20000 THEN PERFORM public.prov_invalid('the message is too long'); END IF;
  INSERT INTO public.email_outbox (to_address, subject, text_body, kind) VALUES (e, p_subject, p_text, 'invitation');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION prov_queue_invitation_email(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION prov_queue_invitation_email(text, text, text) TO clearline_provisioning;
