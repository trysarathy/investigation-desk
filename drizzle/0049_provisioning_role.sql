-- v1 phase 1.1 (onboarding): the narrow `clearline_provisioning` role. Runs as the schema owner.
--
-- The platform console and the merchant's setup wizard write through this role, never through the schema owner and
-- never through the runtime role (whose grants this migration does not touch). The role:
--   - is NOBYPASSRLS, owns nothing, cannot create objects, is not a member of clearline_app;
--   - holds NO privilege on any table, view or sequence: it cannot read or write a row directly;
--   - may only EXECUTE the prov_* functions below. Each is SECURITY DEFINER (owned by the schema owner, fixed
--     search_path) and checks, inside the database, who is acting from the transaction's app.user_id / app.org_id
--     (set by the server from the session, as for the runtime role):
--       * wizard functions act ONLY on app_org_id() (they take no organisation argument), ONLY for an active Admin
--         of that merchant, ONLY while its setup is not finished, and write one audit_events row each;
--       * platform functions act only for an active platform operator (platform_operators);
--       * prov_accept_invitation acts only for the holder of a valid, pending, unexpired invitation token.
-- Every write is audited with the acting user's id. Nothing here moves money; the default matching policy is the
-- approved one (larger of 0.5% or SGD 5 / USD 5 / AED 20) and the imported-bank-line flag stays OFF.
--
-- scripts/db/setup-local.sh creates the login with its password. If it does not exist yet, it is created here
-- WITHOUT login, so nothing can sign in as it until an administrator sets a password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearline_provisioning') THEN
    CREATE ROLE clearline_provisioning NOLOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clearline_provisioning;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- Internal helpers (not executable by anyone but the owner and the functions below)
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION prov_refuse(msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'provisioning refused: %', msg USING ERRCODE = 'insufficient_privilege'; END $$;
--> statement-breakpoint
CREATE FUNCTION prov_invalid(msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'provisioning: %', msg USING ERRCODE = 'check_violation'; END $$;
--> statement-breakpoint

-- The merchant organisation of this transaction, when the acting user is its active Admin and setup is still open.
CREATE FUNCTION prov_admin_org() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.app_org_id(); u text := public.app_user_id();
BEGIN
  IF o IS NULL OR u IS NULL THEN PERFORM public.prov_refuse('no signed-in user and organisation in this transaction'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = o AND m.user_id = u AND m.role = 'admin' AND m.revoked_at IS NULL) THEN
    PERFORM public.prov_refuse('only an Admin of this organisation runs its setup');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = o AND kind = 'merchant') THEN PERFORM public.prov_refuse('setup is for a merchant organisation'); END IF;
  RETURN o;
END $$;
--> statement-breakpoint
CREATE FUNCTION prov_open_admin_org() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_admin_org();
BEGIN
  IF EXISTS (SELECT 1 FROM public.org_setup_steps WHERE org_id = o AND step = 'finish') THEN
    PERFORM public.prov_refuse('setup is finished; later changes go through the operator (admin CLI) or Settings');
  END IF;
  RETURN o;
END $$;
--> statement-breakpoint
CREATE FUNCTION prov_require_platform_operator() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE u text := public.app_user_id();
BEGIN
  IF u IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_operators WHERE user_id = u AND revoked_at IS NULL) THEN
    PERFORM public.prov_refuse('only a platform operator');
  END IF;
  RETURN u;
