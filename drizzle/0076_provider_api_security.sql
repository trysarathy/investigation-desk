-- v1 phase 2.2: security for the provider API adapter. Runs as the schema owner.
--
-- * The three tables are merchant rows like any other: forced RLS, the merchant's own members only, plus the
--   entity scope of 0053 (a member scoped to some entities sees only their connections, pulls and events).
-- * A connection is created by the signed-in merchant Admin, for the merchant's OWN provider; its configuration and
--   secret references never change afterwards (a change is a new connection); it can only be disabled, once.
-- * A pull is started by the signed-in Finance or Payment Operations member, moves running → succeeded / unchanged /
--   failed once, and its facts (connection, template version, cursor it started from) never change.
-- * Webhook events are written ONLY by provider_webhook_record (SECURITY DEFINER), after the web app verified the
--   delivery's signature: the runtime role cannot insert one directly. The runtime role may only attach a pending
--   event to a pull of the same connection, once.
-- * Unauthenticated webhook deliveries reach the database only through three narrow SECURITY DEFINER functions: the
--   target lookup (an active connection's organisation and secret REFERENCE, never a secret), the record of a
--   verified event, and the audit of a refusal (a fixed reason code, ids only).

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['provider_api_connections','provider_pulls','provider_webhook_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (org_id = app_org_id() AND app_is_member(org_id)) WITH CHECK (org_id = app_org_id() AND app_is_member(org_id))', tbl);
    EXECUTE format($p$CREATE POLICY entity_scope ON %I AS RESTRICTIVE FOR ALL TO clearline_app
      USING ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]))
      WITH CHECK ((SELECT app_entity_scope()) IS NULL OR entity_id = ANY ((SELECT app_entity_scope())::text[]))$p$, tbl);
  END LOOP;
END $$;
--> statement-breakpoint

CREATE FUNCTION check_provider_api_connection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE merchant record; app boolean := pg_has_role(session_user, 'clearline_app', 'MEMBER');
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT kind, provider_org_id INTO merchant FROM public.organizations WHERE id = NEW.org_id;
    IF merchant.kind IS DISTINCT FROM 'merchant' OR merchant.provider_org_id IS NULL OR NEW.provider_org_id IS DISTINCT FROM merchant.provider_org_id THEN
      RAISE EXCEPTION 'a provider API connection belongs to a merchant and reads its own provider only' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'active' OR NEW.disabled_at IS NOT NULL OR NEW.disabled_by IS NOT NULL THEN
      RAISE EXCEPTION 'a provider API connection starts active' USING ERRCODE = 'check_violation';
    END IF;
    IF app AND (NEW.created_by IS DISTINCT FROM public.app_user_id() OR NOT EXISTS (
         SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.created_by AND m.role = 'admin' AND m.revoked_at IS NULL)) THEN
      RAISE EXCEPTION 'a provider API connection is created by the signed-in merchant Admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.id, NEW.entity_id, NEW.provider_org_id, NEW.name, NEW.file_type, NEW.template_name, NEW.config::text, NEW.api_key_ref, NEW.webhook_secret_ref, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.org_id, OLD.id, OLD.entity_id, OLD.provider_org_id, OLD.name, OLD.file_type, OLD.template_name, OLD.config::text, OLD.api_key_ref, OLD.webhook_secret_ref, OLD.created_by, OLD.created_at)
     OR OLD.status <> 'active' OR NEW.status <> 'disabled' THEN
    RAISE EXCEPTION 'a provider API connection never changes; it can only be disabled, once (a change is a new connection)' USING ERRCODE = 'check_violation';
  END IF;
  IF app AND (NEW.disabled_by IS DISTINCT FROM public.app_user_id() OR NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.disabled_by AND m.role = 'admin' AND m.revoked_at IS NULL)) THEN
    RAISE EXCEPTION 'a provider API connection is disabled by the signed-in merchant Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_api_connections_check BEFORE INSERT OR UPDATE ON provider_api_connections FOR EACH ROW EXECUTE FUNCTION check_provider_api_connection();
