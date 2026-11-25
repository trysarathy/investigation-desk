-- v1 founder decision 9: recorded fiat-to-fiat rates (e.g. USD/SGD), for an entity's other-currency bank accounts.
-- Runs as the schema owner. A rate here only SHOWS an other-currency amount in the entity's currency and values
-- period-end revaluation PROPOSALS; reconciliation never converts amounts to make them tie. Append-only: a wrong rate
-- is never edited; a later rate (or another source) is recorded, and two sources disagreeing at the same instant make
-- the value "needs a rate" (the engine does not choose). Nothing here calls a rate API: rows come from the admin CLI.
CREATE TABLE "fiat_rates" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(24, 10) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source_label" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiat_rates_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "fiat_rates_cur_chk" CHECK ("fiat_rates"."base_currency" ~ '^[A-Z]{3}$' and "fiat_rates"."quote_currency" ~ '^[A-Z]{3}$' and "fiat_rates"."base_currency" <> "fiat_rates"."quote_currency"),
	CONSTRAINT "fiat_rates_rate_chk" CHECK ("fiat_rates"."rate" > 0),
	CONSTRAINT "fiat_rates_source_chk" CHECK (length("fiat_rates"."source_label") between 1 and 120),
	CONSTRAINT "fiat_rates_by_chk" CHECK (length("fiat_rates"."recorded_by") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "fiat_rates" ADD CONSTRAINT "fiat_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- one statement per source and instant (a correction is a new instant or a new source, never an overwrite)
CREATE UNIQUE INDEX "fiat_rates_point_uq" ON "fiat_rates" USING btree ("org_id","base_currency","quote_currency","as_of","source_label");
--> statement-breakpoint

-- Tenancy like every merchant table: forced RLS, the merchant's members only, provider read under a full grant.
ALTER TABLE fiat_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fiat_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON fiat_rates USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_full_grant_read ON fiat_rates FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
-- Like bank accounts (0039): the app reads; only the provisioning path (owner, admin CLI `record-rate`) records one.
GRANT SELECT ON fiat_rates TO clearline_app;
--> statement-breakpoint
-- (No TRUNCATE trigger, like bank_accounts: only the owner may truncate, and the merchant-deletion command and the test
-- reset rely on it; the app role has no TRUNCATE privilege.)
CREATE TRIGGER fiat_rates_append_only BEFORE UPDATE OR DELETE ON fiat_rates FOR EACH ROW EXECUTE FUNCTION refuse_change();
