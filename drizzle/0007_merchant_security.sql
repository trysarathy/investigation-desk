-- rc6 Merchant Reconciliation: roles, reference data, RLS for provider → merchant tenancy, immutable facts, grants.

INSERT INTO roles (code, description) VALUES
  ('provider_admin', 'Provider Admin: manages the provider''s merchants and theme; sees merchant aggregates (details only with a merchant''s grant)'),
  ('provider_ops', 'Provider Ops: sees merchant aggregates and ingestion health (details only with a merchant''s grant)')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Reference data. Only the two public contracts are real; every other value is configuration.
INSERT INTO network_config (network, display_name, confirmations_required, enabled) VALUES
  ('tron', 'TRON', 19, true), ('ethereum', 'Ethereum', 12, true),
  ('polygon', 'Polygon', 128, false), ('solana', 'Solana', 32, false), ('arbitrum-one', 'Arbitrum One', 64, false),
  ('ton', 'TON', 1, false), ('base', 'Base', 64, false)
ON CONFLICT (network) DO NOTHING;
--> statement-breakpoint
INSERT INTO token_config (network, contract, symbol, decimals) VALUES
  ('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 'USDT', 6),
  ('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 6)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A provider member may read a merchant's rows only under an explicit, unrevoked 'full' grant to the provider
-- in the current context. pg_temp last (rc5 review M3).
CREATE FUNCTION app_provider_full_access(merchant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.provider_grants g
                 JOIN public.organizations m ON m.id = g.merchant_org_id AND m.provider_org_id = g.provider_org_id
                 WHERE g.merchant_org_id = merchant AND g.provider_org_id = public.app_org_id()
                   AND g.scope = 'full' AND g.revoked_at IS NULL AND public.app_is_member(g.provider_org_id))
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_provider_full_access(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_provider_full_access(uuid) TO clearline_app;
--> statement-breakpoint

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['merchant_entities','merchant_policy','invoices','merchant_quotes','payment_links','chain_transfers',
    'provider_payment_records','settlement_batches','settlement_batch_lines','bank_lines','fx_rates','match_records','differences',
    'recon_exceptions','writeoff_proposals','merchant_journal_proposals','pilot_time_log','match_reviews']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format($p$CREATE POLICY merchant_isolation ON %I USING (org_id = app_org_id() AND app_is_member(org_id))
                     WITH CHECK (org_id = app_org_id() AND app_is_member(org_id))$p$, tbl);
    EXECUTE format($p$CREATE POLICY provider_full_grant_read ON %I FOR SELECT USING (app_provider_full_access(org_id))$p$, tbl);
  END LOOP;
END $$;
--> statement-breakpoint

-- Grants are tenant-adjacent: the merchant's members manage them; the provider sees its own grants.
ALTER TABLE provider_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE provider_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY grants_merchant ON provider_grants USING (merchant_org_id = app_org_id() AND app_is_member(merchant_org_id))
  WITH CHECK (merchant_org_id = app_org_id() AND app_is_member(merchant_org_id) AND granted_by = app_user_id());
--> statement-breakpoint
CREATE POLICY grants_provider_read ON provider_grants FOR SELECT USING (provider_org_id = app_org_id() AND app_is_member(provider_org_id));
--> statement-breakpoint

-- Provider console aggregates. Without a grant a provider sees ONLY these numbers for its own merchants: no rows.
CREATE FUNCTION provider_merchant_health(provider uuid)
RETURNS TABLE (merchant_org_id uuid, merchant_name text, payments bigint, auto_matched bigint, exceptions_open bigint,
               oldest_open_exception_at timestamptz, last_ingestion_at timestamptz, grant_scope text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT m.id, m.name,
         (SELECT count(*) FROM public.match_records r WHERE r.org_id = m.id),
         (SELECT count(*) FROM public.match_records r WHERE r.org_id = m.id AND r.decision IN ('matched','matched_with_difference')),
         (SELECT count(*) FROM public.recon_exceptions e WHERE e.org_id = m.id AND e.status <> 'resolved'),
         (SELECT min(e.opened_at) FROM public.recon_exceptions e WHERE e.org_id = m.id AND e.status <> 'resolved'),
         (SELECT max(c.observed_at) FROM public.chain_transfers c WHERE c.org_id = m.id),
         coalesce((SELECT g.scope FROM public.provider_grants g WHERE g.merchant_org_id = m.id AND g.provider_org_id = provider AND g.revoked_at IS NULL), 'aggregates')
  FROM public.organizations m
  WHERE m.kind = 'merchant' AND m.provider_org_id = provider
    AND provider = public.app_org_id() AND public.app_is_member(provider)
    AND EXISTS (SELECT 1 FROM public.organization_memberships pm WHERE pm.org_id = provider AND pm.user_id = public.app_user_id()
                AND pm.revoked_at IS NULL AND pm.role IN ('provider_admin','provider_ops'))
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION provider_merchant_health(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION provider_merchant_health(uuid) TO clearline_app;
--> statement-breakpoint

-- Facts are immutable: a chain transfer may only update its confirmations/finality (reorgs return it to not final);
-- a bank line never changes. Amounts, addresses and sources never change.
CREATE FUNCTION keep_chain_fact() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amount_base_units <> OLD.amount_base_units OR NEW.from_address <> OLD.from_address OR NEW.to_address <> OLD.to_address
     OR NEW.token_contract <> OLD.token_contract OR NEW.decimals <> OLD.decimals OR NEW.source <> OLD.source OR NEW.block_time <> OLD.block_time THEN
    RAISE EXCEPTION 'a chain transfer''s facts are immutable (only confirmations and finality change)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chain_transfers_fact_immutable BEFORE UPDATE ON chain_transfers FOR EACH ROW EXECUTE FUNCTION keep_chain_fact();
--> statement-breakpoint
CREATE TRIGGER bank_lines_immutable BEFORE UPDATE OR DELETE ON bank_lines FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER differences_append_only BEFORE UPDATE OR DELETE ON differences FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint

-- A write-off is approved only through an approved rc5 approval request (two people, enforced by its triggers).
CREATE FUNCTION check_writeoff_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.difference_ids::text <> OLD.difference_ids::text OR NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'a write-off proposal''s amount and differences are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' AND NOT EXISTS (
       SELECT 1 FROM public.approval_requests r WHERE r.org_id = NEW.org_id AND r.id = NEW.approval_request_id
       AND r.subject_kind = 'merchant_writeoff' AND r.status = 'approved') THEN
    RAISE EXCEPTION 'a write-off is approved only by an approved two-person request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER writeoff_proposals_transition BEFORE UPDATE ON writeoff_proposals FOR EACH ROW EXECUTE FUNCTION check_writeoff_transition();
--> statement-breakpoint

GRANT SELECT ON network_config, token_config TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON provider_grants, merchant_entities, merchant_policy, invoices, merchant_quotes, payment_links,
  chain_transfers, provider_payment_records, settlement_batches, settlement_batch_lines, fx_rates, match_records,
  recon_exceptions, writeoff_proposals, merchant_journal_proposals, match_reviews TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON bank_lines, differences, pilot_time_log TO clearline_app;
