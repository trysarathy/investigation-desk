-- rc7 phase 3b: in-app notifications. Runs as the schema owner. No existing control is relaxed: new tables, written
-- only by SECURITY DEFINER triggers on events that already happen (the runtime role cannot insert a notification),
-- read only by members of the organisation whose CURRENT role is the notification's audience (or the one member it
-- names). Titles carry ids and counts only, never file contents.

-- The current role of the signed-in user in an organisation (NULL when not an active member).
CREATE FUNCTION app_member_role(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.role FROM public.organization_memberships m WHERE m.org_id = org AND m.user_id = public.app_user_id() AND m.revoked_at IS NULL
$$;
--> statement-breakpoint
CREATE TABLE "notifications" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"audience_role" text NOT NULL,
	"audience_user_id" text,
	"entity_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "notifications_kind_chk" CHECK ("notifications"."kind" in ('run_finished','run_failed','exception_assigned','approval_waiting','bank_statement_waiting','rule_change')),
	CONSTRAINT "notifications_role_chk" CHECK ("notifications"."audience_role" in ('admin','payment_ops','finance','approver','viewer')),
	CONSTRAINT "notifications_title_chk" CHECK (length("notifications"."title") between 3 and 300)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_audience_user_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_idx" ON "notifications" USING btree ("org_id","audience_role",coalesce("audience_user_id", ''),"dedupe_key");
--> statement-breakpoint
CREATE INDEX "notifications_list_idx" ON "notifications" USING btree ("org_id","audience_role","created_at");
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"org_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_pk" PRIMARY KEY("org_id","notification_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_fk" FOREIGN KEY ("org_id","notification_id") REFERENCES "public"."notifications"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- An Approver (not the member who started the run that raised it) acknowledges a rule-change notice. Append-only.
CREATE TABLE "rule_change_acks" (
	"org_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"acked_by" text NOT NULL,
	"note" text,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_change_acks_pk" PRIMARY KEY("org_id","notice_id"),
	CONSTRAINT "rule_change_acks_note_chk" CHECK ("rule_change_acks"."note" is null or length("rule_change_acks"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "rule_change_acks" ADD CONSTRAINT "rule_change_acks_notice_fk" FOREIGN KEY ("org_id","notice_id") REFERENCES "public"."rule_change_notices"("org_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rule_change_acks" ADD CONSTRAINT "rule_change_acks_user_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audience_read ON notifications FOR SELECT USING (org_id = app_org_id() AND app_is_member(org_id)
  AND (audience_user_id = app_user_id() OR (audience_user_id IS NULL AND audience_role = app_member_role(org_id))));
--> statement-breakpoint
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_reads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_reads ON notification_reads USING (org_id = app_org_id() AND app_is_member(org_id) AND user_id = app_user_id())
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND user_id = app_user_id()
    AND EXISTS (SELECT 1 FROM notifications n WHERE n.org_id = notification_reads.org_id AND n.id = notification_reads.notification_id));
--> statement-breakpoint
ALTER TABLE rule_change_acks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rule_change_acks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON rule_change_acks USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND acked_by = app_user_id());
--> statement-breakpoint
CREATE FUNCTION check_rule_change_ack() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE preparer text;
BEGIN
  SELECT r.started_by INTO preparer FROM public.rule_change_notices n JOIN public.reconciliation_runs r ON r.org_id = n.org_id AND r.id = n.run_id
  WHERE n.org_id = NEW.org_id AND n.id = NEW.notice_id;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.acked_by AND m.role = 'approver' AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'a rule-change notice is acknowledged by an active Approver' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF preparer IS NULL OR preparer = NEW.acked_by THEN
    RAISE EXCEPTION 'maker-checker: the member who prepared the run cannot acknowledge its rule-change notice' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rule_change_acks_check BEFORE INSERT ON rule_change_acks FOR EACH ROW EXECUTE FUNCTION check_rule_change_ack();
--> statement-breakpoint
CREATE TRIGGER rule_change_acks_append_only BEFORE UPDATE OR DELETE ON rule_change_acks FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER notifications_append_only BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
GRANT SELECT ON notifications TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON notification_reads TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON rule_change_acks TO clearline_app;
--> statement-breakpoint

-- Raising notifications: one helper, called only by the triggers below.
CREATE FUNCTION raise_notification(org uuid, kind text, roles text[], who text, entity text, subject_type text, subject_id text, title text, dedupe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY roles LOOP
    INSERT INTO public.notifications (org_id, kind, audience_role, audience_user_id, entity_id, subject_type, subject_id, title, dedupe_key)
    VALUES (org, kind, r, who, entity, subject_type, subject_id, left(title, 300), dedupe) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION raise_notification(uuid, text, text[], text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION notify_run() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status = 'failed' THEN
    PERFORM public.raise_notification(NEW.org_id, 'run_failed', ARRAY['payment_ops', 'finance'], NULL, NEW.entity_id, 'run', NEW.id::text,
      format('Reconciliation of %s failed (%s)', NEW.entity_id, NEW.error_code), 'run:' || NEW.id::text);
  ELSIF NEW.status = 'changed' THEN
    PERFORM public.raise_notification(NEW.org_id, 'run_finished', ARRAY['payment_ops', 'finance'], NULL, NEW.entity_id, 'run', NEW.id::text,
      format('Reconciliation of %s finished: %s matched, %s with a difference, %s to review, %s exception(s)', NEW.entity_id, NEW.matched, NEW.with_difference, NEW.review, NEW.exceptions),
      'run:' || NEW.id::text);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_runs_notify AFTER INSERT ON reconciliation_runs FOR EACH ROW EXECUTE FUNCTION notify_run();
--> statement-breakpoint
-- [ASSUMPTION] the engine's owners map to roles: Payment Operations → payment_ops; Treasury and Finance Controller → finance.
CREATE FUNCTION notify_exception() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE role_of text := CASE NEW.owner_role WHEN 'Payment Operations' THEN 'payment_ops' ELSE 'finance' END;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'resolved' THEN
    PERFORM public.raise_notification(NEW.org_id, 'exception_assigned', ARRAY[role_of], NULL, NULL, 'exception', NEW.id,
      format('New exception %s for %s, owned by %s', NEW.id, coalesce(NEW.order_id, 'no order'), NEW.owner_role), 'exception:' || NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.owner_user_id IS NOT NULL AND NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    PERFORM public.raise_notification(NEW.org_id, 'exception_assigned', ARRAY[coalesce((SELECT m.role FROM public.organization_memberships m
      WHERE m.org_id = NEW.org_id AND m.user_id = NEW.owner_user_id AND m.revoked_at IS NULL), role_of)], NEW.owner_user_id, NULL, 'exception', NEW.id,
      format('Exception %s was assigned to you', NEW.id), 'exception:' || NEW.id || ':' || NEW.owner_user_id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recon_exceptions_notify AFTER INSERT OR UPDATE ON recon_exceptions FOR EACH ROW EXECUTE FUNCTION notify_exception();
--> statement-breakpoint
CREATE FUNCTION notify_approval() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.status = 'pending' AND NEW.subject_kind IN ('merchant_writeoff', 'merchant_resolution') THEN
    PERFORM public.raise_notification(NEW.org_id, 'approval_waiting', ARRAY['approver'], NULL, NULL, 'approval', NEW.id::text,
      format('%s %s (version %s) is waiting for an Approver', CASE NEW.subject_kind WHEN 'merchant_writeoff' THEN 'Write-off' ELSE 'Resolution' END, NEW.subject_id, NEW.version),
      'approval:' || NEW.id::text);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_requests_notify AFTER INSERT ON approval_requests FOR EACH ROW EXECUTE FUNCTION notify_approval();
--> statement-breakpoint
CREATE FUNCTION notify_bank_statement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.file_type = 'bank_statement' AND NEW.status = 'validated' AND OLD.status IS DISTINCT FROM 'validated' THEN
    PERFORM public.raise_notification(NEW.org_id, 'bank_statement_waiting', ARRAY['approver'], NULL, NEW.entity_id, 'upload', NEW.id::text,
      format('Bank statement upload %s for %s (%s rows) awaits confirmation by a second person', NEW.id, NEW.entity_id, NEW.row_count),
      'bank:' || NEW.id::text || ':' || coalesce(NEW.rows_sha256, ''));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER uploads_notify_bank AFTER UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION notify_bank_statement();
--> statement-breakpoint
CREATE FUNCTION notify_rule_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.raise_notification(NEW.org_id, 'rule_change', ARRAY['finance', 'approver'], NULL, NEW.entity_id, 'rule_change_notice', NEW.id::text,
    format('Rules changed: %s would now be %s (%s); it stays %s as a person closed it', NEW.order_id, NEW.new_decision, NEW.new_rule_id, NEW.stored_decision),
    'rule:' || NEW.id::text);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rule_change_notices_notify AFTER INSERT ON rule_change_notices FOR EACH ROW EXECUTE FUNCTION notify_rule_change();
