-- v1 phase 0: "exceptions per 100" defined once (src/lib/clearline/merchant/exception-rate.ts). The provider console
-- receives the five counts behind it for each of its own merchants, as aggregates only (no rows), under exactly the
-- guard of provider_merchant_health / provider_pilot_metrics. Runs as the schema owner. No existing control changes:
-- a new SECURITY DEFINER read function, EXECUTE granted to the app role only.
--   reconciled_payments   payments a run evaluated (one match record each), excluding unpaid orders (credited 0)
--   open_exceptions       exceptions not 'resolved' on those payments, excluding batch not tied
--   open_batch_not_tied   exceptions not 'resolved' on those payments whose current rule is M5.batch.not_tied
--   open_on_unpaid        exceptions not 'resolved' on unpaid orders (in neither rate)
--   open_without_payment  exceptions not 'resolved' on no reconciled payment (in neither rate)
CREATE FUNCTION provider_exception_rate(provider uuid)
RETURNS TABLE (merchant_org_id uuid, reconciled_payments bigint, open_exceptions bigint, open_batch_not_tied bigint, open_on_unpaid bigint, open_without_payment bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.id,
         (SELECT count(*) FROM public.match_records r WHERE r.org_id = m.id AND coalesce((r.ledger ->> 'creditedMinor')::numeric, 0) <> 0),
         (SELECT count(*) FROM public.recon_exceptions e JOIN public.match_records r ON r.org_id = e.org_id AND r.order_id = e.order_id
            WHERE e.org_id = m.id AND e.status <> 'resolved' AND coalesce((r.ledger ->> 'creditedMinor')::numeric, 0) <> 0 AND r.rule_id <> 'M5.batch.not_tied'),
         (SELECT count(*) FROM public.recon_exceptions e JOIN public.match_records r ON r.org_id = e.org_id AND r.order_id = e.order_id
            WHERE e.org_id = m.id AND e.status <> 'resolved' AND coalesce((r.ledger ->> 'creditedMinor')::numeric, 0) <> 0 AND r.rule_id = 'M5.batch.not_tied'),
         (SELECT count(*) FROM public.recon_exceptions e JOIN public.match_records r ON r.org_id = e.org_id AND r.order_id = e.order_id
            WHERE e.org_id = m.id AND e.status <> 'resolved' AND coalesce((r.ledger ->> 'creditedMinor')::numeric, 0) = 0),
         (SELECT count(*) FROM public.recon_exceptions e
            WHERE e.org_id = m.id AND e.status <> 'resolved'
              AND NOT EXISTS (SELECT 1 FROM public.match_records r WHERE r.org_id = e.org_id AND r.order_id = e.order_id))
  FROM public.organizations m
  WHERE m.kind = 'merchant' AND m.provider_org_id = provider
    AND provider = public.app_org_id() AND public.app_is_member(provider)
    AND EXISTS (SELECT 1 FROM public.organization_memberships pm WHERE pm.org_id = provider AND pm.user_id = public.app_user_id()
                AND pm.revoked_at IS NULL AND pm.role IN ('provider_admin','provider_ops'))
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION provider_exception_rate(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION provider_exception_rate(uuid) TO clearline_app;