END $$;
--> statement-breakpoint
CREATE FUNCTION prov_audit(o uuid, act text, etype text, eid text, summary text, details jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  INSERT INTO public.audit_events (org_id, source, actor_user_id, action, entity_type, entity_id, summary, at, details)
  VALUES (o, 'server', public.app_user_id(), act, etype, eid, summary || ' (setup, provisioning role)', now(), details)
$$;
--> statement-breakpoint
-- An invitation (shared by the platform console and the wizard): an earlier pending one for the same person is revoked.
CREATE FUNCTION prov_insert_invitation(o uuid, p_email text, p_role text, p_token_sha256 text, p_expires_at timestamptz, via text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE e text := lower(btrim(p_email)); inv uuid; prior int;
BEGIN
  IF e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(e) > 254 THEN PERFORM public.prov_invalid('not an email address'); END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '7 days' THEN PERFORM public.prov_invalid('an invitation expires within 7 days'); END IF;
  IF EXISTS (SELECT 1 FROM public.organization_memberships m JOIN public.users x ON x.id = m.user_id
             WHERE m.org_id = o AND x.email = e AND m.revoked_at IS NULL) THEN
    PERFORM public.prov_invalid('that person is already a member of this organisation');
  END IF;
  UPDATE public.org_invitations SET status = 'revoked', closed_at = now() WHERE org_id = o AND email = e AND status = 'pending';
  GET DIAGNOSTICS prior = ROW_COUNT;
  INSERT INTO public.org_invitations (org_id, email, role, token_sha256, invited_by, invited_via, expires_at)
  VALUES (o, e, p_role, p_token_sha256, public.app_user_id(), via, p_expires_at) RETURNING id INTO inv;
  PERFORM public.prov_audit(o, 'invitation_created', 'invitation', inv::text, format('Invitation %s created for the %s role%s', inv, p_role, CASE WHEN prior > 0 THEN ' (replaces an earlier pending one)' ELSE '' END),
    jsonb_build_object('invitationId', inv, 'role', p_role, 'via', via, 'replaced', prior));
  RETURN inv;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- Platform console
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION prov_is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.app_user_id() IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_operators WHERE user_id = public.app_user_id() AND revoked_at IS NULL)
$$;
--> statement-breakpoint
-- A new, empty, LIVE organisation ("Your data"). `engine_state` is the empty workspace state the server builds.
CREATE FUNCTION prov_platform_create_org(p_kind text, p_slug text, p_name text, p_timezone text, p_provider_slug text, p_engine_state jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE op text := public.prov_require_platform_operator(); o uuid; prov uuid;
BEGIN
  IF p_kind NOT IN ('merchant', 'provider') THEN PERFORM public.prov_invalid('kind is merchant or provider'); END IF;
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN PERFORM public.prov_invalid('a slug is 2–63 lower-case letters, digits or dashes'); END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 200 THEN PERFORM public.prov_invalid('a name is 1–200 characters'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN PERFORM public.prov_invalid('not an IANA time zone'); END IF;
  IF jsonb_typeof(p_engine_state) IS DISTINCT FROM 'object' THEN PERFORM public.prov_invalid('engine state is an object'); END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = p_slug) THEN PERFORM public.prov_invalid('that slug is already used'); END IF;
  IF p_provider_slug IS NOT NULL THEN
    IF p_kind <> 'merchant' THEN PERFORM public.prov_invalid('only a merchant is served by a provider'); END IF;
    SELECT id INTO prov FROM public.organizations WHERE slug = p_provider_slug AND kind = 'provider';
    IF prov IS NULL THEN PERFORM public.prov_invalid('no provider organisation has that slug'); END IF;
  END IF;
  INSERT INTO public.organizations (slug, name, timezone, fictional, kind, provider_org_id, data_mode)
  VALUES (p_slug, btrim(p_name), p_timezone, false, p_kind, prov, 'live') RETURNING id INTO o;
  INSERT INTO public.org_engine_state (org_id, version, state) VALUES (o, 1, p_engine_state);
  PERFORM public.prov_audit(o, 'organization_created', 'organization', o::text, format('Organisation %s created (%s, live, empty) from the platform console', p_slug, p_kind),
    jsonb_build_object('kind', p_kind, 'providerOrgId', prov, 'operatorUserId', op));
  RETURN o;
END $$;
--> statement-breakpoint
-- The FIRST admin of an organisation (Admin of a merchant, Provider Admin of a provider). Refused once it has one.
CREATE FUNCTION prov_platform_invite_admin(p_org uuid, p_email text, p_token_sha256 text, p_expires_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE k text; r text;
BEGIN
  PERFORM public.prov_require_platform_operator();
  SELECT kind INTO k FROM public.organizations WHERE id = p_org;
  IF k IS NULL THEN PERFORM public.prov_invalid('no such organisation'); END IF;
  r := CASE k WHEN 'provider' THEN 'provider_admin' ELSE 'admin' END;
  IF EXISTS (SELECT 1 FROM public.organization_memberships WHERE org_id = p_org AND role = r AND revoked_at IS NULL) THEN
    PERFORM public.prov_invalid('this organisation already has an admin; its admin invites everyone else');
  END IF;
  RETURN public.prov_insert_invitation(p_org, p_email, r, p_token_sha256, p_expires_at, 'platform');
END $$;
--> statement-breakpoint
-- What the operator sees: ids, names, kinds, counts. Never member emails or any organisation's data.
CREATE FUNCTION prov_platform_orgs() RETURNS TABLE (id uuid, slug text, name text, kind text, data_mode text, created_at timestamptz,
  admins integer, pending_invitations integer, setup_finished boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.prov_require_platform_operator();
  RETURN QUERY SELECT o.id, o.slug, o.name, o.kind, o.data_mode, o.created_at,
    (SELECT count(*)::int FROM public.organization_memberships m WHERE m.org_id = o.id AND m.role IN ('admin', 'provider_admin') AND m.revoked_at IS NULL),
    (SELECT count(*)::int FROM public.org_invitations i WHERE i.org_id = o.id AND i.status = 'pending' AND i.expires_at > now()),
    EXISTS (SELECT 1 FROM public.org_setup_steps s WHERE s.org_id = o.id AND s.step = 'finish')
  FROM public.organizations o WHERE o.data_mode = 'live' ORDER BY o.created_at DESC, o.slug LIMIT 500;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- Accepting an invitation (the invitee is not signed in: the token is the proof)
-- ---------------------------------------------------------------------------------------------------------------

CREATE FUNCTION prov_accept_invitation(p_token_sha256 text, p_user_id text, p_name text, p_password_hash text)
RETURNS TABLE (org_slug text, role text, existing_user boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
DECLARE inv public.org_invitations%ROWTYPE; uid text; existed boolean; s text;
BEGIN
  SELECT * INTO inv FROM public.org_invitations WHERE token_sha256 = p_token_sha256 FOR UPDATE;
  IF NOT FOUND OR inv.status <> 'pending' OR inv.expires_at <= now() THEN
    PERFORM public.prov_refuse('this invitation link is not valid (it was used, replaced, revoked or has expired)');
  END IF;
  SELECT id INTO uid FROM public.users WHERE email = inv.email;
  existed := uid IS NOT NULL;
  IF NOT existed THEN
    IF p_user_id !~ '^[0-9a-f-]{36}$' THEN PERFORM public.prov_invalid('user id'); END IF;
    IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 200 THEN PERFORM public.prov_invalid('a name is 1–200 characters'); END IF;
    IF coalesce(p_password_hash, '') !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN PERFORM public.prov_invalid('password hash'); END IF;
    INSERT INTO public.users (id, name, email, email_verified) VALUES (p_user_id, btrim(p_name), inv.email, true);
    INSERT INTO public.accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
    VALUES (gen_random_uuid()::text, p_user_id, 'credential', p_user_id, p_password_hash, now(), now());
    uid := p_user_id;
  END IF;
  INSERT INTO public.organization_memberships (org_id, user_id, role) VALUES (inv.org_id, uid, inv.role)
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL;
  UPDATE public.org_invitations SET status = 'accepted', closed_at = now(), accepted_user_id = uid WHERE id = inv.id;
  INSERT INTO public.audit_events (org_id, source, actor_user_id, action, entity_type, entity_id, summary, at, details)
  VALUES (inv.org_id, 'server', uid, 'invitation_accepted', 'invitation', inv.id::text,
    format('Invitation %s accepted: user %s joined with the %s role%s (provisioning role)', inv.id, uid, inv.role, CASE WHEN existed THEN ' (existing account)' ELSE '' END), now(),
    jsonb_build_object('invitationId', inv.id, 'userId', uid, 'role', inv.role, 'existingUser', existed));
  SELECT o.slug INTO s FROM public.organizations o WHERE o.id = inv.org_id;
  RETURN QUERY SELECT s, inv.role, existed;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- The merchant's setup wizard (app_org_id() only; an active Admin; setup not finished)
-- ---------------------------------------------------------------------------------------------------------------

-- A legal entity in SGD, USD or AED with the APPROVED default policy (larger of 0.5% or SGD 5 / USD 5 / AED 20;
-- write-off threshold the same fixed amount; approvers are Approvers; imported bank lines never verify).
CREATE FUNCTION prov_add_entity(p_id text, p_name text, p_currency text, p_timezone text, p_utc_offset_minutes integer, p_ledger text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org(); prior public.merchant_entities%ROWTYPE; fixed bigint;
BEGIN
  IF p_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN PERFORM public.prov_invalid('an entity id is 1–64 letters, digits, dashes or underscores'); END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 200 THEN PERFORM public.prov_invalid('a legal name is 1–200 characters'); END IF;
  IF p_currency NOT IN ('SGD', 'USD', 'AED') THEN PERFORM public.prov_invalid('currency is SGD, USD or AED'); END IF;
  IF p_ledger NOT IN ('xero', 'quickbooks', 'none') THEN PERFORM public.prov_invalid('ledger is xero, quickbooks or none'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN PERFORM public.prov_invalid('not an IANA time zone'); END IF;
  IF p_utc_offset_minutes IS NULL OR p_utc_offset_minutes NOT BETWEEN -720 AND 840 OR p_utc_offset_minutes % 15 <> 0 THEN
    PERFORM public.prov_invalid('a UTC offset is whole quarter hours between -12:00 and +14:00');
  END IF;
  SELECT * INTO prior FROM public.merchant_entities WHERE org_id = o AND id = p_id;
  IF FOUND THEN
    IF prior.name = btrim(p_name) AND prior.functional_currency = p_currency AND prior.timezone = p_timezone AND prior.utc_offset_minutes = p_utc_offset_minutes AND prior.ledger = p_ledger THEN
      RETURN 'exists';
    END IF;
    PERFORM public.prov_invalid('that entity already exists with different values; nothing changed');
  END IF;
  fixed := CASE p_currency WHEN 'AED' THEN 2000 ELSE 500 END;
  INSERT INTO public.merchant_entities (org_id, id, name, functional_currency, ledger, timezone, utc_offset_minutes)
  VALUES (o, p_id, btrim(p_name), p_currency, p_ledger, p_timezone, p_utc_offset_minutes);
  INSERT INTO public.merchant_policy (org_id, entity_id, tolerance_bps, tolerance_abs_minor, tolerance_combine, writeoff_threshold_minor, approver_roles,
    allow_imported_bank_lines_as_verified, sender_fee_bound_base_units)
  VALUES (o, p_id, 50, fixed, 'larger', fixed, '["approver"]'::jsonb, false, 2000000);
  PERFORM public.prov_audit(o, 'merchant_entity_created', 'merchant_entity', p_id,
    format('Entity %s created (%s, UTC offset %s min, ledger %s) with the default policy, revision 1', p_id, p_currency, p_utc_offset_minutes, p_ledger),
    jsonb_build_object('currency', p_currency, 'ledger', p_ledger, 'utcOffsetMinutes', p_utc_offset_minutes, 'policyRevision', 1));
  RETURN 'created';
END $$;
--> statement-breakpoint
-- The ledger an entity's journals are prepared for. A choice only: nothing connects to Xero or QuickBooks here.
CREATE FUNCTION prov_set_entity_ledger(p_entity text, p_ledger text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org(); was text;
BEGIN
  IF p_ledger NOT IN ('xero', 'quickbooks', 'none') THEN PERFORM public.prov_invalid('ledger is xero, quickbooks or none'); END IF;
  SELECT ledger INTO was FROM public.merchant_entities WHERE org_id = o AND id = p_entity FOR UPDATE;
  IF was IS NULL THEN PERFORM public.prov_invalid('no such entity in this organisation'); END IF;
  IF was = p_ledger THEN RETURN 'unchanged'; END IF;
  UPDATE public.merchant_entities SET ledger = p_ledger WHERE org_id = o AND id = p_entity;
  PERFORM public.prov_audit(o, 'merchant_entity_ledger_set', 'merchant_entity', p_entity, format('Entity %s ledger: %s (was %s); no connection made', p_entity, p_ledger, was),
    jsonb_build_object('ledger', p_ledger, 'previous', was));
  RETURN 'changed';
END $$;
--> statement-breakpoint
-- A bank account of an entity: only the LAST FOUR characters of its number are ever stored.
CREATE FUNCTION prov_add_bank_account(p_entity text, p_name text, p_currency text, p_last4 text, p_bank text, p_bic text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org(); prior public.bank_accounts%ROWTYPE; a uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.merchant_entities WHERE org_id = o AND id = p_entity) THEN PERFORM public.prov_invalid('no such entity in this organisation'); END IF;
  IF p_currency NOT IN ('SGD', 'USD', 'AED') THEN PERFORM public.prov_invalid('currency is SGD, USD or AED'); END IF;
  IF coalesce(p_last4, '') !~ '^[A-Z0-9]{4}$' THEN PERFORM public.prov_invalid('exactly the last four letters or digits of the account number'); END IF;
  SELECT * INTO prior FROM public.bank_accounts WHERE org_id = o AND entity_id = p_entity AND display_name = btrim(p_name);
  IF FOUND THEN
    IF prior.currency = p_currency AND prior.account_last4 = p_last4 AND prior.bank_name = btrim(p_bank) AND prior.bic IS NOT DISTINCT FROM p_bic AND prior.status = 'active' THEN RETURN prior.id; END IF;
    PERFORM public.prov_invalid('that entity already has an account with this name and different values; nothing changed');
  END IF;
  INSERT INTO public.bank_accounts (org_id, entity_id, currency, display_name, account_last4, bank_name, bic, status, created_by)
  VALUES (o, p_entity, p_currency, btrim(p_name), p_last4, btrim(p_bank), p_bic, 'active', public.app_user_id()) RETURNING id INTO a;
  PERFORM public.prov_audit(o, 'bank_account_created', 'bank_account', a::text, format('Bank account %s added to entity %s (%s)', a, p_entity, p_currency),
    jsonb_build_object('entityId', p_entity, 'bankAccountId', a, 'currency', p_currency));
  RETURN a;
END $$;
--> statement-breakpoint
-- Link this merchant to a provider when it has none. Aggregates only (no grant is created); a relink stays with the operator.
CREATE FUNCTION prov_link_provider(p_provider_slug text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org(); cur uuid; prov uuid;
BEGIN
  SELECT provider_org_id INTO cur FROM public.organizations WHERE id = o FOR UPDATE;
  SELECT id INTO prov FROM public.organizations WHERE slug = p_provider_slug AND kind = 'provider';
  IF prov IS NULL THEN PERFORM public.prov_invalid('no provider has that code'); END IF;
  IF cur = prov THEN RETURN 'exists'; END IF;
  IF cur IS NOT NULL THEN PERFORM public.prov_invalid('this merchant already has a provider; a change goes through the operator'); END IF;
  UPDATE public.organizations SET provider_org_id = prov WHERE id = o;
  PERFORM public.prov_audit(o, 'merchant_provider_linked', 'organization', o::text, format('Served by provider organisation %s; aggregates only until the Admin grants more', prov),
    jsonb_build_object('providerOrgId', prov));
  RETURN 'linked';
END $$;
--> statement-breakpoint
-- A starter column-mapping template (the server validated the mapping against the headers). Version = next for the name.
CREATE FUNCTION prov_add_mapping_template(p_file_type text, p_name text, p_header_signature text, p_mapping jsonb) RETURNS TABLE (id uuid, version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
DECLARE o uuid := public.prov_open_admin_org(); prov uuid; v integer; t uuid;
BEGIN
  IF jsonb_typeof(p_mapping) IS DISTINCT FROM 'object' OR p_mapping->>'fileType' IS DISTINCT FROM p_file_type THEN PERFORM public.prov_invalid('the mapping is for another file type'); END IF;
  IF p_file_type IN ('provider_export', 'settlement_report') THEN
    SELECT provider_org_id INTO prov FROM public.organizations WHERE organizations.id = o;
    IF prov IS NULL THEN PERFORM public.prov_invalid('this merchant has no provider, so it has no provider files to map'); END IF;
  END IF;
  SELECT coalesce(max(mt.version), 0) + 1 INTO v FROM public.mapping_templates mt WHERE mt.org_id = o AND mt.file_type = p_file_type AND mt.name = btrim(p_name);
  INSERT INTO public.mapping_templates (org_id, provider_org_id, file_type, name, version, header_signature, mapping, created_by)
  VALUES (o, prov, p_file_type, btrim(p_name), v, p_header_signature, p_mapping, public.app_user_id()) RETURNING mapping_templates.id INTO t;
  PERFORM public.prov_audit(o, 'mapping_template_saved', 'mapping_template', t::text, format('Mapping template saved during setup (%s, version %s)', p_file_type, v),
    jsonb_build_object('templateId', t, 'version', v, 'fileType', p_file_type));
  RETURN QUERY SELECT t, v;
END $$;
--> statement-breakpoint
-- Invite a member of this merchant (one of the merchant roles).
CREATE FUNCTION prov_invite_member(p_email text, p_role text, p_token_sha256 text, p_expires_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org();
BEGIN
  IF p_role NOT IN ('admin', 'payment_ops', 'finance', 'approver', 'viewer') THEN PERFORM public.prov_invalid('role is one of admin, payment_ops, finance, approver, viewer'); END IF;
  RETURN public.prov_insert_invitation(o, p_email, p_role, p_token_sha256, p_expires_at, 'merchant_admin');
END $$;
--> statement-breakpoint
CREATE FUNCTION prov_revoke_invitation(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org(); n int;
BEGIN
  UPDATE public.org_invitations SET status = 'revoked', closed_at = now() WHERE org_id = o AND id = p_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN PERFORM public.prov_invalid('no pending invitation with that id in this organisation'); END IF;
  PERFORM public.prov_audit(o, 'invitation_revoked', 'invitation', p_id::text, format('Invitation %s revoked', p_id), jsonb_build_object('invitationId', p_id));
  RETURN 'revoked';
END $$;
--> statement-breakpoint
-- Mark a step done ('finish' closes setup: afterwards every wizard write is refused).
CREATE FUNCTION prov_mark_step(p_step text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_open_admin_org();
BEGIN
  IF p_step NOT IN ('entities', 'ledger', 'bank_accounts', 'tolerance', 'provider', 'mapping_templates', 'members', 'finish') THEN PERFORM public.prov_invalid('unknown step'); END IF;
  IF p_step IN ('entities', 'ledger', 'tolerance', 'finish') AND NOT EXISTS (SELECT 1 FROM public.merchant_entities WHERE org_id = o) THEN
    PERFORM public.prov_invalid('add at least one entity first');
  END IF;
  IF p_step = 'finish' AND EXISTS (SELECT 1 FROM unnest(array['entities', 'ledger', 'tolerance']) s WHERE NOT EXISTS (SELECT 1 FROM public.org_setup_steps x WHERE x.org_id = o AND x.step = s)) THEN
    PERFORM public.prov_invalid('confirm the entities, ledger and tolerance steps first');
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_setup_steps WHERE org_id = o AND step = p_step) THEN RETURN 'exists'; END IF;
  INSERT INTO public.org_setup_steps (org_id, step, done_by) VALUES (o, p_step, public.app_user_id());
  PERFORM public.prov_audit(o, CASE WHEN p_step = 'finish' THEN 'setup_finished' ELSE 'setup_step_done' END, 'setup_step', p_step, format('Setup step %s done', p_step), jsonb_build_object('step', p_step));
  RETURN 'done';
END $$;
--> statement-breakpoint
-- What the wizard shows that lives in the provisioning tables: steps done and pending invitations (an Admin only).
CREATE FUNCTION prov_setup_state() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_admin_org();
BEGIN
  RETURN jsonb_build_object(
    'steps', coalesce((SELECT jsonb_object_agg(step, done_at) FROM public.org_setup_steps WHERE org_id = o), '{}'::jsonb),
    'invitations', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'email', email, 'role', role, 'expiresAt', expires_at, 'expired', expires_at <= now()) ORDER BY created_at)
      FROM public.org_invitations WHERE org_id = o AND status = 'pending'), '[]'::jsonb));
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------
-- Who may execute what: nobody but the provisioning role, and only the entry points.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION prov_refuse(text), prov_invalid(text), prov_admin_org(), prov_open_admin_org(), prov_require_platform_operator(),
  prov_audit(uuid, text, text, text, text, jsonb), prov_insert_invitation(uuid, text, text, text, timestamptz, text),
  prov_is_platform_operator(), prov_platform_create_org(text, text, text, text, text, jsonb), prov_platform_invite_admin(uuid, text, text, timestamptz),
  prov_platform_orgs(), prov_accept_invitation(text, text, text, text),
  prov_add_entity(text, text, text, text, integer, text), prov_set_entity_ledger(text, text), prov_add_bank_account(text, text, text, text, text, text),
  prov_link_provider(text), prov_add_mapping_template(text, text, text, jsonb), prov_invite_member(text, text, text, timestamptz),
  prov_revoke_invitation(uuid), prov_mark_step(text), prov_setup_state() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION prov_is_platform_operator(), prov_platform_create_org(text, text, text, text, text, jsonb), prov_platform_invite_admin(uuid, text, text, timestamptz),
  prov_platform_orgs(), prov_accept_invitation(text, text, text, text),
  prov_add_entity(text, text, text, text, integer, text), prov_set_entity_ledger(text, text), prov_add_bank_account(text, text, text, text, text, text),
  prov_link_provider(text), prov_add_mapping_template(text, text, text, jsonb), prov_invite_member(text, text, text, timestamptz),
  prov_revoke_invitation(uuid), prov_mark_step(text), prov_setup_state() TO clearline_provisioning;
