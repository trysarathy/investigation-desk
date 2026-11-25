-- v1 phase 2.3: per-organisation connections to a ledger (Xero, QuickBooks Online) over OAuth 2.0. Runs as the schema
-- owner. No existing control is relaxed: two new tables with the merchant tables' row-level security.
-- Tokens are stored SEALED only (AES-256-GCM, key from the server's environment, bound to org, connection and field:
-- src/lib/accounting/connect/seal.ts); the database never holds a usable token. No provider-side read policy: a payment
-- provider never sees a merchant's ledger connection, sealed or not.
CREATE TABLE "ledger_connections" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"ledger_env" text NOT NULL,
	"status" text NOT NULL,
	"tenant_id" text,
	"tenant_name" text,
	"xero_connection_id" text,
	"tenant_choices" jsonb,
	"base_currency" text,
	"access_token_sealed" text,
	"refresh_token_sealed" text,
	"pending_tokens_sealed" text,
	"access_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"scopes" text,
	"reconnect_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"last_refreshed_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "ledger_connections_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "ledger_connections_provider_chk" CHECK ("provider" in ('xero','qbo')),
	CONSTRAINT "ledger_connections_env_chk" CHECK ("ledger_env" in ('standin','sandbox')),
	CONSTRAINT "ledger_connections_status_chk" CHECK ("status" in ('choose_tenant','active','needs_reconnect','disconnected')),
	-- active: one chosen organisation and a sealed token pair; choosing: the sealed pair waits, no organisation yet
	CONSTRAINT "ledger_connections_active_chk" CHECK ("status" <> 'active' or ("tenant_id" is not null and "access_token_sealed" is not null and "refresh_token_sealed" is not null and "access_expires_at" is not null)),
	CONSTRAINT "ledger_connections_choose_chk" CHECK ("status" <> 'choose_tenant' or ("pending_tokens_sealed" is not null and "tenant_choices" is not null)),
	-- disconnected: every token gone
	CONSTRAINT "ledger_connections_gone_chk" CHECK ("status" <> 'disconnected' or ("access_token_sealed" is null and "refresh_token_sealed" is null and "pending_tokens_sealed" is null and "disconnected_at" is not null)),
	CONSTRAINT "ledger_connections_sealed_chk" CHECK (coalesce("access_token_sealed", 'v1.') like 'v1.%' and coalesce("refresh_token_sealed", 'v1.') like 'v1.%' and coalesce("pending_tokens_sealed", 'v1.') like 'v1.%'),
	CONSTRAINT "ledger_connections_cur_chk" CHECK ("base_currency" is null or "base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "ledger_connections" ADD CONSTRAINT "ledger_connections_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_connections" ADD CONSTRAINT "ledger_connections_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- One live connection per organisation and ledger.
CREATE UNIQUE INDEX "ledger_connections_live_uq" ON "ledger_connections" USING btree ("org_id","provider") WHERE "status" <> 'disconnected';
--> statement-breakpoint
CREATE TABLE "ledger_oauth_states" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"browser_hash" text NOT NULL,
	"provider" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"pkce_verifier_sealed" text,
	"nonce" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "ledger_oauth_states_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "ledger_oauth_states_provider_chk" CHECK ("provider" in ('xero','qbo')),
	CONSTRAINT "ledger_oauth_states_hash_chk" CHECK ("state_hash" ~ '^[0-9a-f]{64}$' and "browser_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ledger_oauth_states_expiry_chk" CHECK ("expires_at" > "created_at" and "expires_at" <= "created_at" + interval '15 minutes')
);
--> statement-breakpoint
ALTER TABLE "ledger_oauth_states" ADD CONSTRAINT "ledger_oauth_states_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_oauth_states" ADD CONSTRAINT "ledger_oauth_states_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_oauth_states_hash_uq" ON "ledger_oauth_states" USING btree ("org_id","state_hash");
--> statement-breakpoint

ALTER TABLE ledger_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON ledger_connections USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ledger_connections TO clearline_app;
--> statement-breakpoint
ALTER TABLE ledger_oauth_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ledger_oauth_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A state is read back only by the member who started it.
CREATE POLICY merchant_isolation ON ledger_oauth_states USING (org_id = app_org_id() AND app_is_member(org_id) AND created_by = app_user_id())
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND created_by = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ledger_oauth_states TO clearline_app;
--> statement-breakpoint

-- A connection's identity (and, once chosen, its ledger organisation) never changes; a disconnected connection is never
-- revived (connecting again makes a new row), so drafts written through it always name one ledger organisation.
CREATE FUNCTION keep_ledger_connection() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.id <> OLD.id OR NEW.provider <> OLD.provider OR NEW.ledger_env <> OLD.ledger_env
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a ledger connection''s organisation, ledger and creator never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'disconnected' AND (NEW.status <> 'disconnected' OR NEW.access_token_sealed IS NOT NULL OR NEW.refresh_token_sealed IS NOT NULL) THEN
    RAISE EXCEPTION 'a disconnected ledger connection is never revived' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'a ledger connection never changes organisation (disconnect and connect again)' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_connections_keep BEFORE UPDATE ON ledger_connections FOR EACH ROW EXECUTE FUNCTION keep_ledger_connection();
--> statement-breakpoint
CREATE TRIGGER ledger_connections_no_delete BEFORE DELETE ON ledger_connections FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
-- A state is used once: only consumed_at may change, from null to a time.
CREATE FUNCTION keep_ledger_oauth_state() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR (to_jsonb(NEW) - 'consumed_at') <> (to_jsonb(OLD) - 'consumed_at') THEN
    RAISE EXCEPTION 'an OAuth state is used once and never changes otherwise' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_oauth_states_once BEFORE UPDATE ON ledger_oauth_states FOR EACH ROW EXECUTE FUNCTION keep_ledger_oauth_state();