--> statement-breakpoint
CREATE TRIGGER provider_api_connections_no_delete BEFORE DELETE ON provider_api_connections FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

CREATE FUNCTION check_provider_pull() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE conn record; tpl record; up record; app boolean := pg_has_role(session_user, 'clearline_app', 'MEMBER');
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO conn FROM public.provider_api_connections c WHERE c.org_id = NEW.org_id AND c.id = NEW.connection_id;
    SELECT * INTO tpl FROM public.mapping_templates mt WHERE mt.org_id = NEW.org_id AND mt.id = NEW.template_id;
    IF conn.id IS NULL OR conn.status <> 'active' OR NEW.entity_id IS DISTINCT FROM conn.entity_id THEN
      RAISE EXCEPTION 'a pull reads an active connection, for that connection''s entity' USING ERRCODE = 'check_violation';
    END IF;
    IF tpl.id IS NULL OR tpl.file_type IS DISTINCT FROM conn.file_type OR tpl.name IS DISTINCT FROM conn.template_name OR tpl.version IS DISTINCT FROM NEW.template_version
       OR tpl.provider_org_id IS DISTINCT FROM conn.provider_org_id THEN
      RAISE EXCEPTION 'a pull uses a version of its connection''s own mapping template' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'running' OR NEW.finished_at IS NOT NULL OR NEW.upload_id IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.events_consumed <> 0 THEN
      RAISE EXCEPTION 'a pull starts running' USING ERRCODE = 'check_violation';
    END IF;
    IF app AND (NEW.started_by IS DISTINCT FROM public.app_user_id() OR NOT EXISTS (
         SELECT 1 FROM public.organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.started_by AND m.role IN ('finance', 'payment_ops') AND m.revoked_at IS NULL)) THEN
      RAISE EXCEPTION 'a pull is started by the signed-in Finance or Payment Operations member' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.id, NEW.connection_id, NEW.entity_id, NEW.idempotency_key, NEW.template_id, NEW.template_version, NEW.start_cursor, NEW.started_by, NEW.started_at)
     IS DISTINCT FROM (OLD.org_id, OLD.id, OLD.connection_id, OLD.entity_id, OLD.idempotency_key, OLD.template_id, OLD.template_version, OLD.start_cursor, OLD.started_by, OLD.started_at)
     OR OLD.status <> 'running' OR NEW.status = 'running' THEN
    RAISE EXCEPTION 'a pull finishes once and its facts never change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.upload_id IS NOT NULL THEN
    SELECT * INTO up FROM public.uploads u WHERE u.org_id = NEW.org_id AND u.id = NEW.upload_id;
    IF up.id IS NULL OR up.entity_id IS DISTINCT FROM NEW.entity_id OR up.template_id IS DISTINCT FROM NEW.template_id OR up.template_version IS DISTINCT FROM NEW.template_version THEN
      RAISE EXCEPTION 'a pull''s upload is of its entity, read with the pull''s template version' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_pulls_check BEFORE INSERT OR UPDATE ON provider_pulls FOR EACH ROW EXECUTE FUNCTION check_provider_pull();
--> statement-breakpoint
CREATE TRIGGER provider_pulls_no_delete BEFORE DELETE ON provider_pulls FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

CREATE FUNCTION check_provider_webhook_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE pull record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- only provider_webhook_record (as the owner) inserts: the runtime role has no INSERT privilege on this table
    IF NEW.pull_id IS NOT NULL THEN RAISE EXCEPTION 'a webhook event arrives pending' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.org_id, NEW.connection_id, NEW.event_id, NEW.entity_id, NEW.body_sha256, NEW.signed_at, NEW.received_at)
     IS DISTINCT FROM (OLD.org_id, OLD.connection_id, OLD.event_id, OLD.entity_id, OLD.body_sha256, OLD.signed_at, OLD.received_at)
     OR OLD.pull_id IS NOT NULL OR NEW.pull_id IS NULL THEN
    RAISE EXCEPTION 'a webhook event is attached to one pull, once, and otherwise never changes' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO pull FROM public.provider_pulls p WHERE p.org_id = NEW.org_id AND p.id = NEW.pull_id;
  IF pull.id IS NULL OR pull.connection_id IS DISTINCT FROM NEW.connection_id THEN
    RAISE EXCEPTION 'a webhook event is attached to a pull of its own connection' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_webhook_events_check BEFORE INSERT OR UPDATE ON provider_webhook_events FOR EACH ROW EXECUTE FUNCTION check_provider_webhook_event();
