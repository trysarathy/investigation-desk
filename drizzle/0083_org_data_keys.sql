-- v1 Phase 5.3: per-organisation field-encryption keys (envelope encryption; docs/security/ENCRYPTION_V1.md).
-- Runs as the schema owner. No existing control is relaxed: a new table with forced row-level security.
-- Keys are stored WRAPPED by the KMS master key; the database never holds a key in the clear.
--   * the runtime role may read its organisation's keys (and a provider under a full grant, which already reads the
--     merchant's rows) and may create an organisation's FIRST keys (version 1, active); nothing else;
--   * rotation (a new data key version, retiring the old one) and re-wrapping under a new master key are key
--     maintenance, run by the owner (scripts/crypto/keys.ts); a key row's identity never changes, a retired key never
--     becomes active again, and only the owner may re-wrap.
CREATE TABLE "org_data_keys" (
	"org_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"version" integer NOT NULL,
	"kek_id" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"rewrapped_at" timestamp with time zone,
	CONSTRAINT "org_data_keys_org_id_purpose_version_pk" PRIMARY KEY("org_id","purpose","version"),
	CONSTRAINT "org_data_keys_purpose_chk" CHECK ("org_data_keys"."purpose" in ('data','index') and ("org_data_keys"."purpose" = 'data' or "org_data_keys"."version" = 1)),
	CONSTRAINT "org_data_keys_status_chk" CHECK ("org_data_keys"."status" in ('active','retired') and ("org_data_keys"."status" = 'retired') = ("org_data_keys"."retired_at" is not null)),
	CONSTRAINT "org_data_keys_version_chk" CHECK ("org_data_keys"."version" > 0),
	CONSTRAINT "org_data_keys_kek_chk" CHECK ("org_data_keys"."kek_id" ~ '^[A-Za-z0-9_-]{1,40}$' and length("org_data_keys"."wrapped_key") between 8 and 2000)
);
--> statement-breakpoint
ALTER TABLE "org_data_keys" ADD CONSTRAINT "org_data_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "org_data_keys_one_active_uq" ON "org_data_keys" USING btree ("org_id","purpose") WHERE "org_data_keys"."status" = 'active';
--> statement-breakpoint
ALTER TABLE org_data_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_data_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_data_keys_read ON org_data_keys FOR SELECT USING (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY org_data_keys_provider_read ON org_data_keys FOR SELECT USING (app_provider_full_access(org_id));
--> statement-breakpoint
CREATE POLICY org_data_keys_first_keys ON org_data_keys FOR INSERT
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id) AND version = 1 AND status = 'active' AND retired_at IS NULL AND rewrapped_at IS NULL);
--> statement-breakpoint
GRANT SELECT, INSERT ON org_data_keys TO clearline_app;
--> statement-breakpoint
CREATE FUNCTION guard_org_data_key() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.org_id <> OLD.org_id OR NEW.purpose <> OLD.purpose OR NEW.version <> OLD.version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'an organisation key''s identity never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'a retired key never becomes active again' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.wrapped_key <> OLD.wrapped_key OR NEW.kek_id <> OLD.kek_id) AND NEW.rewrapped_at IS NOT DISTINCT FROM OLD.rewrapped_at THEN
    RAISE EXCEPTION 'a re-wrapped key records when it was re-wrapped' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER org_data_keys_guard BEFORE UPDATE ON org_data_keys FOR EACH ROW EXECUTE FUNCTION guard_org_data_key();
