-- v1 overnight (invite links): a merchant's Admin manages members AFTER setup, through the provisioning role. Runs as
-- the schema owner. ADDITIVE ONLY: three new SECURITY DEFINER entry points for clearline_provisioning; no existing
-- function, table, policy or grant changes, and the runtime role's grants are untouched.
--
-- Until now an Admin could invite only while setup was open (prov_invite_member uses prov_open_admin_org()), and
-- nobody but the operator's CLI could end a membership. These act on app_org_id() only, for an active UNSCOPED Admin
-- of that merchant (prov_admin_org(), drizzle/0069), whether or not setup is finished, and audit every write:
--   prov_member_invite(email, role, token_sha256, expires_at): an invitation (the token's SHA-256 only, as before);
--   prov_member_revoke_invitation(id): a pending invitation stops working;
--   prov_member_deactivate(user_id): the membership is revoked and that user's sessions end. Refused for yourself
--     and for the last active unscoped Admin (an organisation never loses the person who manages its members).

CREATE FUNCTION prov_member_invite(p_email text, p_role text, p_token_sha256 text, p_expires_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_admin_org();
BEGIN
  IF p_role NOT IN ('admin', 'payment_ops', 'finance', 'approver', 'viewer') THEN PERFORM public.prov_invalid('role is one of admin, payment_ops, finance, approver, viewer'); END IF;
  RETURN public.prov_insert_invitation(o, p_email, p_role, p_token_sha256, p_expires_at, 'merchant_admin');
END $$;
--> statement-breakpoint
CREATE FUNCTION prov_member_revoke_invitation(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_admin_org(); n int;
BEGIN
  UPDATE public.org_invitations SET status = 'revoked', closed_at = now() WHERE org_id = o AND id = p_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN PERFORM public.prov_invalid('no pending invitation with that id in this organisation'); END IF;
  PERFORM public.prov_audit(o, 'invitation_revoked', 'invitation', p_id::text, format('Invitation %s revoked by an Admin', p_id), jsonb_build_object('invitationId', p_id));
  RETURN 'revoked';
END $$;
--> statement-breakpoint
CREATE FUNCTION prov_member_deactivate(p_user_id text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE o uuid := public.prov_admin_org(); r text; n int;
BEGIN
  IF p_user_id IS NULL OR p_user_id = public.app_user_id() THEN PERFORM public.prov_invalid('you cannot deactivate yourself'); END IF;
  SELECT m.role INTO r FROM public.organization_memberships m WHERE m.org_id = o AND m.user_id = p_user_id AND m.revoked_at IS NULL FOR UPDATE;
  IF r IS NULL THEN PERFORM public.prov_invalid('no active member with that id in this organisation'); END IF;
  -- serialise concurrent deactivations of Admins in this organisation, then count who would be left
  PERFORM 1 FROM public.organization_memberships m WHERE m.org_id = o AND m.role = 'admin' AND m.revoked_at IS NULL FOR UPDATE;
  IF r = 'admin' AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.org_id = o AND m.role = 'admin' AND m.revoked_at IS NULL
                                 AND NOT m.entity_scoped AND m.user_id <> p_user_id) THEN
    PERFORM public.prov_invalid('this is the last Admin of the organisation; invite another Admin first');
  END IF;
  UPDATE public.organization_memberships SET revoked_at = now() WHERE org_id = o AND user_id = p_user_id AND revoked_at IS NULL;
  DELETE FROM public.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.prov_audit(o, 'member_deactivated', 'user', p_user_id, format('Member %s (%s) deactivated by an Admin; %s session(s) ended', p_user_id, r, n),
    jsonb_build_object('userId', p_user_id, 'role', r, 'sessions', n));
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION prov_member_invite(text, text, text, timestamptz), prov_member_revoke_invitation(uuid), prov_member_deactivate(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION prov_member_invite(text, text, text, timestamptz), prov_member_revoke_invitation(uuid), prov_member_deactivate(text) TO clearline_provisioning;