--> statement-breakpoint
CREATE TRIGGER provider_webhook_events_no_delete BEFORE DELETE ON provider_webhook_events FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- The webhook receiver's three functions (no tenant context: the delivery is not signed in).
CREATE FUNCTION provider_webhook_target(conn uuid) RETURNS TABLE (org_id uuid, webhook_secret_ref text) LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT c.org_id, c.webhook_secret_ref FROM public.provider_api_connections c
  WHERE c.id = conn AND c.status = 'active' AND c.webhook_secret_ref IS NOT NULL
$$;
--> statement-breakpoint
CREATE FUNCTION provider_webhook_record(conn uuid, event text, body_sha text, signed timestamptz) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE c record; n integer;
BEGIN
  SELECT * INTO c FROM public.provider_api_connections x WHERE x.id = conn AND x.status = 'active' AND x.webhook_secret_ref IS NOT NULL;
  IF c.id IS NULL THEN RETURN 'refused'; END IF;
  INSERT INTO public.provider_webhook_events (org_id, connection_id, event_id, entity_id, body_sha256, signed_at)
    VALUES (c.org_id, c.id, event, c.entity_id, body_sha, signed) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audit_events (org_id, source, actor_user_id, action, entity_type, entity_id, summary, at, details)
    VALUES (c.org_id, 'server', NULL, CASE WHEN n = 1 THEN 'provider_webhook_received' ELSE 'provider_webhook_duplicate' END, 'provider_api_connection', c.id::text,
      CASE WHEN n = 1 THEN 'Provider webhook received (signature verified); a pull is due' ELSE 'Provider webhook delivered again (same event id); not processed twice' END,
      now(), jsonb_build_object('connectionId', c.id, 'bodySha256', body_sha));
  RETURN CASE WHEN n = 1 THEN 'accepted' ELSE 'duplicate' END;
END $$;
--> statement-breakpoint
CREATE FUNCTION provider_webhook_refused(conn uuid, reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE c record;
BEGIN
  IF reason NOT IN ('too_large', 'malformed_signature', 'stale_timestamp', 'bad_signature', 'malformed_body', 'no_event_id', 'secret_unavailable') THEN
    RAISE EXCEPTION 'unknown refusal reason' USING ERRCODE = 'check_violation';
  END IF;
  SELECT x.org_id, x.id INTO c FROM public.provider_api_connections x WHERE x.id = conn;
  IF c.id IS NULL THEN RETURN; END IF;
  INSERT INTO public.audit_events (org_id, source, actor_user_id, action, entity_type, entity_id, summary, at, details)
    VALUES (c.org_id, 'server', NULL, 'provider_webhook_refused', 'provider_api_connection', c.id::text, 'Provider webhook refused (' || reason || ')',
      now(), jsonb_build_object('connectionId', c.id, 'reason', reason));
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION provider_webhook_target(uuid), provider_webhook_record(uuid, text, text, timestamptz), provider_webhook_refused(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION provider_webhook_target(uuid), provider_webhook_record(uuid, text, text, timestamptz), provider_webhook_refused(uuid, text) TO clearline_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON provider_api_connections TO clearline_app;
--> statement-breakpoint
GRANT UPDATE (status, disabled_by, disabled_at) ON provider_api_connections TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON provider_pulls TO clearline_app;
--> statement-breakpoint
GRANT UPDATE (status, next_cursor, pages, records, requests, retries, events_consumed, upload_id, error_code, finished_at) ON provider_pulls TO clearline_app;
--> statement-breakpoint
GRANT SELECT ON provider_webhook_events TO clearline_app;
--> statement-breakpoint
GRANT UPDATE (pull_id) ON provider_webhook_events TO clearline_app;
